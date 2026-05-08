// Shared types used across background, content scripts, and panel.

export interface SelectorDescriptor {
  ariaLabel?: string;
  testId?:    string;
  text?:      string;
  css?:       string;
}

/** Raw DOM event emitted by recorder.ts and sent to the service worker. */
export interface RecordedEvent {
  type:      "click" | "fill" | "navigate" | "submit";
  selector:  SelectorDescriptor;
  value?:    string;   // present for "fill"
  url?:      string;   // present for "navigate"
  timestamp: number;
}

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface StepResult {
  index:  number;
  label:  string;
  status: StepStatus;
  error?: string;
}

export type RunStatus = "running" | "passed" | "failed";

export interface RunRecord {
  runId:     string;
  testName:  string;
  status:    RunStatus;
  steps:     StepResult[];
  timestamp: number;
}

export interface SavedTest {
  name:    string;
  yaml:    string;
  savedAt: number;
}

/** Events emitted by TestRunner and forwarded to the panel via port. */
export type StepEvent =
  | { kind: "step:start";    index: number; label: string }
  | { kind: "step:pass";     index: number }
  | { kind: "step:fail";     index: number; error: string }
  | { kind: "run:done";      status: RunStatus; steps: StepResult[] }
  | { kind: "recorded:yaml"; yaml: string };
