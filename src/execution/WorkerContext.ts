import { AsyncLocalStorage } from "async_hooks";
import { RunEvent } from "../runner/RunEvent";

export interface WorkerStore {
  testId:   string;
  testName: string;
  logs:     string[];   // buffered output lines, flushed atomically at end of test
  onEvent?: (e: RunEvent) => void;
}

export const workerStorage = new AsyncLocalStorage<WorkerStore>();

/** Buffer a log line. Falls back to process.stdout when called outside a worker context. */
export function wlog(msg: string): void {
  const store = workerStorage.getStore();
  if (store) {
    store.logs.push(msg + "\n");
    store.onEvent?.({ event: "log", message: msg });
  } else {
    process.stdout.write(msg + "\n");
  }
}

/** Buffer a partial write (no trailing newline). Falls back to process.stdout.write. */
export function wwrite(msg: string): void {
  const store = workerStorage.getStore();
  if (store) {
    store.logs.push(msg);
    store.onEvent?.({ event: "log", message: msg });
  } else {
    process.stdout.write(msg);
  }
}

/** Flush all buffered output for the current worker atomically to stdout. */
export function flushWorker(): void {
  const store = workerStorage.getStore();
  if (store?.logs.length) {
    process.stdout.write(store.logs.join(""));
    store.logs = [];
  }
}
