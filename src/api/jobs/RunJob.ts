import { RunEvent, RunSummary } from "../../runner/RunEvent";

export type JobStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
export type JobType   = "run" | "run-all" | "orchestrate" | "explore" | "generate" | "import" | "jira-sync";

// Maximum events kept in the replay buffer for late WS subscribers.
// After this limit, events are dropped. The drop count is reported in the "done" event.
export const EVENT_BUFFER_CAPACITY = 500;

export interface RunJobMeta {
  runId:           string;
  type:            JobType;
  status:          JobStatus;
  startedAt:       string | null;
  completedAt:     string | null;
  screenshotsDir?: string;
  summary?:        RunSummary;
  error?:          string;
  config?: {
    url?:     string;
    dir?:     string;
    envKeys?: string[];
  };
}

export interface RunJob {
  meta:           RunJobMeta;
  eventBuffer:    RunEvent[];
  droppedEvents:  number;          // events dropped after EVENT_BUFFER_CAPACITY was reached
  cancelled:      boolean;
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
    eventBuffer:   [],
    droppedEvents: 0,
    cancelled:     false,

    emit(e: RunEvent) {
      if (this.eventBuffer.length < EVENT_BUFFER_CAPACITY) {
        this.eventBuffer.push(e);
      } else if (this.eventBuffer.length === EVENT_BUFFER_CAPACITY) {
        // Mark the overflow point once so late subscribers see where history ends
        const warn: RunEvent = {
          event:   "log",
          message: `[buffer full — subsequent events dropped from replay (capacity: ${EVENT_BUFFER_CAPACITY})]`,
        };
        this.eventBuffer.push(warn);
        this.droppedEvents++;
      } else {
        this.droppedEvents++;
      }

      // Live subscribers always receive every event regardless of buffer state
      for (const cb of subscribers) cb(e);
    },

    subscribe(cb: (e: RunEvent) => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };

  return job;
}
