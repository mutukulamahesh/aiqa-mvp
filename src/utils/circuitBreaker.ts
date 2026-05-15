/**
 * Simple half-open circuit breaker for LLM / external API calls.
 *
 * States:
 *   closed  — calls pass through normally
 *   open    — calls are rejected immediately (fast-fail)
 *   half-open — one probe call is allowed; success → closed, failure → open
 *
 * Thresholds configurable via env vars:
 *   AIQA_CB_FAILURE_THRESHOLD  (default: 5)   consecutive failures to trip
 *   AIQA_CB_RESET_MS           (default: 30000) ms before moving to half-open
 */

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state:     CircuitState = "closed";
  private failures   = 0;
  private openedAt   = 0;

  constructor(
    readonly name:             string,
    private failureThreshold = parseInt(process.env.AIQA_CB_FAILURE_THRESHOLD ?? "5"),
    private resetMs          = parseInt(process.env.AIQA_CB_RESET_MS ?? "30000"),
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.resetMs) {
        this.state = "half-open";
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — service temporarily unavailable`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state    = "closed";
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state    = "open";
      this.openedAt = Date.now();
      process.stderr.write(
        `[CircuitBreaker] [${this.name}] tripped OPEN after ${this.failures} failure(s). ` +
        `Will probe again in ${this.resetMs / 1000}s.\n`,
      );
    }
  }

  getState(): CircuitState { return this.state; }
  getFailures(): number    { return this.failures; }
}

// Singleton per named service — shared across all LLM calls in the process
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string): CircuitBreaker {
  if (!breakers.has(name)) breakers.set(name, new CircuitBreaker(name));
  return breakers.get(name)!;
}
