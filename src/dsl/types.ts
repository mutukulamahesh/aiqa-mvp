/**
 * DSL Types — the shape of a parsed test YAML file
 */

export type StepAction =
  | { action: "navigate"; target: string }
  | { action: "click";    target: string }
  | { action: "fill";     target: string; value: string }
  | { action: "assert";   kind: "text" | "url"; value: string };

export interface TestDefinition {
  name: string;
  variables?: Record<string, string>;
  steps: StepAction[];
}
