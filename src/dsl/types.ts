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
    }
  | {
      action:        "db";
      query:         string;
      params?:       unknown[];
      store_as?:     string;
      assert_rows?:  number;
      assert_field?: Record<string, unknown>;
    }
  | { action: "wait_for_element"; selector: string; timeout?: number }
  | { action: "wait_ms";          ms: number }
  | { action: "wait_for_url";     url: string }
  | { action: "store";            selector: string; attribute?: string; as: string }
  | { action: "if";               variable: string; equals: string; steps: StepAction[] }
  | { action: "for_each";         over: string; as: string; steps: StepAction[] };

export interface TestDefinition {
  name:      string;
  tags?:     string[];
  retries?:  number;   // max retry attempts on transient failures (timeout/locator)
  variables?: Record<string, string>;
  steps:     StepAction[];
}
