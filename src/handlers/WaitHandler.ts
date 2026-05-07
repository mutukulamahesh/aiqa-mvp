import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite } from "../execution/WorkerContext";

export class WaitHandler implements StepHandler {
  readonly handles = ["wait_for_element", "wait_ms", "wait_for_url"];

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action === "wait_ms") {
      wwrite(`  ▶ wait_ms   → ${step.ms}ms`);
      await new Promise(r => setTimeout(r, step.ms));
      return;
    }

    if (step.action === "wait_for_element") {
      const selector = ctx.resolve(step.selector);
      wwrite(`  ▶ wait_for_element → ${selector}`);
      await adapter.waitForSelector(selector);
      return;
    }

    if (step.action === "wait_for_url") {
      const url = ctx.resolve(step.url);
      wwrite(`  ▶ wait_for_url → ${url}`);
      await adapter.waitForUrl(url);
    }
  }
}
