/**
 * UIActionHandler — handles navigate, click, fill steps.
 */
import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite } from "../execution/WorkerContext";

export class UIActionHandler implements StepHandler {
  readonly handles = ["navigate", "click", "fill"];

  async execute(
    step: StepAction,
    adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    switch (step.action) {
      case "navigate": {
        const url = ctx.resolve(step.target);
        wwrite(`  ▶ navigate  → ${url}`);
        await adapter.navigate(url);
        // Read back the actual landed URL (may differ from requested due to redirects)
        ctx.setCurrentUrl(await adapter.currentUrl());
        break;
      }

      case "click": {
        const target = ctx.resolve(step.target);
        wwrite(`  ▶ click     → "${target}"`);
        await adapter.click(target);
        break;
      }

      case "fill": {
        const target = ctx.resolve(step.target);
        const value  = ctx.resolve(step.value);
        wwrite(`  ▶ fill      → "${target}" = "${value}"`);
        await adapter.fill(target, value);
        break;
      }
    }
  }
}
