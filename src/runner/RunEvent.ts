export interface RunSummary {
  passed: number;
  failed: number;
  total:  number;
}

export type RunEvent =
  | { event: "step";        index: number; action: string; target?: string }
  | { event: "step_result"; index: number; passed: boolean; durationMs: number; error?: string; screenshotUrl?: string }
  | { event: "test_done";   testName: string; passed: boolean; durationMs: number }
  | { event: "log";         message: string }
  | { event: "done";        status: "passed" | "failed" | "error"; summary: RunSummary }
  | { event: "error";       message: string }
