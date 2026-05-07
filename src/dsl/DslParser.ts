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
    name:      string;
    tags?:     string | string[];
    retries?:  number;
    variables?: Record<string, string>;
    steps:     RawStep[];
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

function buildDefinition(raw: RawTestFile, source: string): TestDefinition {
  if (!raw?.test) {
    throw new Error(`Invalid test (${source}): missing top-level "test:" key`);
  }
  if (!raw.test.name) {
    throw new Error(`Invalid test (${source}): missing "test.name"`);
  }
  if (!Array.isArray(raw.test.steps) || raw.test.steps.length === 0) {
    throw new Error(`Invalid test (${source}): "test.steps" must be a non-empty array`);
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

  return {
    name:      raw.test.name,
    tags,
    retries,
    variables: raw.test.variables ?? {},
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
    if ("value" in assert && typeof assert.value === "string") {
      if (!assert.equals) throw new Error(`Step[${idx}] assert.value: missing "equals"`);
      return { action: "assert", kind: "equals", value: assert.value, equals: assert.equals };
    }
    throw new Error(`Step[${idx}] assert: must have "text", "url", "visible", or "value+equals" key`);
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

  // wait_for_element
  if ("wait_for_element" in raw) {
    if (typeof raw.wait_for_element !== "string") throw new Error(`Step[${idx}] wait_for_element: must be a string selector`);
    return { action: "wait_for_element", selector: raw.wait_for_element };
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
    if (typeof c.equals   !== "string") throw new Error(`Step[${idx}] if: missing "equals"`);
    if (!Array.isArray(c.steps))        throw new Error(`Step[${idx}] if: missing "steps" array`);
    return {
      action:   "if",
      variable: c.variable,
      equals:   c.equals,
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

  throw new Error(
    `Step[${idx}]: unknown action. Supported: navigate, click, fill, assert, api, db, ` +
    `wait_for_element, wait_ms, wait_for_url, store, if, for_each. Got: ${JSON.stringify(raw)}`
  );
}
