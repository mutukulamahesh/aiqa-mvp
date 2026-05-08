import { RunEvent, RunSummary } from "../../runner/RunEvent";

export type JobStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
export type JobType   = "run" | "run-all" | "orchestrate" | "explore" | "generate" | "import" | "jira-sync";

export interface RunJobMeta {
  runId:           string;
  type:            JobType;
  status:          JobStatus;
  startedAt:       string | null;
  completedAt:     string | null;
  screenshotsDir?: string;
  summary?:        RunSummary;
  error?:          string;
}

export interface RunJob {
  meta:        RunJobMeta;
  eventBuffer: RunEvent[];
  cancelled:   boolean;
  emit(e: RunEvent): void;
  subscribe(cb: (e: RunEvent) => void): () => void;
}

export function createRunJob(runId: string, type: JobType, screenshotsDir?: string): RunJob {
  const subscribers = new Set<(e: RunEvent) => void>();

  const job: RunJob = {
    meta: {
      runId, type,
      status:      "queued",
      startedAt:   null,
      completedAt: null,
      screenshotsDir,
    },
    eventBuffer: [],
    cancelled: false,
    emit(e: RunEvent) {
      if (this.eventBuffer.length < 500) this.eventBuffer.push(e);
      for (const cb of subscribers) cb(e);
    },
    subscribe(cb: (e: RunEvent) => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };

  return job;
}
