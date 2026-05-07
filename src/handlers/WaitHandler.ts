import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { TransientError } from "../errors";
import { getConfig } from "../config/ConfigLoader";
import { wwrite } from "../execution/WorkerContext";

const FALLBACK_TIMEOUT_MS = 10_000;

/**
 * Resolve the effective timeout for a wait_for_element step.
 *
 * Priority: step.timeout → config.timeouts.action → hardcoded fallback (10 s).
 * timeout: 0 is normalised to 1 ms (an immediate DOM check); Playwright treats
 * 0 as "wait indefinitely", which is never the intended behaviour here.
 */
function resolveWaitTimeout(stepTimeout?: number): number {
  const base = (() => {
    try { return getConfig().timeouts.action; } catch { return FALLBACK_TIMEOUT_MS; }
  })();
  const ms = stepTimeout ?? base;
  return ms === 0 ? 1 : ms;
}

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
      const ms = resolveWaitTimeout(step.timeout);
      wwrite(`  ▶ wait_for_element → ${selector}${step.timeout !== undefined ? `  (timeout: ${ms}ms)` : ""}`);
      await adapter.waitForSelector(selector, ms).catch(() => {
        throw new TransientError(`wait_for_element "${selector}" timed out after ${ms}ms`);
      });
      return;
    }

    if (step.action === "wait_for_url") {
      const url = ctx.resolve(step.url);
      wwrite(`  ▶ wait_for_url → ${url}`);
      await adapter.waitForUrl(url);
    }
  }
}
