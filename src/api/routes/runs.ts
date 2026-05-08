import * as fs   from "fs";
import * as path from "path";
import { Router } from "express";
import { jobStore } from "../jobs/RunJobStore";
import * as persistence from "../persistence/runPersistence";

const router = Router();

// GET /api/runs
router.get("/runs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
  const type  = req.query.type as string | undefined;
  res.json(jobStore.list(limit, type));
});

// GET /api/runs/:runId
router.get("/runs/:runId", async (req, res) => {
  const { runId } = req.params;
  const job = jobStore.get(runId);
  if (job) { res.json(job.meta); return; }
  const meta = await persistence.readMeta(runId);
  if (!meta) { res.status(404).json({ error: "Run not found" }); return; }
  res.json(meta);
});

// GET /api/runs/:runId/results
router.get("/runs/:runId/results", async (req, res) => {
  const results = await persistence.readResults(req.params.runId);
  if (!results) { res.status(404).json({ error: "Results not found" }); return; }
  res.json(results);
});

// GET /api/runs/:runId/report
router.get("/runs/:runId/report", async (req, res) => {
  const reportPath = path.join(persistence.runDir(req.params.runId), "report.html");
  try {
    await fs.promises.access(reportPath);
    res.sendFile(reportPath);
  } catch {
    res.status(404).json({ error: "Report not found" });
  }
});

export default router;
