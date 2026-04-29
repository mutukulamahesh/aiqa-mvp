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
    name: string;
    variables?: Record<string, string>;
    steps: RawStep[];
  };
}

export function parseTestFile(filePath: string): TestDefinition {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Test file not found: ${filePath}`);
  }

  const raw = yaml.load(fs.readFileSync(filePath, "utf-8")) as RawTestFile;

  if (!raw?.test) {
    throw new Error(`Invalid test file: missing top-level "test:" key`);
  }
  if (!raw.test.name) {
    throw new Error(`Invalid test file: missing "test.name"`);
  }
  if (!Array.isArray(raw.test.steps) || raw.test.steps.length === 0) {
    throw new Error(`Invalid test file: "test.steps" must be a non-empty array`);
  }

  const steps: StepAction[] = raw.test.steps.map((rawStep, idx) => {
    return parseStep(rawStep as Record<string, unknown>, idx);
  });

  return {
    name: raw.test.name,
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
    if ("value" in assert && typeof assert.value === "string") {
      if (!assert.equals) throw new Error(`Step[${idx}] assert.value: missing "equals"`);
      return { action: "assert", kind: "equals", value: assert.value, equals: assert.equals };
    }
    throw new Error(`Step[${idx}] assert: must have "text", "url", or "value+equals" key`);
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
    `Step[${idx}]: unknown action. Supported: navigate, click, fill, assert, api. Got: ${JSON.stringify(raw)}`
  );
}
