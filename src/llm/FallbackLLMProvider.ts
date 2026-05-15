import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";
import { logger } from "../utils/logger";

// Transient / capacity HTTP statuses worth retrying on the next provider.
const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Decides whether an error from a provider is transient and should trigger
 * the next provider in the chain.
 *
 * Non-retryable (fail immediately, don't mask with fallback):
 *   • HTTP 4xx except 429  — auth failure, bad request, not found
 *   • "not installed"      — SDK package missing, user config error
 *
 * Retryable (advance to next provider):
 *   • HTTP 429, 5xx        — rate limit / server error
 *   • network / unknown    — connection errors, timeouts
 */
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);

  const match = msg.match(/HTTP (\d{3})/);
  if (match) {
    return RETRYABLE_HTTP.has(parseInt(match[1], 10));
  }
  if (msg.includes("not installed")) return false;
  return true;
}

/**
 * Wraps a chain of LLM providers and tries each in order.
 * Only retryable errors advance the chain; non-retryable errors (bad key,
 * bad request, SDK missing) are re-thrown immediately.
 * Emits a console.warn when a fallback provider is activated so degradation
 * is visible in logs rather than silent.
 */
export class FallbackLLMProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly chain: LLMProvider[]) {
    if (!chain.length) throw new Error("FallbackLLMProvider requires at least one provider");
    this.name = chain.map(p => p.name).join("+");
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const errors: string[] = [];

    for (let i = 0; i < this.chain.length; i++) {
      const provider = this.chain[i];
      try {
        const result = await provider.complete(req);
        if (i > 0) {
          logger.warn(`[LLM] Degraded — primary failed, using fallback: ${provider.name}`);
        }
        return result;
      } catch (err) {
        if (!isRetryableError(err)) throw err;
        errors.push(`[${provider.name}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(
      `All LLM providers failed:\n${errors.map(e => `  • ${e}`).join("\n")}`,
    );
  }
}
