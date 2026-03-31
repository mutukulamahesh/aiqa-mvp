/**
 * DslParser — reads a YAML test file and converts it to a TestDefinition.
 *
 * Supported YAML shape:
 *
 * test:
 *   name: my test
 *   variables:
 *     base_url: https://example.com
 *   steps:
 *     - navigate: https://example.com
 *     - click: "More information"
 *     - fill:
 *         target: "#search"
 *         value: "hello"
 *     - assert:
 *         text: "Example Domain"
 *     - assert:
 *         url: "example.com"
 */
import * as fs from "fs";
import * as yaml from "js-yaml";
import { TestDefinition, StepAction } from "./types";

// Raw YAML shapes (what js-yaml returns before we normalize)
type RawStep =
  | string                                             // e.g. "navigate: https://..."  — scalar form not used
  | { navigate: string }
  | { click: string }
  | { fill: { target: string; value: string } | string }
  | { assert: { text?: string; url?: string } }
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

  // assert — two sub-forms: text or url
  if ("assert" in raw) {
    const assert = raw.assert as Record<string, string> | undefined;
    if (!assert) throw new Error(`Step[${idx}] assert: empty`);

    if ("text" in assert && typeof assert.text === "string") {
      return { action: "assert", kind: "text", value: assert.text };
    }
    if ("url" in assert && typeof assert.url === "string") {
      return { action: "assert", kind: "url", value: assert.url };
    }
    throw new Error(`Step[${idx}] assert: must have "text" or "url" key`);
  }

  throw new Error(
    `Step[${idx}]: unknown action. Supported: navigate, click, fill, assert. Got: ${JSON.stringify(raw)}`
  );
}
