import * as path from "path";
import { Router } from "express";
import { safeResolvePath } from "../middleware/sandbox";
import * as persistence from "../persistence/runPersistence";

const router = Router();

// GET /api/runs/:runId/screenshots/:file
router.get("/runs/:runId/screenshots/:file", (req, res) => {
  const { runId, file } = req.params;
  try {
    const screenshotsDir = path.join(persistence.runDir(runId), "screenshots");
    const filePath = safeResolvePath(screenshotsDir, file);
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

export default router;
