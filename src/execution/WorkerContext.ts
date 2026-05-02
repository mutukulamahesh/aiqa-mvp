import { AsyncLocalStorage } from "async_hooks";

export interface WorkerStore {
  testId:   string;
  testName: string;
  logs:     string[];   // buffered output lines, flushed atomically at end of test
}

export const workerStorage = new AsyncLocalStorage<WorkerStore>();

/** Buffer a log line. Falls back to console.log when called outside a worker context. */
export function wlog(msg: string): void {
  const store = workerStorage.getStore();
  if (store) {
    store.logs.push(msg + "\n");
  } else {
    console.log(msg);
  }
}

/** Buffer a partial write (no trailing newline). Falls back to process.stdout.write. */
export function wwrite(msg: string): void {
  const store = workerStorage.getStore();
  if (store) {
    store.logs.push(msg);
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
