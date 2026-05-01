/**
 * DSL Types — the shape of a parsed test YAML file
 */

export type StepAction =
  | { action: "navigate"; target: string }
  | { action: "click";    target: string }
  | { action: "fill";     target: string; value: string }
  | { action: "assert"; kind: "text" | "url" | "visible"; value: string }
  | { action: "assert"; kind: "equals";                   value: string; equals: string }
  | {
      action:        "api";
      method:        string;
      url:           string;
      headers?:      Record<string, string>;
      body?:         unknown;
      store_as?:     string;
      assert_status?: number;
    };

export interface TestDefinition {
  name: string;
  variables?: Record<string, string>;
  steps: StepAction[];
}
