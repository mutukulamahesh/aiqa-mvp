import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { APIExecutor } from "../execution/APIExecutor";
import { wwrite } from "../execution/WorkerContext";

/** Recursively resolve {{ }} templates in string leaves of an object/array tree. */
function resolveBody(val: unknown, ctx: ExecutionContext): unknown {
  if (typeof val === "string")  return ctx.resolve(val);
  if (Array.isArray(val))       return val.map(v => resolveBody(v, ctx));
  if (val && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, resolveBody(v, ctx)])
    );
  }
  return val;
}

export class APIActionHandler implements StepHandler {
  readonly handles = ["api"];
  private executor = new APIExecutor();

  async execute(
    step: StepAction,
    _adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    if (step.action !== "api") return;

    const url    = ctx.resolve(step.url);
    const method = step.method.toUpperCase();
    const body   = step.body != null ? resolveBody(step.body, ctx) : undefined;

    // SSRF guard — denylist checked first, then allowlist (empty allowlist = allow all)
    const apiCfg = ctx.config?.api;
    if (apiCfg) {
      if (apiCfg.denylist.some(prefix => url.startsWith(prefix))) {
        throw new Error(`api step blocked — URL matches denylist: ${url}`);
      }
      if (apiCfg.allowlist.length > 0 && !apiCfg.allowlist.some(prefix => url.startsWith(prefix))) {
        throw new Error(`api step blocked — URL not in allowlist: ${url}`);
      }
    }

    wwrite(`  ▶ api       → ${method} ${url}`);

    const result = await this.executor.call({
      method,
      url,
      headers:       step.headers,
      body,
      assert_status: step.assert_status,
    });

    wwrite(`      ↳ HTTP ${result.status} (${result.duration_ms}ms)`);

    if (step.store_as) {
      ctx.set(step.store_as, result.data);
      wwrite(`      ↳ stored as "${step.store_as}"`);
    }
  }
}
