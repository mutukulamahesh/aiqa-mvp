import * as path from "path";
import { PlaywrightAdapter } from "../adapter/PlaywrightAdapter";
import { ExecutionContext } from "../execution/ExecutionContext";
import { StepInterpreter } from "../execution/StepInterpreter";
import { workerStorage, wlog, wwrite, WorkerStore } from "../execution/WorkerContext";
import { TestDefinition } from "../dsl/types";
import { DebuggerAgent, DebugResult } from "../agents/DebuggerAgent";
import { getConfig } from "../config/ConfigLoader";
import { AssertionError, TransientError } from "../errors";
import { SelectorHealer } from "../healer/SelectorHealer";

export interface RunnerOptions {
  headless:        boolean;
  slowMo?:         number;
  timeout?:        number;
  screenshotsDir?: string;
}

export interface TestResult {
  testId:       string;
  testName:     string;
  tags:         string[];
  passed:       boolean;
  durationMs:   number;
  retryCount:   number;
  error?:       string;
  stepResults:  StepResult[];
  debugResult?: DebugResult;
}

export interface StepResult {
  index:           number;
  action:          string;
  passed:          boolean;
  durationMs:      number;
  error?:          string;
  errorClass?:     string;
  retryable?:      boolean;
  screenshotPath?: string;
}

// ── Error classifier ─────────────────────────────────────────────────────────

/**
 * Returns true only for transient failures that may succeed on a retry.
 *
 * Classification order:
 *   1. instanceof check — AssertionError (never retry) or TransientError (always retry).
 *      These cover every error our own handlers throw.
 *   2. String fallback — for raw Playwright errors that bubble up unwrapped
 *      (e.g. browserType.launch failures in unusual environments).
 */
export function isRetryable(err: Error): boolean {
  if (err instanceof AssertionError) return false;
  if (err instanceof TransientError)  return true;

  // Fallback for any raw Playwright error not yet wrapped
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout")    ||
    msg.includes("net::err")   ||
    msg.includes("navigation failed")
  );
}

// ── TestRunner ───────────────────────────────────────────────────────────────

export class TestRunner {
  private readonly interpreter = new StepInterpreter();
  private readonly debugger    = new DebuggerAgent();
  private readonly healer      = new SelectorHealer();

  constructor(private readonly opts: RunnerOptions) {}

  /** Returns the healer's activity report for the current runner session. */
  getHealerReport(): string {
    return this.healer.getReport();
  }

  /**
   * Public entry point.
   * Wraps execution in AsyncLocalStorage so all output is buffered per-test
   * and flushed atomically — no interleaving under parallel runs.
   */
  async run(test: TestDefinition): Promise<TestResult> {
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store: WorkerStore = { testId, testName: test.name, logs: [] };

    const result = await workerStorage.run(store, () => this._runWithRetry(test, testId));

    if (store.logs.length) {
      process.stdout.write(store.logs.join(""));
      store.logs = [];
    }

    return result;
  }

  // ── Retry wrapper ─────────────────────────────────────────────────────────

  private async _runWithRetry(test: TestDefinition, testId: string): Promise<TestResult> {
    const maxRetries = test.retries ?? 0;

    wlog(`\n📋 Test: "${test.name}"  [id: ${testId}]`);
    wlog(`   Steps: ${test.steps.length}`);
    if (test.tags?.length)   wlog(`   Tags:  [${test.tags.join(", ")}]`);
    if (maxRetries > 0)      wlog(`   Retry: up to ${maxRetries}x on transient failures`);
    if (test.variables && Object.keys(test.variables).length)
                             wlog(`   Vars:  ${JSON.stringify(test.variables)}`);
    wlog("");

    let lastResult!: TestResult;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResult = await this._attempt(test, testId, attempt);

      if (lastResult.passed) return lastResult;

      const failedStep = lastResult.stepResults.find(s => !s.passed);

      // Non-retryable error or no retries left — return immediately
      if (!failedStep?.error || !failedStep.retryable || attempt === maxRetries) {
        return lastResult;
      }

      // Retryable — log and loop
      const firstLine    = failedStep.error.split("\n")[0];
      const errorLabel   = failedStep.errorClass ? `${failedStep.errorClass}: ${firstLine}` : firstLine;
      wlog(`\n  ↺ retry ${attempt + 1}/${maxRetries} (${errorLabel}) — step ${failedStep.index + 1}`);
      wlog("");
    }

    return lastResult;
  }

  // ── Single attempt ────────────────────────────────────────────────────────

  private async _attempt(test: TestDefinition, testId: string, attempt: number): Promise<TestResult> {
    let config;
    try { config = getConfig(); } catch { config = null; }

    const timeout = this.opts.timeout ?? config?.timeouts.action ?? 15_000;

    const adapter = new PlaywrightAdapter({
      headless: this.opts.headless,
      slowMo:   this.opts.slowMo ?? 0,
      timeout,
      healer:   this.healer,
    });

    const ctx        = new ExecutionContext(test.variables ?? {}, config);
    const stepResults: StepResult[] = [];
    const totalStart = Date.now();

    try {
      for (let i = 0; i < test.steps.length; i++) {
        const step      = test.steps[i];
        const stepStart = Date.now();
        const label     = `[${i + 1}/${test.steps.length}]`;

        wwrite(`${label} `);

        try {
          await this.interpreter.execute(step, adapter, ctx);
          wlog("");
          stepResults.push({ index: i, action: step.action, passed: true, durationMs: Date.now() - stepStart });

        } catch (err) {
          const error     = err as Error;
          const msg       = error.message;
          const retryable = isRetryable(error);
          wlog(`\n  ✗ FAILED: ${msg}`);

          const debugResult = await this.debugger.analyze({
            test_name:     test.name,
            step_action:   step.action,
            step_index:    i,
            error_message: msg,
          });
          wlog(`  🔍 [${debugResult.failure_class}] ${debugResult.suggested_fix}`);

          let screenshotPath: string | undefined;
          if (this.opts.screenshotsDir) {
            const safeName = test.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
            const attemptSuffix = attempt > 0 ? `-attempt${attempt + 1}` : "";
            screenshotPath = path.join(
              this.opts.screenshotsDir,
              `${safeName}-${testId}${attemptSuffix}-step-${i + 1}-fail.png`
            );
            await adapter.screenshot(screenshotPath).catch(() => { screenshotPath = undefined; });
            if (screenshotPath) wlog(`  📸 Screenshot → ${screenshotPath}`);
          }

          stepResults.push({
            index: i, action: step.action, passed: false,
            durationMs: Date.now() - stepStart, error: msg, errorClass: error.name, retryable, screenshotPath,
          });

          return {
            testId,
            testName:   test.name,
            tags:       test.tags ?? [],
            passed:     false,
            durationMs: Date.now() - totalStart,
            retryCount: attempt,
            error:      `Step ${i + 1} (${step.action}) failed: ${msg}`,
            stepResults,
            debugResult,
          };
        }
      }

      return {
        testId,
        testName:   test.name,
        tags:       test.tags ?? [],
        passed:     true,
        durationMs: Date.now() - totalStart,
        retryCount: attempt,
        stepResults,
      };

    } finally {
      await adapter.close();
    }
  }
}
