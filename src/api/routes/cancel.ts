import { Router } from "express";
import { jobStore } from "../jobs/RunJobStore";

const router = Router();

// POST /api/runs/:runId/cancel
router.post("/runs/:runId/cancel", (req, res) => {
  const { runId } = req.params;
  const job = jobStore.get(runId);

  if (!job) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const { status } = job.meta;

  if (["passed", "failed", "error", "cancelled"].includes(status)) {
    res.status(409).json({ error: `Run already in terminal state: ${status}` });
    return;
  }

  job.cancelled = true;
  job.meta.status = "cancelled";
  job.meta.completedAt = new Date().toISOString();

  res.json({ runId, status: "cancelled" });
});

export default router;
