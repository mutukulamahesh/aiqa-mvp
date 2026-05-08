import { Router } from "express";

const router = Router();
const startTime = Date.now();

router.get("/health", (_req, res) => {
  res.json({
    status:   "ok",
    version:  process.env.npm_package_version ?? "unknown",
    uptimeMs: Date.now() - startTime,
  });
});

export default router;
