import * as http from "http";
import * as path from "path";
import * as fs   from "fs";
import express    from "express";
import { corsMiddleware }  from "./api/middleware/cors";
import { mountRoutes }     from "./api/router";
import { attachWsServer }  from "./api/ws/runStream";
import { jobStore }        from "./api/jobs/RunJobStore";
import { ApiError }        from "./api/errors";
import { logger }          from "./utils/logger";
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

  // Serve the built portal as static files if dist/ exists next to this package
  const portalDist = path.resolve(process.cwd(), "portal/dist");
  if (fs.existsSync(portalDist)) {
    app.use(express.static(portalDist));
    // SPA fallback — non-API routes return index.html so React Router handles them
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(portalDist, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  // Global error handler — converts ApiError to structured JSON response.
  // Raw error details are logged server-side; only a safe message reaches clients.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const corrId = (req as Request & { correlationId?: string }).correlationId;
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error(`Unhandled error: ${err.message}`, corrId);
    res.status(500).json({ error: "Internal server error" });
  });

  const server = http.createServer(app);
  attachWsServer(server);

  // Reload recent completed runs from disk into memory
  await jobStore.loadFromDisk();

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Stop accepting new connections, wait for in-flight requests to drain,
  // then exit cleanly.  This prevents abrupt termination of running test jobs.
  const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received — starting graceful shutdown`);
    server.close((err) => {
      if (err) {
        logger.error(`Error during server close: ${err.message}`);
        process.exit(1);
      }
      logger.info("Server closed — all connections drained. Exiting.");
      process.exit(0);
    });

    // Force-exit after 30 s if drain takes too long (e.g. a hung Playwright browser)
    setTimeout(() => {
      logger.warn("Graceful shutdown timed out after 30s — forcing exit");
      process.exit(1);
    }, 30_000).unref();
  };

  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT",  () => gracefulShutdown("SIGINT"));

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const authMode = process.env.AIQA_API_KEY
        ? "enabled"
        : process.env.AIQA_ALLOW_OPEN_MODE?.toLowerCase() === "true"
          ? "open (AIQA_ALLOW_OPEN_MODE=true)"
          : "LOCKED (set AIQA_API_KEY or AIQA_ALLOW_OPEN_MODE=true)";

      logger.info(`AIQA API Server started on port ${port}`);
      logger.info(`Auth   : ${authMode}`);
      logger.info(`Workers: ${jobStore.maxConcurrent}`);

      // Keep friendly console output for interactive use
      process.stdout.write(`\n🚀 AIQA API Server\n`);
      process.stdout.write(`   Port   : ${port}\n`);
      process.stdout.write(`   Auth   : ${authMode}\n`);
      process.stdout.write(`   Workers: ${jobStore.maxConcurrent}\n`);
      process.stdout.write(`\n   Portal : http://localhost:${port}/\n`);
      process.stdout.write(`   REST   : http://localhost:${port}/api/health\n`);
      process.stdout.write(`   WS     : ws://localhost:${port}/api/runs/:runId/stream\n\n`);

      resolve(server);
    });
    server.on("error", reject);
  });
}
