import * as fs   from "fs";
import * as path from "path";
import { Router } from "express";
import { z }      from "zod";
import { jobStore } from "../jobs/RunJobStore";
import * as persistence from "../persistence/runPersistence";

const router = Router();

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  type:  z.string().optional(),
});

// GET /api/runs
router.get("/runs", (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  const { limit, type } = parsed.data;
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
    const html = await fs.promises.readFile(reportPath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch {
    res.status(404).json({ error: "Report not found" });
  }
});

export default router;
