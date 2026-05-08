import * as path from "path";
import { PlaywrightAdapter } from "../adapter/PlaywrightAdapter";
import { ExecutionContext } from "../execution/ExecutionContext";
import { StepInterpreter } from "../execution/StepInterpreter";
import { workerStorage, wlog, wwrite, WorkerStore } from "../execution/WorkerContext";
import { TestDefinition, StepAction } from "../dsl/types";
import { RunEvent } from "./RunEvent";
export type { RunEvent } from "./RunEvent";
export type { RunSummary } from "./RunEvent";
import { DebuggerAgent, DebugResult } from "../agents/DebuggerAgent";
import { getConfig } from "../config/ConfigLoader";
import { AssertionError, TransientError } from "../errors";
import { SelectorHealer } from "../healer/SelectorHealer";
import { MemoryStore, makeStepKey } from "../memory/MemoryStore";

export interface RunnerOptions {
  headless:        boolean;
  slowMo?:         number;
  timeout?:        number;
  screenshotsDir?: string;
  healer?:         SelectorHealer;
  memory?:         MemoryStore;
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

// ── Step target extractor (for RunEvent "target" field) ──────────────────────

function stepTarget(step: StepAction): string | undefined {
  if ("target"   in step) return step.target;
  if ("selector" in step) return (step as { selector: string }).selector;
  if ("url"      in step) return (step as { url: string }).url;
  if ("ms"       in step) return `${(step as { ms: number }).ms}ms`;
  return undefined;
}

// ── TestRunner ───────────────────────────────────────────────────────────────

export class TestRunner {
  private readonly interpreter = new StepInterpreter();
  private readonly debugger    = new DebuggerAgent();
  private readonly healer:  SelectorHealer;
  private readonly memory?: MemoryStore;

  constructor(private readonly opts: RunnerOptions) {
    this.healer = opts.healer ?? new SelectorHealer();
    this.memory = opts.memory;
  }

  /** Returns the healer's activity report for the current runner session. */
  getHealerReport(): string {
    return this.healer.getReport();
  }

  /**
   * Public entry point.
   * Wraps execution in AsyncLocalStorage so all output is buffered per-test
   * and flushed atomically — no interleaving under parallel runs.
   * When onEvent is provided (API mode) logs are streamed in real time and
   * NOT flushed to stdout — the caller owns the output channel.
   */
  async run(test: TestDefinition, onEvent?: (e: RunEvent) => void): Promise<TestResult> {
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store: WorkerStore = { testId, testName: test.name, logs: [], onEvent };

    try {
      const result = await workerStorage.run(store, () => this._runWithRetry(test, testId));
      return result;
    } finally {
      if (!onEvent && store.logs.length) {
        process.stdout.write(store.logs.join(""));
        store.logs = [];
      }
      await this.interpreter.teardown();
    }
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

      if (this.memory) {
        const stepKey = makeStepKey(test.name, failedStep.index, failedStep.action);
        const extraMs = this.memory.extraWaitMs(stepKey);
        if (extraMs > 0) {
          const score = this.memory.getScore(stepKey).toFixed(2);
          wlog(`  ⏳ Flaky step detected (score: ${score}) — extra wait ${extraMs}ms before retry`);
          await new Promise(r => setTimeout(r, extraMs));
        }
      }
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
      const onEvent = workerStorage.getStore()?.onEvent;

      for (let i = 0; i < test.steps.length; i++) {
        const step      = test.steps[i];
        const stepStart = Date.now();
        const label     = `[${i + 1}/${test.steps.length}]`;

        onEvent?.({ event: "step", index: i, action: step.action, target: stepTarget(step) });
        wwrite(`${label} `);

        try {
          await this.interpreter.execute(step, adapter, ctx);
          wlog("");
          this.memory?.recordOutcome(makeStepKey(test.name, i, step.action), true);
          const durationMs = Date.now() - stepStart;
          onEvent?.({ event: "step_result", index: i, passed: true, durationMs });
          stepResults.push({ index: i, action: step.action, passed: true, durationMs });

        } catch (err) {
          const error     = err as Error;
          const msg       = error.message;
          const retryable = isRetryable(error);
          wlog(`\n  ✗ FAILED: ${msg}`);

          const stepKey   = makeStepKey(test.name, i, step.action);
          this.memory?.recordOutcome(stepKey, false);

          const debugResult = await this.debugger.analyze(
            { test_name: test.name, step_action: step.action, step_index: i, error_message: msg },
            this.memory ? { memory: this.memory, stepKey } : undefined,
          );
          const memBadge = debugResult.from_memory ? " [memory]" : "";
          wlog(`  🔍 [${debugResult.failure_class}]${memBadge} ${debugResult.suggested_fix}`);

          let screenshotPath: string | undefined;
          let screenshotUrl: string | undefined;
          if (this.opts.screenshotsDir) {
            const safeName = test.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
            const attemptSuffix = attempt > 0 ? `-attempt${attempt + 1}` : "";
            const fileName = `${safeName}-${testId}${attemptSuffix}-step-${i + 1}-fail.png`;
            screenshotPath = path.join(this.opts.screenshotsDir, fileName);
            await adapter.screenshot(screenshotPath).catch(() => { screenshotPath = undefined; });
            if (screenshotPath) {
              wlog(`  📸 Screenshot → ${screenshotPath}`);
              // Derive a URL-style path relative to the run's screenshots dir
              screenshotUrl = fileName;
            }
          }

          const durationMs = Date.now() - stepStart;
          onEvent?.({ event: "step_result", index: i, passed: false, durationMs, error: msg, screenshotUrl });

          stepResults.push({
            index: i, action: step.action, passed: false,
            durationMs, error: msg, errorClass: error.name, retryable, screenshotPath,
          });

          const result: TestResult = {
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
          onEvent?.({ event: "test_done", testName: test.name, passed: false, durationMs: result.durationMs });
          return result;
        }
      }

      const totalDurationMs = Date.now() - totalStart;
      onEvent?.({ event: "test_done", testName: test.name, passed: true, durationMs: totalDurationMs });
      return {
        testId,
        testName:   test.name,
        tags:       test.tags ?? [],
        passed:     true,
        durationMs: totalDurationMs,
        retryCount: attempt,
        stepResults,
      };

    } finally {
      await adapter.close();
    }
  }
}
