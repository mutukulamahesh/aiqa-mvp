import { StepHandler }      from "../execution/HandlerRegistry";
import { StepAction }       from "../dsl/types";
import { ExecutionContext }  from "../execution/ExecutionContext";
import { AdapterActions }   from "../adapter/AdapterActions";
import { AssertionError }   from "../errors";
import { wwrite }           from "../execution/WorkerContext";
import { VisualRegression } from "../vision/VisualRegression";

export class VisualSnapshotHandler implements StepHandler {
  readonly handles = ["visual_snapshot"];

  private readonly regression: VisualRegression;

  constructor(dir?: string) {
    this.regression = new VisualRegression(dir);
  }

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "visual_snapshot") return;

    const name   = ctx.resolve(step.name);
    const update = step.update ?? false;
    const source = { screenshotBuffer: () => adapter.screenshotBuffer() };

    // Record mode — capture or overwrite baseline
    if (update) {
      await this.regression.snapshot(name, source, { update: true });
      wwrite(`[visual] baseline updated: "${name}"`);
      if (step.store_as) ctx.set(step.store_as, { match: true, diffPercent: 0 });
      return;
    }

    // Compare mode
    const result = await this.regression.compare(name, source, {
      max_diff_percent: step.max_diff_percent,
      sensitivity:      step.sensitivity,
    });

    const pct = result.diffPercent.toFixed(2);
    wwrite(`[visual] "${name}" diff=${pct}% ${result.match ? "✓ match" : "✗ FAIL"}`);

    if (step.store_as) ctx.set(step.store_as, result);

    if (!result.match) {
      throw new AssertionError(
        `visual_snapshot: "${name}" differs by ${pct}% ` +
        `(max allowed: ${((step.max_diff_percent ?? 0.02) * 100).toFixed(1)}%)` +
        (result.diffPath ? ` — diff saved to ${result.diffPath}` : ""),
      );
    }
  }
}
