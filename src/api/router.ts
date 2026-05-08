import { Application } from "express";
import healthRouter      from "./routes/health";
import runsRouter        from "./routes/runs";
import runTriggersRouter from "./routes/runTriggers";
import cancelRouter      from "./routes/cancel";
import testsRouter       from "./routes/tests";
import screenshotsRouter from "./routes/screenshots";
import { authMiddleware } from "./middleware/auth";

export function mountRoutes(app: Application): void {
  app.use("/api", authMiddleware, healthRouter);
  app.use("/api", authMiddleware, runsRouter);
  app.use("/api", authMiddleware, runTriggersRouter);
  app.use("/api", authMiddleware, cancelRouter);
  app.use("/api", authMiddleware, testsRouter);
  app.use("/api", authMiddleware, screenshotsRouter);
}
