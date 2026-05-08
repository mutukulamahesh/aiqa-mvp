import * as os     from "os";
import * as crypto from "crypto";
import { RunJob, RunJobMeta, JobType, createRunJob } from "./RunJob";
import * as persistence from "../persistence/runPersistence";

export class RunJobStore {
  private store        = new Map<string, RunJob>();
  private queue: Array<{ job: RunJob; execute: () => Promise<void> }> = [];
  private activeCount  = 0;
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
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;
      item.job.meta.status    = "running";
      item.job.meta.startedAt = new Date().toISOString();

      Promise.resolve()
        .then(() => item.execute())
        .catch(err => {
          const message = (err as Error)?.message ?? String(err);
          item.job.meta.status = "error";
          item.job.meta.error  = message;
          item.job.emit({ event: "error", message });
          persistence.writeMeta(item.job.meta).catch(() => {});
        })
        .finally(() => {
          item.job.meta.completedAt ??= new Date().toISOString();
          this.activeCount--;
          // Evict from memory after 1 hour; disk persists indefinitely
          setTimeout(() => this.store.delete(item.job.meta.runId), 60 * 60 * 1000);
          this._drain();
        });
    }
  }
}

export const jobStore = new RunJobStore();
