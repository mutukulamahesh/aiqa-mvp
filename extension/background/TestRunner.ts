/**
 * TestRunner — executes a parsed TestDefinition step by step via CdpAdapter.
 *
 * Emits StepEvents as execution progresses so the panel can update live.
 * Variable substitution: {{varName}} in target/value strings is replaced from
 * the in-memory vars map, which grows as "store" steps execute.
 */

import { TestDefinition, StepAction } from "../../src/dsl/types";
import { CdpAdapter } from "./CdpAdapter";
import { StepResult, RunStatus, StepEvent } from "../shared/types";

export type { StepEvent };
export type EventCallback = (event: StepEvent) => void;

export class TestRunner {
  constructor(
    private readonly cdp: CdpAdapter,
    private readonly onEvent: EventCallback
  ) {}

  async run(def: TestDefinition): Promise<RunStatus> {
    const results: StepResult[] = [];
    const vars: Record<string, string> = { ...(def.variables ?? {}) };
    let passed = true;

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      const label = describeStep(step);

      this.onEvent({ kind: "step:start", index: i, label });

      try {
        await this.executeStep(step, vars);
        results.push({ index: i, label, status: "passed" });
        this.onEvent({ kind: "step:pass", index: i });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ index: i, label, status: "failed", error });
        this.onEvent({ kind: "step:fail", index: i, error });
        passed = false;
        break;
      }
    }

    // Mark any unexecuted steps (after a failure) as skipped.
    for (let i = results.length; i < def.steps.length; i++) {
      results.push({ index: i, label: describeStep(def.steps[i]), status: "skipped" });
    }

    const status: RunStatus = passed ? "passed" : "failed";
    this.onEvent({ kind: "run:done", status, steps: results });
    return status;
  }

  private async executeStep(
    step: StepAction,
    vars: Record<string, string>
  ): Promise<void> {
    const sub = (s: string) =>
      s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

    switch (step.action) {
      case "navigate":
        await this.cdp.navigate(sub(step.target));
        break;

      case "click":
        await this.cdp.click(sub(step.target));
        break;

      case "fill":
        await this.cdp.fill(sub(step.target), sub(step.value));
        break;

      case "assert":
        switch (step.kind) {
          case "text":
            await this.cdp.assertText(sub(step.value));
            break;
          case "url":
            await this.cdp.assertUrl(sub(step.value));
            break;
          case "visible":
            await this.cdp.assertVisible(sub(step.value));
            break;
          case "equals": {
            const actual   = sub(step.value);
            const expected = sub(step.equals);
            if (actual !== expected) {
              throw new Error(
                `assert equals: "${actual}" !== "${expected}"`
              );
            }
            break;
          }
        }
        break;

      case "wait_for_element":
        await this.cdp.waitForElement(sub(step.selector), step.timeout);
        break;

      case "wait_ms":
        await this.cdp.waitMs(step.ms);
        break;

      case "store": {
        const value = await this.cdp.storeValue(
          sub(step.selector),
          step.attribute
        );
        vars[step.as] = value;
        break;
      }

      // Phase 2 / 3 — not yet implemented; skip with a warning.
      case "if":
      case "for_each":
      case "api":
      case "db":
      case "judge":
        console.warn(`AIQA: step "${step.action}" is not implemented — skipping`);
        break;
    }
  }
}

function describeStep(step: StepAction): string {
  switch (step.action) {
    case "navigate":         return `navigate: ${step.target}`;
    case "click":            return `click: ${step.target}`;
    case "fill":             return `fill: ${step.target}`;
    case "assert":           return `assert ${step.kind}: ${step.value}`;
    case "wait_for_element": return `wait for element: ${step.selector}`;
    case "wait_ms":          return `wait ${step.ms}ms`;
    case "store":            return `store: ${step.selector} → ${step.as}`;
    case "if":               return `if: {{${step.variable}}}`;
    case "for_each":         return `for each: {{${step.over}}}`;
    case "api":              return `api: ${step.method} ${step.url}`;
    case "db":               return `db: ${step.query.slice(0, 40)}`;
    case "judge":            return `judge: ${step.prompt.slice(0, 40)}`;
    default:                 return (step as StepAction).action;
  }
}
