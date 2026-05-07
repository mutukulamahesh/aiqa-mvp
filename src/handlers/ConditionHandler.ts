import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction, IfOperator } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite, wlog } from "../execution/WorkerContext";

export type SubStepExecutor = (
  step: StepAction,
  adapter: AdapterActions,
  ctx: ExecutionContext,
) => Promise<void>;

function evalCondition(actual: string, operator: IfOperator, operand: string): boolean {
  switch (operator) {
    case "equals":     return actual === operand;
    case "not_equals": return actual !== operand;
    case "contains":   return actual.includes(operand);
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const a = parseFloat(actual);
      const b = parseFloat(operand);
      if (isNaN(a)) throw new Error(`if: operator "${operator}" requires a numeric value, got "${actual}"`);
      if (isNaN(b)) throw new Error(`if: operator "${operator}" requires a numeric operand, got "${operand}"`);
      if (operator === "gt")  return a > b;
      if (operator === "lt")  return a < b;
      if (operator === "gte") return a >= b;
      return a <= b;
    }
  }
}

export class ConditionHandler implements StepHandler {
  readonly handles = ["if"];

  constructor(private readonly executeSubStep: SubStepExecutor) {}

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "if") return;

    const actual  = ctx.resolve(step.variable);
    const operand = ctx.resolve(step.operand);
    const matched = evalCondition(actual, step.operator, operand);

    wwrite(`  ▶ if         → "${actual}" ${step.operator} "${operand}" → ${matched}`);

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
