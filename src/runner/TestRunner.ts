import * as path from "path";
import { PlaywrightAdapter } from "../adapter/PlaywrightAdapter";
import { ExecutionContext } from "../execution/ExecutionContext";
import { StepInterpreter } from "../execution/StepInterpreter";
import { workerStorage, wlog, wwrite, WorkerStore } from "../execution/WorkerContext";
import { TestDefinition } from "../dsl/types";
import { DebuggerAgent, DebugResult } from "../agents/DebuggerAgent";
import { getConfig } from "../config/ConfigLoader";

export interface RunnerOptions {
  headless:        boolean;
  slowMo?:         number;
  timeout?:        number;
  screenshotsDir?: string;
}

export interface TestResult {
  testId:      string;
  testName:    string;
  tags:        string[];
  passed:      boolean;
  durationMs:  number;
  error?:      string;
  stepResults: StepResult[];
  debugResult?: DebugResult;
}

export interface StepResult {
  index:          number;
  action:         string;
  passed:         boolean;
  durationMs:     number;
  error?:         string;
  screenshotPath?: string;
}

export class TestRunner {
  private readonly interpreter = new StepInterpreter();
  private readonly debugger    = new DebuggerAgent();

  constructor(private readonly opts: RunnerOptions) {}

  /**
   * Public entry point.
   * Wraps the run in an AsyncLocalStorage worker context so all output is
   * buffered per-test and flushed atomically — no interleaving under parallel execution.
   */
  async run(test: TestDefinition): Promise<TestResult> {
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store: WorkerStore = { testId, testName: test.name, logs: [] };

    const result = await workerStorage.run(store, () => this._run(test, testId));

    // Atomic flush — workerStorage context has ended so we flush via the store
    // reference directly, guaranteeing all lines for this test arrive together.
    if (store.logs.length) {
      process.stdout.write(store.logs.join(""));
      store.logs = [];
    }

    return result;
  }

  // ── Internal run (always called inside a WorkerStore context) ──────────────

  private async _run(test: TestDefinition, testId: string): Promise<TestResult> {
    let config;
    try { config = getConfig(); } catch { config = null; }

    const timeout = this.opts.timeout ?? config?.timeouts.action ?? 15_000;

    const adapter = new PlaywrightAdapter({
      headless: this.opts.headless,
      slowMo:   this.opts.slowMo ?? 0,
      timeout,
    });

    const ctx          = new ExecutionContext(test.variables ?? {}, config);
    const stepResults: StepResult[] = [];
    const totalStart   = Date.now();

    wlog(`\n📋 Test: "${test.name}"  [id: ${testId}]`);
    wlog(`   Steps: ${test.steps.length}`);
    if (test.tags?.length)                                     wlog(`   Tags:  [${test.tags.join(", ")}]`);
    if (test.variables && Object.keys(test.variables).length)  wlog(`   Vars:  ${JSON.stringify(test.variables)}`);
    wlog("");

    try {
      for (let i = 0; i < test.steps.length; i++) {
        const step      = test.steps[i];
        const stepStart = Date.now();
        const label     = `[${i + 1}/${test.steps.length}]`;

        wwrite(`${label} `);

        try {
          await this.interpreter.execute(step, adapter, ctx);
          wlog("");   // newline after the handler's inline output
          stepResults.push({ index: i, action: step.action, passed: true, durationMs: Date.now() - stepStart });

        } catch (err) {
          const msg = (err as Error).message;
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
            screenshotPath = path.join(this.opts.screenshotsDir, `${safeName}-${testId}-step-${i + 1}-fail.png`);
            await adapter.screenshot(screenshotPath).catch(() => { screenshotPath = undefined; });
            if (screenshotPath) wlog(`  📸 Screenshot → ${screenshotPath}`);
          }

          stepResults.push({
            index: i, action: step.action, passed: false,
            durationMs: Date.now() - stepStart, error: msg, screenshotPath,
          });

          return {
            testId,
            testName:   test.name,
            tags:       test.tags ?? [],
            passed:     false,
            durationMs: Date.now() - totalStart,
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
        stepResults,
      };

    } finally {
      await adapter.close();
    }
  }
}
