import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

/**
 * Rule-based mock LLM provider.
 * Produces deterministic structured responses using keyword matching and
 * templates — no API key required.  Swap for AnthropicLLMProvider to get
 * real LLM quality without changing any agent code.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const sys = req.system.toLowerCase();

    if (sys.includes("debug") || sys.includes("failure analysis")) {
      return { content: this.handleDebug(req.userMessage), model: this.name };
    }
    if (sys.includes("user flow") || sys.includes("journey")) {
      return { content: this.handleFlowMapping(req.userMessage), model: this.name };
    }
    if (sys.includes("yaml") || sys.includes("test scenario")) {
      return { content: this.handleScenarioGen(req.userMessage), model: this.name };
    }
    if (sys.includes("evaluation judge")) {
      return { content: this.handleJudge(req.userMessage), model: this.name };
    }

    return { content: JSON.stringify({ result: "mock" }), model: this.name };
  }

  // ── Debug handler ────────────────────────────────────────────────────────

  private handleDebug(message: string): string {
    const msg = message.toLowerCase();

    type FailureClass =
      | "locator_failure" | "timing_issue" | "assertion_failure"
      | "api_failure"     | "network_error" | "unknown";

    let failure_class: FailureClass = "unknown";
    let root_cause = "An unexpected error occurred during test execution.";
    let suggested_fix = "Review the full error message and stack trace for more detail.";

    if (msg.includes("could not resolve locator") || msg.includes("not found") || msg.includes("locator")) {
      failure_class  = "locator_failure";
      root_cause     = "The element could not be found on the page.";
      suggested_fix  = "Check that the button/link text or selector exactly matches what is rendered. Try using a CSS selector (#id or .class) for reliability.";
    } else if (msg.includes("timeout") && !msg.includes("http")) {
      failure_class  = "timing_issue";
      root_cause     = "The action timed out before the element or page was ready.";
      suggested_fix  = "Add a wait step before this action, or increase the timeout in runner options.";
    } else if (msg.includes("assertequals") || msg.includes("expected") && msg.includes("got")) {
      failure_class  = "assertion_failure";
      root_cause     = "The actual value did not match the expected value.";
      suggested_fix  = "Verify the expected value matches current application behaviour. Check for whitespace or casing differences.";
    } else if (msg.includes("expected http") || msg.includes("http ") || msg.includes("status")) {
      failure_class  = "api_failure";
      root_cause     = "The API responded with an unexpected HTTP status code.";
      suggested_fix  = "Verify the endpoint URL, request body, and any required auth headers.";
    } else if (msg.includes("econnrefused") || msg.includes("network") || msg.includes("fetch failed") || msg.includes("timed out after")) {
      failure_class  = "network_error";
      root_cause     = "The request could not reach the target server.";
      suggested_fix  = "Check that the base URL is correct and the server is reachable from this environment.";
    } else if (msg.includes("asserttextvisible") || msg.includes("text") && msg.includes("not found on page")) {
      failure_class  = "locator_failure";
      root_cause     = "The expected text was not visible on the page.";
      suggested_fix  = "Verify the text string matches exactly what is rendered. The page may not have loaded fully — add a navigate step with a wait.";
    }

    return JSON.stringify({ failure_class, root_cause, suggested_fix, confidence: 0.75 });
  }

  // ── Flow mapping handler ─────────────────────────────────────────────────

  private handleFlowMapping(message: string): string {
    const msg = message.toLowerCase();
    const flows: object[] = [];

    if (msg.includes("login") || msg.includes("password") || msg.includes("signin")) {
      flows.push({
        name: "User Authentication",
        description: "Login and logout user journey",
        type: "authentication",
        priority: "high",
      });
    }
    if (msg.includes("register") || msg.includes("signup") || msg.includes("sign up")) {
      flows.push({
        name: "User Registration",
        description: "New user account creation",
        type: "form_submission",
        priority: "high",
      });
    }
    if (msg.includes("checkout") || msg.includes("cart") || msg.includes("payment")) {
      flows.push({
        name: "Purchase Checkout",
        description: "Add to cart and complete purchase",
        type: "form_submission",
        priority: "high",
      });
    }
    if (msg.includes("search")) {
      flows.push({
        name: "Search and Filter",
        description: "Search for content and apply filters",
        type: "navigation",
        priority: "medium",
      });
    }
    if (flows.length === 0) {
      flows.push({
        name: "General Navigation",
        description: "Browse key application pages",
        type: "navigation",
        priority: "medium",
      });
    }

    return JSON.stringify({ flows });
  }

  // ── Judge handler ────────────────────────────────────────────────────────

  private handleJudge(message: string): string {
    const msg = message.toLowerCase();
    // Low score when criteria explicitly mention failure/incorrectness
    const score = msg.includes("fail") || msg.includes("incorrect") || msg.includes("wrong") ? 0.2 : 0.9;
    return JSON.stringify({
      score,
      reason: score >= 0.5
        ? "Mock evaluation: the value meets the specified criteria."
        : "Mock evaluation: the value does not meet the specified criteria.",
    });
  }

  // ── Scenario generation handler ──────────────────────────────────────────

  private handleScenarioGen(message: string): string {
    const msg = message.toLowerCase();

    if (msg.includes("authentication") || msg.includes("login")) {
      return JSON.stringify({
        hint: "authentication",
        steps: ["navigate", "fill_email", "fill_password", "click_submit", "assert_url"],
      });
    }
    if (msg.includes("registration") || msg.includes("signup")) {
      return JSON.stringify({
        hint: "registration",
        steps: ["navigate", "fill_name", "fill_email", "fill_password", "click_submit", "assert_text"],
      });
    }
    if (msg.includes("navigation")) {
      return JSON.stringify({
        hint: "navigation",
        steps: ["navigate", "assert_text"],
      });
    }
    return JSON.stringify({
      hint: "form_submission",
      steps: ["navigate", "fill_fields", "click_submit", "assert_text"],
    });
  }
}
