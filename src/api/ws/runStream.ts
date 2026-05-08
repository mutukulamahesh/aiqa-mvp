import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { jobStore } from "../jobs/RunJobStore";
import * as persistence from "../persistence/runPersistence";
import { RunEvent } from "../../runner/RunEvent";
import { verifyWsOrigin } from "../middleware/cors";

const RUN_STREAM_PATH = /^\/api\/runs\/([^/]+)\/stream$/;

export function attachWsServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Filter upgrades to our path before handing off to ws
  server.on("upgrade", (req, socket, head) => {
    const url      = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const apiKey   = process.env.AIQA_API_KEY;

    if (!RUN_STREAM_PATH.test(url.pathname)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // Auth uses ?token= instead of Authorization header because the browser
    // WebSocket API does not support custom headers during the upgrade handshake.
    // Callers should use TLS so the token is not sent in plaintext.
    if (apiKey && url.searchParams.get("token") !== apiKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // CORS for WS
    if (!verifyWsOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws: WebSocket, req: http.IncomingMessage) => {
    const url    = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const match  = url.pathname.match(RUN_STREAM_PATH);
    if (!match) { ws.close(1008, "Invalid path"); return; }

    const runId  = match[1];
    const job    = jobStore.get(runId);

    // Run not in memory — try disk (completed run)
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

    // Replay buffered events first
    for (const e of job.eventBuffer) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
    }

    // If job is already terminal, close immediately after replay
    if (["passed", "failed", "error", "cancelled"].includes(job.meta.status)) {
      ws.close();
      return;
    }

    // Subscribe to live events
    const unsubscribe = job.subscribe((e: RunEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
      if (e.event === "done" || e.event === "error") ws.close();
    });

    ws.on("close", unsubscribe);
    ws.on("error", unsubscribe);
  });

  return wss;
}
