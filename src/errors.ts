/**
 * Typed error classes for retry classification.
 *
 * AssertionError — deterministic failure; retrying won't change the outcome.
 * TransientError — timing/network failure; may succeed on a fresh attempt.
 *
 * TestRunner.isRetryable() checks instanceof before falling back to string
 * matching (for raw Playwright errors we cannot intercept).
 */

export class AssertionError extends Error {
  readonly kind = "assertion" as const;
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export class TransientError extends Error {
  readonly kind = "transient" as const;
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}
