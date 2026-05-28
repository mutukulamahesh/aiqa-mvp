/**
 * DslParser — reads a YAML test file and converts it to a TestDefinition.
 *
 * Supported step shapes:
 *
 *   - navigate: https://example.com
 *   - click: "Submit"
 *   - fill:
 *       target: "#email"
 *       value: "user@example.com"
 *   - assert:
 *       text: "Welcome"          # text visible on page
 *   - assert:
 *       url: "dashboard"         # current URL contains substring
 *   - assert:
 *       value: "{{ user.name }}" # resolved value equals expected
 *       equals: "Alice"
 *   - api:
 *       method: GET
 *       url: "https://api.example.com/users/1"
 *       assert_status: 200
 *       store_as: user
 */
import * as fs from "fs";
import * as yaml from "js-yaml";
import { TestDefinition, StepAction } from "./types";

// Raw YAML shapes (what js-yaml returns before we normalize)
type RawStep =
  | string
  | { navigate: string }
  | { click: string }
  | { fill: { target: string; value: string } | string }
  | { assert: { text?: string; url?: string; value?: string; equals?: string } }
  | { api: { method: string; url: string; headers?: Record<string, string>; body?: unknown; store_as?: string; assert_status?: number } }
  | Record<string, unknown>;

interface RawTestFile {
  test: {
    name:            string;
    tags?:           string | string[];
    retries?:        number;
    variables?:      Record<string, string>;
    filesUnderTest?: string | string[];
    source?:         string | string[];
    steps:           RawStep[];
  };
}

/** Parse a TestDefinition directly from a YAML string (used by importers for validation). */
export function parseTestDefinition(content: string): TestDefinition {
  const raw = yaml.load(content) as RawTestFile;
  return buildDefinition(raw, "<string>");
}

export function parseTestFile(filePath: string): TestDefinition {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Test file not found: ${filePath}`);
  }
  const raw = yaml.load(fs.readFileSync(filePath, "utf-8")) as RawTestFile;
  return buildDefinition(raw, filePath);
}

function buildDefinition(raw: RawTestFile, location: string): TestDefinition {
  if (!raw?.test) {
    throw new Error(`Invalid test (${location}): missing top-level "test:" key`);
  }
  if (!raw.test.name) {
    throw new Error(`Invalid test (${location}): missing "test.name"`);
  }
  if (!Array.isArray(raw.test.steps) || raw.test.steps.length === 0) {
    throw new Error(`Invalid test (${location}): "test.steps" must be a non-empty array`);
  }

  const steps: StepAction[] = raw.test.steps.map((rawStep, idx) =>
    parseStep(rawStep as Record<string, unknown>, idx)
  );

  const rawTags = raw.test.tags;
  const tags: string[] = rawTags
    ? (Array.isArray(rawTags) ? rawTags : [rawTags]).map(t => String(t).trim()).filter(Boolean)
    : [];

  const retries = typeof raw.test.retries === "number"
    ? Math.max(0, Math.floor(raw.test.retries))
    : 0;

  const rawFut = raw.test.filesUnderTest;
  const filesUnderTest: string[] = rawFut
    ? (Array.isArray(rawFut) ? rawFut : [rawFut]).map(f => String(f).trim()).filter(Boolean)
    : [];

  const rawSource = raw.test.source;
  const source: string[] = rawSource
    ? (Array.isArray(rawSource) ? rawSource : [rawSource]).map(s => String(s).trim()).filter(Boolean)
    : [];

  return {
    name:      raw.test.name,
    tags,
    retries,
    variables: raw.test.variables ?? {},
    ...(filesUnderTest.length ? { filesUnderTest } : {}),
    ...(source.length          ? { source }          : {}),
    steps,
  };
}

function parseStep(raw: Record<string, unknown>, idx: number): StepAction {
  // navigate
  if ("navigate" in raw && typeof raw.navigate === "string") {
    return { action: "navigate", target: raw.navigate };
  }

  // click
  if ("click" in raw && typeof raw.click === "string") {
    return { action: "click", target: raw.click };
  }

  // fill — two forms:
  //   fill: "#selector"   (shorthand — not commonly used)
  //   fill:
  //     target: "#selector"
  //     value: "text"
  if ("fill" in raw) {
    const fill = raw.fill;
    if (fill && typeof fill === "object") {
      const f = fill as Record<string, string>;
      if (!f.target) throw new Error(`Step[${idx}] fill: missing "target"`);
      if (f.value === undefined) throw new Error(`Step[${idx}] fill: missing "value"`);
      return { action: "fill", target: f.target, value: f.value };
    }
    throw new Error(`Step[${idx}] fill: expected an object with target/value`);
  }

  // assert — sub-forms: text, url, value+equals
  if ("assert" in raw) {
    const assert = raw.assert as Record<string, string> | undefined;
    if (!assert) throw new Error(`Step[${idx}] assert: empty`);

    if ("text" in assert && typeof assert.text === "string") {
      return { action: "assert", kind: "text", value: assert.text };
    }
    if ("url" in assert && typeof assert.url === "string") {
      return { action: "assert", kind: "url", value: assert.url };
    }
    if ("visible" in assert && typeof assert.visible === "string") {
      return { action: "assert", kind: "visible", value: assert.visible };
    }
    if ("element_not_visible" in assert && typeof assert.element_not_visible === "string") {
      return { action: "assert", kind: "element_not_visible", value: assert.element_not_visible };
    }
    if ("value" in assert && typeof assert.value === "string") {
      if (!assert.equals) throw new Error(`Step[${idx}] assert.value: missing "equals"`);
      return { action: "assert", kind: "equals", value: assert.value, equals: assert.equals };
    }
    throw new Error(`Step[${idx}] assert: must have "text", "url", "visible", "element_not_visible", or "value+equals" key`);
  }

  // db
  if ("db" in raw) {
    const db = raw.db as Record<string, unknown> | undefined;
    if (!db) throw new Error(`Step[${idx}] db: empty`);
    if (typeof db.query !== "string") throw new Error(`Step[${idx}] db: missing "query"`);
    return {
      action:       "db",
      query:        db.query,
      params:       Array.isArray(db.params) ? db.params : undefined,
      store_as:     typeof db.store_as === "string" ? db.store_as : undefined,
      assert_rows:  typeof db.assert_rows === "number" ? db.assert_rows : undefined,
      assert_field: db.assert_field ? (db.assert_field as Record<string, unknown>) : undefined,
    };
  }

  // wait_for_element — two forms:
  //   wait_for_element: "#submit"               (shorthand)
  //   wait_for_element:                         (object, allows optional timeout)
  //     selector: "#submit"
  //     timeout: 5000
  if ("wait_for_element" in raw) {
    const wfe = raw.wait_for_element;
    if (typeof wfe === "string") {
      return { action: "wait_for_element", selector: wfe };
    }
    if (wfe && typeof wfe === "object") {
      const w = wfe as Record<string, unknown>;
      if (typeof w.selector !== "string") throw new Error(`Step[${idx}] wait_for_element: missing "selector"`);
      if (w.timeout !== undefined && (typeof w.timeout !== "number" || w.timeout < 0)) {
        throw new Error(`Step[${idx}] wait_for_element: "timeout" must be a non-negative number`);
      }
      return {
        action:   "wait_for_element",
        selector: w.selector,
        ...(typeof w.timeout === "number" ? { timeout: w.timeout } : {}),
      };
    }
    throw new Error(`Step[${idx}] wait_for_element: must be a string selector or object with "selector"`);
  }

  // wait_ms
  if ("wait_ms" in raw) {
    if (typeof raw.wait_ms !== "number" || raw.wait_ms < 0) throw new Error(`Step[${idx}] wait_ms: must be a non-negative number`);
    return { action: "wait_ms", ms: raw.wait_ms };
  }

  // wait_for_url
  if ("wait_for_url" in raw) {
    if (typeof raw.wait_for_url !== "string") throw new Error(`Step[${idx}] wait_for_url: must be a string`);
    return { action: "wait_for_url", url: raw.wait_for_url };
  }

  // store
  if ("store" in raw) {
    const s = raw.store as Record<string, unknown> | undefined;
    if (!s) throw new Error(`Step[${idx}] store: empty`);
    if (typeof s.selector !== "string") throw new Error(`Step[${idx}] store: missing "selector"`);
    if (typeof s.as !== "string")       throw new Error(`Step[${idx}] store: missing "as"`);
    return {
      action:    "store",
      selector:  s.selector,
      attribute: typeof s.attribute === "string" ? s.attribute : undefined,
      as:        s.as,
    };
  }

  // if
  if ("if" in raw) {
    const c = raw.if as Record<string, unknown> | undefined;
    if (!c) throw new Error(`Step[${idx}] if: empty`);
    if (typeof c.variable !== "string") throw new Error(`Step[${idx}] if: missing "variable"`);
    if (!Array.isArray(c.steps))        throw new Error(`Step[${idx}] if: missing "steps" array`);

    // Resolve operator + operand. `equals:` is the canonical backward-compat shorthand.
    const OP_KEYS: Record<string, import("./types").IfOperator> = {
      equals:     "equals",
      not_equals: "not_equals",
      contains:   "contains",
      gt:         "gt",
      lt:         "lt",
      gte:        "gte",
      lte:        "lte",
    };
    const matchedKeys = Object.keys(OP_KEYS).filter(k => typeof c[k] === "string");
    if (matchedKeys.length === 0) throw new Error(`Step[${idx}] if: must specify one of equals/not_equals/contains/gt/lt/gte/lte`);
    if (matchedKeys.length > 1)   throw new Error(`Step[${idx}] if: conflicting operator keys — specify exactly one of [${matchedKeys.join(", ")}]`);
    const opKey = matchedKeys[0];

    return {
      action:   "if",
      variable: c.variable,
      operator: OP_KEYS[opKey],
      operand:  c[opKey] as string,
      steps:    (c.steps as Record<string, unknown>[]).map((s, i) => parseStep(s, i)),
    };
  }

  // for_each
  if ("for_each" in raw) {
    const f = raw.for_each as Record<string, unknown> | undefined;
    if (!f) throw new Error(`Step[${idx}] for_each: empty`);
    if (typeof f.over !== "string") throw new Error(`Step[${idx}] for_each: missing "over"`);
    if (typeof f.as   !== "string") throw new Error(`Step[${idx}] for_each: missing "as"`);
    if (!Array.isArray(f.steps))    throw new Error(`Step[${idx}] for_each: missing "steps" array`);
    return {
      action: "for_each",
      over:   f.over,
      as:     f.as,
      steps:  (f.steps as Record<string, unknown>[]).map((s, i) => parseStep(s, i)),
    };
  }

  // judge
  if ("judge" in raw) {
    const j = raw.judge as Record<string, unknown> | undefined;
    if (!j) throw new Error(`Step[${idx}] judge: empty`);
    if (typeof j.value   !== "string") throw new Error(`Step[${idx}] judge: missing "value"`);
    if (typeof j.prompt  !== "string") throw new Error(`Step[${idx}] judge: missing "prompt"`);
    if (typeof j.pass_if !== "string") throw new Error(`Step[${idx}] judge: missing "pass_if"`);
    return {
      action:   "judge",
      value:    j.value,
      prompt:   j.prompt,
      pass_if:  j.pass_if,
      ...(typeof j.store_as === "string" ? { store_as: j.store_as } : {}),
    };
  }

  // llm_eval
  if ("llm_eval" in raw) {
    const e = raw.llm_eval as Record<string, unknown> | undefined;
    if (!e) throw new Error(`Step[${idx}] llm_eval: empty`);
    if (typeof e.prompt !== "string") throw new Error(`Step[${idx}] llm_eval: missing "prompt"`);
    const aq = e.assert_quality as Record<string, unknown> | undefined;
    if (aq) {
      if (typeof aq.criteria !== "string") throw new Error(`Step[${idx}] llm_eval: assert_quality.criteria must be a string`);
      if (typeof aq.pass_if  !== "string") throw new Error(`Step[${idx}] llm_eval: assert_quality.pass_if is required`);
    }
    if (e.max_drift !== undefined && (typeof e.max_drift !== "number" || e.max_drift < 0 || e.max_drift > 1)) {
      throw new Error(`Step[${idx}] llm_eval: "max_drift" must be a number between 0 and 1`);
    }
    return {
      action:     "llm_eval",
      ...(typeof e.target       === "string" ? { target:       e.target       } : {}),
      ...(typeof e.provider     === "string" ? { provider:     e.provider     } : {}),
      ...(typeof e.model        === "string" ? { model:        e.model        } : {}),
      ...(typeof e.system       === "string" ? { system:       e.system       } : {}),
      prompt:     e.prompt,
      ...(typeof e.max_tokens   === "number" ? { max_tokens:   e.max_tokens   } : {}),
      ...(aq ? { assert_quality: { criteria: aq.criteria as string, pass_if: aq.pass_if as string } } : {}),
      ...(typeof e.baseline_key === "string" ? { baseline_key: e.baseline_key } : {}),
      ...(typeof e.max_drift    === "number" ? { max_drift:    e.max_drift    } : {}),
      ...(typeof e.store_as     === "string" ? { store_as:     e.store_as     } : {}),
    };
  }

  // llm_consistency
  if ("llm_consistency" in raw) {
    const e = raw.llm_consistency as Record<string, unknown> | undefined;
    if (!e) throw new Error(`Step[${idx}] llm_consistency: empty`);
    if (typeof e.prompt !== "string") throw new Error(`Step[${idx}] llm_consistency: missing "prompt"`);
    if (e.runs !== undefined && (typeof e.runs !== "number" || !Number.isInteger(e.runs) || e.runs < 1 || e.runs > 20)) {
      throw new Error(`Step[${idx}] llm_consistency: "runs" must be a positive integer between 1 and 20`);
    }
    const av = e.assert_variance as Record<string, unknown> | undefined;
    return {
      action: "llm_consistency",
      ...(typeof e.target     === "string" ? { target:     e.target     } : {}),
      ...(typeof e.provider   === "string" ? { provider:   e.provider   } : {}),
      ...(typeof e.model      === "string" ? { model:      e.model      } : {}),
      ...(typeof e.system     === "string" ? { system:     e.system     } : {}),
      prompt: e.prompt,
      ...(typeof e.max_tokens === "number" ? { max_tokens: e.max_tokens } : {}),
      ...(typeof e.runs       === "number" ? { runs:       e.runs       } : {}),
      ...(av && typeof av.max === "number"
        ? { assert_variance: {
              max: av.max,
              ...(av.metric === "max" || av.metric === "mean" ? { metric: av.metric as "max" | "mean" } : {}),
            } }
        : {}),
      ...(typeof e.store_as   === "string" ? { store_as:   e.store_as   } : {}),
    };
  }

  // rag_assert
  if ("rag_assert" in raw) {
    const r = raw.rag_assert as Record<string, unknown> | undefined;
    if (!r) throw new Error(`Step[${idx}] rag_assert: empty`);
    if (typeof r.query !== "string") throw new Error(`Step[${idx}] rag_assert: missing "query"`);
    if (r.min_score  !== undefined && (typeof r.min_score  !== "number" || r.min_score  < 0 || r.min_score  > 1)) {
      throw new Error(`Step[${idx}] rag_assert: "min_score" must be a number between 0 and 1`);
    }
    if (r.min_chunks !== undefined && (typeof r.min_chunks !== "number" || !Number.isInteger(r.min_chunks) || r.min_chunks < 1)) {
      throw new Error(`Step[${idx}] rag_assert: "min_chunks" must be a positive integer`);
    }
    return {
      action:  "rag_assert",
      query:   r.query,
      ...(typeof r.min_score  === "number" ? { min_score:  r.min_score  } : {}),
      ...(typeof r.min_chunks === "number" ? { min_chunks: r.min_chunks } : {}),
      ...(typeof r.store_as   === "string" ? { store_as:   r.store_as   } : {}),
    };
  }

  // vision_assert
  if ("vision_assert" in raw) {
    const v = raw.vision_assert as Record<string, unknown> | undefined;
    if (!v) throw new Error(`Step[${idx}] vision_assert: empty`);
    if (typeof v.description !== "string") throw new Error(`Step[${idx}] vision_assert: missing "description"`);
    if (v.min_confidence !== undefined &&
        (typeof v.min_confidence !== "number" || v.min_confidence < 0 || v.min_confidence > 1)) {
      throw new Error(`Step[${idx}] vision_assert: "min_confidence" must be a number between 0 and 1`);
    }
    return {
      action:      "vision_assert",
      description: v.description,
      ...(typeof v.min_confidence === "number" ? { min_confidence: v.min_confidence } : {}),
      ...(typeof v.store_as       === "string" ? { store_as:       v.store_as       } : {}),
    };
  }

  // visual_snapshot
  if ("visual_snapshot" in raw) {
    const s = raw.visual_snapshot as Record<string, unknown> | undefined;
    if (!s) throw new Error(`Step[${idx}] visual_snapshot: empty`);
    if (typeof s.name !== "string") throw new Error(`Step[${idx}] visual_snapshot: missing "name"`);
    if (s.max_diff_percent !== undefined &&
        (typeof s.max_diff_percent !== "number" || s.max_diff_percent < 0 || s.max_diff_percent > 1)) {
      throw new Error(`Step[${idx}] visual_snapshot: "max_diff_percent" must be a number between 0 and 1`);
    }
    if (s.sensitivity !== undefined &&
        (typeof s.sensitivity !== "number" || s.sensitivity < 0 || s.sensitivity > 1)) {
      throw new Error(`Step[${idx}] visual_snapshot: "sensitivity" must be a number between 0 and 1`);
    }
    return {
      action: "visual_snapshot",
      name:   s.name,
      ...(typeof s.max_diff_percent === "number"  ? { max_diff_percent: s.max_diff_percent } : {}),
      ...(typeof s.sensitivity      === "number"  ? { sensitivity:      s.sensitivity      } : {}),
      ...(typeof s.update           === "boolean" ? { update:           s.update           } : {}),
      ...(typeof s.store_as         === "string"  ? { store_as:         s.store_as         } : {}),
    };
  }

  // api
  if ("api" in raw) {
    const api = raw.api as Record<string, unknown> | undefined;
    if (!api) throw new Error(`Step[${idx}] api: empty`);
    if (typeof api.method !== "string") throw new Error(`Step[${idx}] api: missing "method"`);
    if (typeof api.url    !== "string") throw new Error(`Step[${idx}] api: missing "url"`);
    return {
      action:        "api",
      method:        api.method,
      url:           api.url,
      headers:       api.headers as Record<string, string> | undefined,
      body:          api.body,
      store_as:      typeof api.store_as === "string" ? api.store_as : undefined,
      assert_status: typeof api.assert_status === "number" ? api.assert_status : undefined,
    };
  }

  // Keep this list in sync with HandlerRegistry registrations.
  // All handler action names: navigate, click, fill (UIActionHandler) |
  //   assert (AssertionHandler) | api (APIActionHandler) | db (DBActionHandler) |
  //   wait_for_element, wait_ms, wait_for_url (WaitHandler) | store (StoreHandler) |
  //   if (ConditionHandler) | for_each (LoopHandler) | judge (JudgeHandler)
  const SUPPORTED = [
    "navigate", "click", "fill",
    "assert",
    "api",
    "db",
    "wait_for_element", "wait_ms", "wait_for_url",
    "store",
    "if",
    "for_each",
    "judge",
    "llm_eval",
    "llm_consistency",
    "rag_assert",
    "vision_assert",
    "visual_snapshot",
  ] as const;
  throw new Error(
    `Step[${idx}]: unknown action. Supported: ${SUPPORTED.join(", ")}. Got: ${JSON.stringify(raw)}`
  );
}
