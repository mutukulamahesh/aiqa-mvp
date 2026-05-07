import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite } from "../execution/WorkerContext";

export class StoreHandler implements StepHandler {
  readonly handles = ["store"];

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "store") return;

    const selector = ctx.resolve(step.selector);
    const value = step.attribute && step.attribute !== "text"
      ? await adapter.getElementAttribute(selector, step.attribute)
      : await adapter.getElementText(selector);

    ctx.set(step.as, value);
    const preview = value.slice(0, 60) + (value.length > 60 ? "…" : "");
    wwrite(`  ▶ store      → "${step.as}" = "${preview}"`);
  }
}
