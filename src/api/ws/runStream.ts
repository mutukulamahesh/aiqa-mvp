import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { jobStore } from "../jobs/RunJobStore";
import * as persistence from "../persistence/runPersistence";
import { RunEvent } from "../../runner/RunEvent";
import { verifyWsOrigin } from "../middleware/cors";
import { consumeToken } from "./wsTokenStore";

const RUN_STREAM_PATH = /^\/api\/runs\/([^/]+)\/stream$/;

export function attachWsServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url    = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const apiKey = process.env.AIQA_API_KEY;

    if (!RUN_STREAM_PATH.test(url.pathname)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // Auth: browser WebSocket API cannot send custom headers during upgrade,
    // so we use short-lived one-time tokens issued via POST /api/ws-token.
    // The token is single-use, 60-second TTL, and stored only in process memory.
    if (apiKey) {
      const token = url.searchParams.get("token") ?? "";
      if (!consumeToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    } else if (process.env.AIQA_ALLOW_OPEN_MODE?.toLowerCase() !== "true") {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!verifyWsOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws: WebSocket, req: http.IncomingMessage) => {
    const url   = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const match = url.pathname.match(RUN_STREAM_PATH);
    if (!match) { ws.close(1008, "Invalid path"); return; }

    const runId = match[1];
    const job   = jobStore.get(runId);

    if (!job) {
      const meta = await persistence.readMeta(runId);
      if (!meta) { ws.close(1008, "Run not found"); return; }
      const status = (["passed", "failed", "error"].includes(meta.status)
        ? meta.status : "error") as "passed" | "failed" | "error";
      const doneEvent: RunEvent = {
        event: "done",
        status,
        summary: meta.summary ?? { passed: 0, failed: 0, total: 0 },
      };
      ws.send(JSON.stringify(doneEvent));
      ws.close();
      return;
    }

    for (const e of job.eventBuffer) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
    }

    if (["passed", "failed", "error", "cancelled"].includes(job.meta.status)) {
      ws.close();
      return;
    }

    const unsubscribe = job.subscribe((e: RunEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
      if (e.event === "done" || e.event === "error") ws.close();
    });

    ws.on("close", unsubscribe);
    ws.on("error", unsubscribe);
  });

  return wss;
}
