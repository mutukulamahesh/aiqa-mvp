import * as crypto        from "crypto";
import { Application, Request, Response, NextFunction } from "express";
import healthRouter      from "./routes/health";
import runsRouter        from "./routes/runs";
import runTriggersRouter from "./routes/runTriggers";
import cancelRouter      from "./routes/cancel";
import testsRouter       from "./routes/tests";
import screenshotsRouter from "./routes/screenshots";
import wsTokenRouter     from "./routes/wsToken";
import { authMiddleware } from "./middleware/auth";
import { logger }        from "../utils/logger";

// ── Request correlation logging ───────────────────────────────────────────────

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers["x-correlation-id"] as string | undefined)
    ?? crypto.randomUUID();

  // Attach to request so handlers can reference it
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);

  const start = Date.now();
  res.on("finish", () => {
    logger.info(
      `${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`,
      correlationId,
    );
  });
  next();
}

// ── Rate limiter (job-submission endpoints only) ──────────────────────────────
// Max AIQA_RATE_LIMIT requests per AIQA_RATE_WINDOW_MS per IP (defaults: 20/min).
// Implemented without external dependencies using a sliding-window counter.

const RATE_LIMIT    = parseInt(process.env.AIQA_RATE_LIMIT    ?? "20");
const RATE_WINDOW   = parseInt(process.env.AIQA_RATE_WINDOW_MS ?? "60000");

interface RateEntry { count: number; windowStart: number }
const rateMap = new Map<string, RateEntry>();

// Purge stale entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW;
  for (const [ip, e] of rateMap) {
    if (e.windowStart < cutoff) rateMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip  = req.ip ?? "unknown";
  const now = Date.now();
  const e   = rateMap.get(ip);

  if (!e || now - e.windowStart > RATE_WINDOW) {
    rateMap.set(ip, { count: 1, windowStart: now });
    next();
    return;
  }

  if (e.count >= RATE_LIMIT) {
    res.status(429).json({
      error: `Rate limit exceeded — max ${RATE_LIMIT} requests per ${RATE_WINDOW / 1000}s`,
    });
    return;
  }

  e.count++;
  next();
}

// ── Route mounting ─────────────────────────────────────────────────────────────

export function mountRoutes(app: Application): void {
  app.use(requestLogger);

  // Health is intentionally unauthenticated — load balancers and probes need it
  app.use("/api", healthRouter);

  // WS token endpoint — authenticated but not rate-limited (it's lightweight)
  app.use("/api", authMiddleware, wsTokenRouter);

  // Job-submission routes carry the rate limiter
  app.use("/api", authMiddleware, rateLimiter, runTriggersRouter);

  // Read-only / management routes (no rate limit — they don't consume workers)
  app.use("/api", authMiddleware, runsRouter);
  app.use("/api", authMiddleware, cancelRouter);
  app.use("/api", authMiddleware, testsRouter);
  app.use("/api", authMiddleware, screenshotsRouter);
}
