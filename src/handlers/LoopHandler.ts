import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { wwrite, wlog } from "../execution/WorkerContext";
import { SubStepExecutor } from "./ConditionHandler";

export class LoopHandler implements StepHandler {
  readonly handles = ["for_each"];

  constructor(private readonly executeSubStep: SubStepExecutor) {}

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "for_each") return;

    // Strip {{ }} if present so "{{ orders }}" and "orders" both work
    const varName = step.over.replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, "").trim();
    const list = ctx.get(varName);

    if (!Array.isArray(list)) {
      throw new AssertionError(
        `for_each: "${step.over}" must resolve to an array, got ${list === undefined ? "undefined" : typeof list}`
      );
    }

    wwrite(`  ▶ for_each   → ${list.length} item(s) as "${step.as}"`);

    for (let i = 0; i < list.length; i++) {
      ctx.set(step.as, list[i]);
      wlog(`      ↳ iteration ${i + 1}/${list.length}`);
      for (const subStep of step.steps) {
        await this.executeSubStep(subStep, adapter, ctx);
      }
    }
  }
}
