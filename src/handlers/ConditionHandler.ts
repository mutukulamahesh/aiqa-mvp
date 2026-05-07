import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite, wlog } from "../execution/WorkerContext";

export type SubStepExecutor = (
  step: StepAction,
  adapter: AdapterActions,
  ctx: ExecutionContext,
) => Promise<void>;

export class ConditionHandler implements StepHandler {
  readonly handles = ["if"];

  constructor(private readonly executeSubStep: SubStepExecutor) {}

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "if") return;

    const actual   = ctx.resolve(step.variable);
    const expected = ctx.resolve(step.equals);
    const matched  = actual === expected;

    wwrite(`  ▶ if         → "${actual}" === "${expected}" → ${matched}`);

    if (matched) {
      wlog(`      ↳ condition true — running ${step.steps.length} sub-step(s)`);
      for (const subStep of step.steps) {
        await this.executeSubStep(subStep, adapter, ctx);
      }
    } else {
      wlog(`      ↳ condition false — skipped`);
    }
  }
}
