/**
 * TestRunner — orchestrates a full test run end-to-end.
 *
 * Flow:
 *   1. Launch PlaywrightAdapter
 *   2. Build ExecutionContext with test variables
 *   3. Feed each step into StepInterpreter
 *   4. Collect pass/fail result
 *   5. Close the browser
 */
import { PlaywrightAdapter } from "../adapter/PlaywrightAdapter";
import { ExecutionContext } from "../execution/ExecutionContext";
import { StepInterpreter } from "../execution/StepInterpreter";
import { TestDefinition } from "../dsl/types";

export interface RunnerOptions {
  headless: boolean;
  slowMo?: number;
  timeout?: number;
}

export interface TestResult {
  testName: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  stepResults: StepResult[];
}

export interface StepResult {
  index: number;
  action: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export class TestRunner {
  private interpreter = new StepInterpreter();

  constructor(private opts: RunnerOptions) {}

  async run(test: TestDefinition): Promise<TestResult> {
    const adapter = new PlaywrightAdapter({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo ?? 0,
      timeout: this.opts.timeout ?? 15_000,
    });

    const ctx = new ExecutionContext(test.variables ?? {});
    const stepResults: StepResult[] = [];
    const totalStart = Date.now();

    console.log(`📋 Test: "${test.name}"`);
    console.log(`   Steps: ${test.steps.length}`);

    if (test.variables && Object.keys(test.variables).length > 0) {
      console.log(`   Vars:  ${JSON.stringify(test.variables)}`);
    }
    console.log();

    try {
      await adapter.launch();

      for (let i = 0; i < test.steps.length; i++) {
        const step = test.steps[i];
        const stepStart = Date.now();
        const label = `[${i + 1}/${test.steps.length}]`;

        process.stdout.write(`${label} `);

        try {
          await this.interpreter.execute(step, adapter, ctx);
          stepResults.push({
            index: i,
            action: step.action,
            passed: true,
            durationMs: Date.now() - stepStart,
          });
        } catch (err) {
          const msg = (err as Error).message;
          console.log(`\n  ✗ FAILED: ${msg}`);
          stepResults.push({
            index: i,
            action: step.action,
            passed: false,
            durationMs: Date.now() - stepStart,
            error: msg,
          });

          // Stop on first failure (MVP: no retry logic)
          return {
            testName: test.name,
            passed: false,
            durationMs: Date.now() - totalStart,
            error: `Step ${i + 1} (${step.action}) failed: ${msg}`,
            stepResults,
          };
        }
      }

      return {
        testName: test.name,
        passed: true,
        durationMs: Date.now() - totalStart,
        stepResults,
      };
    } finally {
      await adapter.close();
    }
  }
}
