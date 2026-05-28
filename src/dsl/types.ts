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
      baseline_key?:  string;    // regression key; compare against tests/baselines/{key}.json
      max_drift?:     number;    // max cosine distance vs baseline (0–1); default 0.2
      store_as?:      string;    // stores { response, score?, verdict?, reason?, baseline_distance?, baseline_verdict? }
    }
  | {
      action:           "llm_consistency";
      target?:          string;
      provider?:        string;
      model?:           string;
      system?:          string;
      prompt:           string;
      max_tokens?:      number;
      runs?:            number;           // sequential runs; default 3
      assert_variance?: {
        max:     number;                  // max allowed pairwise cosine distance
        metric?: "max" | "mean";          // default max
      };
      store_as?:        string;           // { responses[], variance, metric, verdict? }
    }
  | {
      action:      "rag_assert";
      query:       string;
      min_score?:  number;   // minimum chunk relevance score (0.0–1.0); default 0.0
      min_chunks?: number;   // minimum chunks meeting min_score; default 1
      store_as?:   string;   // stores RetrievedChunk[] (only chunks that passed)
    }
  | {
      action:          "vision_assert";
      description:     string;   // natural language — e.g. "Login button"
      min_confidence?: number;   // fail if best detection confidence < this (default 0.5)
      store_as?:       string;   // stores { description, type, selector, confidence }
    }
  | {
      action:            "visual_snapshot";
      name:              string;   // baseline key (filename-safe string)
      max_diff_percent?: number;   // fail if diffPercent > this × 100 (default 0.02 = 2%)
      sensitivity?:      number;   // pixelmatch per-pixel color tolerance 0–1 (default 0.1)
      update?:           boolean;  // true = overwrite baseline (record mode)
      store_as?:         string;   // stores { match, diffPercent, diffPath? }
    }
  // ── Desktop steps (mode: desktop only — Windows, EPIC-15) ─────────────────
  | { action: "desktop_launch";          appPath: string }
  | { action: "desktop_wait_for_window"; pattern: string; timeout?: number }
  | { action: "desktop_click";           description: string; min_confidence?: number }
  | {
      action:           "desktop_fill";
      target:           string;
      value:            string;
      expected_window?: string;
      min_confidence?:  number;
    }
  | {
      action:           "desktop_assert";
      visible?:         string;
      element?:         string;
      expected_window?: string;
      min_confidence?:  number;
    }
  | { action: "desktop_key";   key: string }
  | { action: "desktop_close" };

export interface TestDefinition {
  name:            string;
  mode?:           "web" | "desktop";  // defaults to "web" when absent
  tags?:           string[];
  retries?:        number;   // max retry attempts on transient failures (timeout/locator)
  variables?:      Record<string, string>;
  filesUnderTest?: string[]; // explicit file paths this test covers (used by --impact-only)
  source?:         string[]; // RAG provenance — Jira/Confluence IDs that informed this test
  steps:           StepAction[];
}
