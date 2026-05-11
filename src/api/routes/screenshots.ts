import * as fs   from "fs";
import * as path from "path";
import { Router } from "express";
import { safeResolvePath } from "../middleware/sandbox";
import * as persistence from "../persistence/runPersistence";

const router = Router();

// GET /api/runs/:runId/screenshots/:file
router.get("/runs/:runId/screenshots/:file", async (req, res) => {
  const { runId, file } = req.params;
  try {
    const screenshotsDir = path.join(persistence.runDir(runId), "screenshots");
    const filePath = safeResolvePath(screenshotsDir, file);
    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ct  = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
              : ext === ".webp" ? "image/webp"
              : "image/png";
    res.setHeader("Content-Type", ct);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

export default router;
