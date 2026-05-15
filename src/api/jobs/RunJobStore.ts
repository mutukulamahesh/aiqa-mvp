import * as os     from "os";
import * as crypto from "crypto";
import { RunJob, RunJobMeta, JobType, createRunJob } from "./RunJob";
import * as persistence from "../persistence/runPersistence";
import { sanitizeErrorMessage } from "../../utils/sanitizeError";
import { logger } from "../../utils/logger";

export class RunJobStore {
  private store        = new Map<string, RunJob>();
  private queue: Array<{ job: RunJob; execute: () => Promise<void> }> = [];
  private activeCount  = 0;
  private draining     = false;   // guard against re-entrant _drain() calls
  readonly maxConcurrent = parseInt(process.env.AIQA_MAX_WORKERS ?? "") || os.cpus().length;

  create(type: JobType, screenshotsDir?: string): RunJob {
    const runId = crypto.randomUUID();
    const job   = createRunJob(runId, type, screenshotsDir);
    this.store.set(runId, job);
    return job;
  }

  get(runId: string): RunJob | undefined {
    return this.store.get(runId);
  }

  list(limit = 20, type?: string): RunJobMeta[] {
    return [...this.store.values()]
      .filter(j => !type || j.meta.type === type)
      .sort((a, b) => {
        const ta = a.meta.startedAt ?? a.meta.runId;
        const tb = b.meta.startedAt ?? b.meta.runId;
        return tb.localeCompare(ta);
      })
      .slice(0, limit)
      .map(j => j.meta);
  }

  enqueue(job: RunJob, execute: () => Promise<void>): void {
    this.queue.push({ job, execute });
    this._drain();
  }

  /** Reload last N completed runs from disk into memory on server start. */
  async loadFromDisk(limit = 100): Promise<void> {
    const metas = await persistence.loadRecentMetas(limit);
    for (const meta of metas) {
      if (!this.store.has(meta.runId)) {
        const job = createRunJob(meta.runId, meta.type, meta.screenshotsDir);
        Object.assign(job.meta, meta);
        this.store.set(meta.runId, job);
      }
    }
  }

  private _drain(): void {
    // Guard: if a _drain() call is already executing its synchronous while-loop,
    // do not start a second one. The in-progress drain will pick up any items
    // that were enqueued concurrently before it exits.
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.activeCount++;
        item.job.meta.status    = "running";
        item.job.meta.startedAt = new Date().toISOString();

        Promise.resolve()
          .then(() => item.execute())
          .catch(err => {
            const rawMessage       = (err as Error)?.message ?? String(err);
            const clientMessage    = sanitizeErrorMessage(err);
            item.job.meta.status   = "error";
            item.job.meta.error    = rawMessage;  // full detail kept in meta (server-side only)
            logger.error(`Job ${item.job.meta.runId} failed: ${rawMessage}`);
            item.job.emit({ event: "error", message: clientMessage });  // sanitized to clients
            persistence.writeMeta(item.job.meta).catch(() => {});
          })
          .finally(() => {
            item.job.meta.completedAt ??= new Date().toISOString();
            this.activeCount--;
            // Evict from memory after 1 hour; disk persists indefinitely
            setTimeout(() => this.store.delete(item.job.meta.runId), 60 * 60 * 1000);
            // Reset before recursive call so the next _drain() can enter.
            this.draining = false;
            this._drain();
          });
      }
    } finally {
      // Only reset if we didn't schedule async work (in which case .finally() resets it).
      if (this.activeCount === 0 || this.queue.length === 0) {
        this.draining = false;
      }
    }
  }
}

export const jobStore = new RunJobStore();
