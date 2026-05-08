import * as http from "http";
import express    from "express";
import { corsMiddleware }  from "./api/middleware/cors";
import { mountRoutes }     from "./api/router";
import { attachWsServer }  from "./api/ws/runStream";
import { jobStore }        from "./api/jobs/RunJobStore";
import { ApiError }        from "./api/errors";
import { Request, Response, NextFunction } from "express";

export interface ServerOptions {
  port?: number;
  env?:  string;
}

export async function startServer(opts: ServerOptions = {}): Promise<http.Server> {
  const port = opts.port ?? (parseInt(process.env.AIQA_PORT ?? "") || 7432);

  const app = express();

  app.use(corsMiddleware());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.text({ type: "text/yaml", limit: "10mb" }));

  mountRoutes(app);

  // Global error handler — converts ApiError to structured JSON response
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error("[AIQA Server]", err);
    res.status(500).json({ error: "Internal server error" });
  });

  const server = http.createServer(app);
  attachWsServer(server);

  // Reload recent completed runs from disk into memory
  await jobStore.loadFromDisk();

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`\n🚀 AIQA API Server`);
      console.log(`   Port   : ${port}`);
      console.log(`   Auth   : ${process.env.AIQA_API_KEY ? "enabled" : "open (no AIQA_API_KEY set)"}`);
      console.log(`   Workers: ${jobStore.maxConcurrent}`);
      console.log(`\n   REST   : http://localhost:${port}/api/health`);
      console.log(`   WS     : ws://localhost:${port}/api/runs/:runId/stream\n`);
      resolve(server);
    });
    server.on("error", reject);
  });
}
