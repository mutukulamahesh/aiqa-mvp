import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { APIExecutor } from "../execution/APIExecutor";
import { wwrite } from "../execution/WorkerContext";
import { logger } from "../utils/logger";

/**
 * Checks whether a resolved URL is covered by an allowlist/denylist entry.
 *
 * Uses URL parsing instead of string prefix matching to prevent bypass via
 * crafted hostnames (e.g. "https://internal.api.evil.com" would match a naive
 * startsWith("https://internal.api") check, but not this function).
 *
 * Match rules:
 *   - Protocol must match exactly
 *   - Hostname must match exactly (no subdomain wildcard unless entry uses ".")
 *   - Port must match (empty = scheme default)
 *   - Target path must start with the entry's path (/ matches any path)
 */
function matchesUrlEntry(targetHref: string, entry: string): boolean {
  let target: URL;
  let pattern: URL;
  try { target  = new URL(targetHref); } catch { return false; }
  try { pattern = new URL(entry); }      catch { return false; }

  if (target.protocol !== pattern.protocol) return false;
  if (target.hostname  !== pattern.hostname)  return false;
  if (target.port      !== pattern.port)      return false;

  // "/" matches any path; otherwise target path must start with pattern path segment
  const patPath = pattern.pathname.replace(/\/$/, "") || "/";
  return patPath === "/" ||
    target.pathname === patPath ||
    target.pathname.startsWith(patPath + "/");
}

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

    // SSRF guard — denylist checked first, then allowlist.
    // SECURITY: an empty allowlist means NO external hosts are permitted.
    //           Uses URL-based hostname comparison (not string prefix) so that
    //           "https://internal.api.evil.com" cannot bypass a denylist entry
    //           for "https://internal.api" via shared prefix.
    const apiCfg = ctx.config?.api;
    if (!apiCfg) {
      // No api config section — SSRF allowlist/denylist is inactive.
      // Set api.allowlist / api.denylist in your environment config to restrict outbound calls.
      logger.warn(`[api] SSRF guard inactive — no api config section. URL: ${url}`);
    }
    if (apiCfg) {
      if (apiCfg.denylist.some(entry => matchesUrlEntry(url, entry))) {
        throw new Error(`api step blocked — URL matches denylist: ${url}`);
      }
      if (!apiCfg.allowlist.some(entry => matchesUrlEntry(url, entry))) {
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
