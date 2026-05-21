/**
 * DSL Types — the shape of a parsed test YAML file
 */

/** Comparison operators supported by the `if:` step. */
export type IfOperator = "equals" | "not_equals" | "contains" | "gt" | "lt" | "gte" | "lte";

export type StepAction =
  | { action: "navigate"; target: string }
  | { action: "click";    target: string }
  | { action: "fill";     target: string; value: string }
  | { action: "assert"; kind: "text" | "url" | "visible" | "element_not_visible"; value: string }
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
  | { action: "if"; variable: string; operator: IfOperator; operand: string; steps: StepAction[] }
  | { action: "for_each";         over: string; as: string; steps: StepAction[] }
  | {
      action:    "judge";
      value:     string;
      prompt:    string;
      pass_if:   string;
      store_as?: string;
    }
  | {
      action:         "llm_eval";
      target?:        string;    // named target from config.llm_targets (preferred)
      provider?:      string;    // inline fallback when target is omitted
      model?:         string;
      system?:        string;
      prompt:         string;
      max_tokens?:    number;
      assert_quality?: {
        criteria: string;
        pass_if:  string;
      };
      store_as?:      string;    // stores { response, score?, verdict?, reason? }
    };

export interface TestDefinition {
  name:            string;
  tags?:           string[];
  retries?:        number;   // max retry attempts on transient failures (timeout/locator)
  variables?:      Record<string, string>;
  filesUnderTest?: string[]; // explicit file paths this test covers (used by --impact-only)
  source?:         string[]; // RAG provenance — Jira/Confluence IDs that informed this test
  steps:           StepAction[];
}
