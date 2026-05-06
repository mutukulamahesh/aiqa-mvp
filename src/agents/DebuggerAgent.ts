import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { MemoryStore } from "../memory/MemoryStore";
import { FailureClass, DebugParams, DebugResult } from "./types";

export type { FailureClass, DebugParams, DebugResult };

const SYSTEM_PROMPT =
  "You are a QA failure analysis expert. " +
  "Analyse the test failure and return ONLY a JSON object with keys: " +
  "failure_class (one of: locator_failure, timing_issue, assertion_failure, api_failure, network_error, unknown), " +
  "root_cause (string), suggested_fix (string), confidence (0-1 number).";

export interface MemoryContext {
  memory:  MemoryStore;
  stepKey: string;
}

export class DebuggerAgent {
  private llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  async analyze(params: DebugParams, memCtx?: MemoryContext): Promise<DebugResult> {
    // Return cached diagnosis if available — skips LLM call entirely.
    if (memCtx) {
      const known = memCtx.memory.getKnownPattern(memCtx.stepKey);
      if (known) {
        return {
          failure_class: known.failureClass as FailureClass,
          root_cause:    known.rootCause,
          suggested_fix: known.suggestedFix,
          confidence:    0.9,
          from_mock:     false,
          from_memory:   true,
        };
      }
    }

    const userMessage =
      `Test: ${params.test_name}\n` +
      `Step ${params.step_index + 1} (${params.step_action})\n` +
      `Error: ${params.error_message}`;

    let result: DebugResult;
    try {
      const res = await this.llm.complete({
        system:     SYSTEM_PROMPT,
        userMessage,
        maxTokens:  256,
      });

      const parsed = JSON.parse(res.content) as {
        failure_class: FailureClass;
        root_cause:    string;
        suggested_fix: string;
        confidence:    number;
      };

      result = {
        failure_class: parsed.failure_class ?? "unknown",
        root_cause:    parsed.root_cause    ?? "Unknown error",
        suggested_fix: parsed.suggested_fix ?? "Review the error message.",
        confidence:    parsed.confidence    ?? 0.5,
        from_mock:     this.llm.name === "mock",
      };
    } catch {
      result = this.heuristicFallback(params);
    }

    // Cache the diagnosis so identical future failures skip the LLM call.
    if (memCtx) {
      memCtx.memory.storePattern(memCtx.stepKey, {
        failureClass: result.failure_class,
        rootCause:    result.root_cause,
        suggestedFix: result.suggested_fix,
      });
      memCtx.memory.save();
    }

    return result;
  }

  // Pure heuristic fallback — always works, no external calls
  private heuristicFallback(params: DebugParams): DebugResult {
    const msg = params.error_message.toLowerCase();

    if (msg.includes("could not resolve locator") || msg.includes("not found on page")) {
      return {
        failure_class: "locator_failure",
        root_cause:    "Element could not be located on the page.",
        suggested_fix: "Verify the text or selector matches what is rendered. Use a CSS selector for brittle dynamic elements.",
        confidence:    0.8,
        from_mock:     true,
      };
    }
    if (msg.includes("timeout") && !msg.includes("http")) {
      return {
        failure_class: "timing_issue",
        root_cause:    "Action timed out waiting for the element or page.",
        suggested_fix: "Add a wait step before this action or increase the timeout in runner options.",
        confidence:    0.8,
        from_mock:     true,
      };
    }
    if ((msg.includes("expected") && msg.includes("got")) || msg.includes("assertequals")) {
      return {
        failure_class: "assertion_failure",
        root_cause:    "Actual value did not match expected value.",
        suggested_fix: "Check for casing, whitespace, or data differences between test expectation and application state.",
        confidence:    0.85,
        from_mock:     true,
      };
    }
    if (msg.includes("expected http") || msg.includes("status")) {
      return {
        failure_class: "api_failure",
        root_cause:    "API returned an unexpected HTTP status code.",
        suggested_fix: "Verify the endpoint URL, request body, and auth headers.",
        confidence:    0.8,
        from_mock:     true,
      };
    }
    if (msg.includes("econnrefused") || msg.includes("fetch failed") || msg.includes("timed out after")) {
      return {
        failure_class: "network_error",
        root_cause:    "Request could not reach the server.",
        suggested_fix: "Confirm the base URL is correct and the server is running.",
        confidence:    0.85,
        from_mock:     true,
      };
    }

    return {
      failure_class: "unknown",
      root_cause:    "Could not determine failure cause automatically.",
      suggested_fix: "Review the full error message and check recent application changes.",
      confidence:    0.3,
      from_mock:     true,
    };
  }
}
