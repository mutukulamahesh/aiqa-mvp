import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { ExplorationResult, ExploredPage } from "./AppExplorer";

export interface FlowStep {
  action:       string;
  target?:      string;
  value?:       string;
  description?: string;
}

export interface UserFlow {
  name:        string;
  description: string;
  type:        "authentication" | "form_submission" | "navigation" | "crud";
  priority:    "high" | "medium" | "low";
  pages:       string[];
  steps:       FlowStep[];
}

const SYSTEM_PROMPT =
  "You are a QA expert identifying user flows from application structure. " +
  "Return ONLY a JSON object with a 'flows' array. Each flow has: " +
  "name, description, type (authentication|form_submission|navigation|crud), priority (high|medium|low).";

export class FlowMapper {
  private llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  perPageFlows(exploration: ExplorationResult): UserFlow[] {
    const seenSlugs = new Set<string>();
    return exploration.pages.flatMap(page => {
      const steps: FlowStep[] = [{ action: "navigate", target: page.url }];
      page.headings.slice(0, 2).forEach(h => {
        if (h) steps.push({ action: "assert", target: "text", value: h });
      });
      if (page.inputs.length > 0 && page.buttons.some(b => /submit|send|save/i.test(b))) {
        for (const input of page.inputs.slice(0, 4)) {
          const label = input.placeholder ?? input.name ?? input.type;
          steps.push({ action: "fill", target: label, value: this.sampleValue(input.type, input.name) });
        }
      }
      const pathname = (() => { try { return new URL(page.url).pathname.replace(/\/$/, "") || "/"; } catch { return "/"; } })();
      const slug = pathname === "/" || pathname === "/index.html"
        ? "home"
        : pathname.replace(/^\//, "").replace(/\.html$/, "").replace(/[/\\]/g, " ");
      if (seenSlugs.has(slug)) return [];
      seenSlugs.add(slug);
      const name = slug.charAt(0).toUpperCase() + slug.slice(1);
      return [{
        name:        `Page — ${name}`,
        description: `Verify ${page.url} loads and displays expected content`,
        type:        "navigation" as const,
        priority:    "medium" as const,
        pages:       [page.url],
        steps,
      }];
    });
  }

  async map(exploration: ExplorationResult): Promise<UserFlow[]> {
    const heuristic = this.heuristicFlows(exploration);

    if (this.llm.name !== "mock") {
      try {
        const enhanced = await this.llmEnhance(exploration, heuristic);
        return enhanced;
      } catch {
        // Fall through to heuristic result
      }
    } else {
      // Use mock provider for metadata enrichment
      try {
        const summary = this.buildSummary(exploration);
        const res = await this.llm.complete({
          system:      SYSTEM_PROMPT,
          userMessage: summary,
          maxTokens:   512,
        });
        const parsed = JSON.parse(res.content) as { flows: Array<{ name: string; description: string; type: UserFlow["type"]; priority: UserFlow["priority"] }> };
        if (parsed.flows?.length) {
          return this.mergeMetadata(heuristic, parsed.flows);
        }
      } catch {
        // Fall through
      }
    }

    return heuristic;
  }

  // ── Heuristic flow identification ────────────────────────────────────────

  private heuristicFlows(exploration: ExplorationResult): UserFlow[] {
    const flows: UserFlow[] = [];

    for (const page of exploration.pages) {
      const flow = this.classifyPage(page, exploration.baseUrl);
      if (flow) flows.push(flow);
    }

    // Always include a navigation flow across all discovered pages
    flows.push(this.buildNavigationFlow(exploration));

    // Deduplicate by type — keep highest-priority of each
    return this.deduplicateFlows(flows);
  }

  private classifyPage(page: ExploredPage, baseUrl: string): UserFlow | null {
    const url  = page.url.toLowerCase();
    const hasPassword = page.inputs.some(i => i.type === "password");
    const hasEmail    = page.inputs.some(i =>
      i.type === "email" || i.name?.includes("email") || i.placeholder?.toLowerCase().includes("email")
    );
    const hasSubmit = page.buttons.some(b =>
      /submit|save|send|confirm|proceed|continue|next/i.test(b)
    );
    const hasInputs = page.inputs.length > 0;

    // Authentication
    if (hasPassword || url.includes("login") || url.includes("signin") || url.includes("/auth")) {
      return {
        name:        "User Authentication",
        description: "Sign in with credentials to access the application",
        type:        "authentication",
        priority:    "high",
        pages:       [page.url],
        steps:       this.buildAuthSteps(page, baseUrl),
      };
    }

    // Registration
    if (url.includes("register") || url.includes("signup") || url.includes("sign-up") || url.includes("join")) {
      return {
        name:        "User Registration",
        description: "Create a new account",
        type:        "form_submission",
        priority:    "high",
        pages:       [page.url],
        steps:       this.buildFormSteps(page),
      };
    }

    // Generic form with submission
    if (hasInputs && hasSubmit && hasEmail) {
      return {
        name:        `Form — ${page.title || new URL(page.url).pathname}`,
        description: `Submit the form on ${page.title || page.url}`,
        type:        "form_submission",
        priority:    "medium",
        pages:       [page.url],
        steps:       this.buildFormSteps(page),
      };
    }

    return null;
  }

  private buildAuthSteps(page: ExploredPage, _baseUrl: string): FlowStep[] {
    const steps: FlowStep[] = [{ action: "navigate", target: page.url }];

    if (page.inputs.some(i => i.type === "email" || i.name?.includes("email"))) {
      steps.push({ action: "fill", target: "email", value: "testuser@example.com" });
    } else if (page.inputs.some(i => i.name?.includes("user") || i.placeholder?.toLowerCase().includes("user"))) {
      steps.push({ action: "fill", target: "username", value: "testuser" });
    }

    if (page.inputs.some(i => i.type === "password")) {
      steps.push({ action: "fill", target: "password", value: "TestPassword123" });
    }

    const submitBtn = page.buttons.find(b => /sign\s?in|log\s?in|login|submit/i.test(b));
    steps.push({ action: "click", target: submitBtn ?? "Sign in" });
    steps.push({ action: "assert", target: "url", value: "dashboard" });

    return steps;
  }

  private buildFormSteps(page: ExploredPage): FlowStep[] {
    const steps: FlowStep[] = [{ action: "navigate", target: page.url }];

    for (const input of page.inputs.slice(0, 5)) {
      const label = input.placeholder ?? input.name ?? input.type;
      const value = this.sampleValue(input.type, input.name);
      steps.push({ action: "fill", target: label, value });
    }

    const submitBtn = page.buttons.find(b => /submit|send|save|register|sign\s?up/i.test(b));
    if (submitBtn) steps.push({ action: "click", target: submitBtn });
    steps.push({ action: "assert", target: "text", value: "success" });

    return steps;
  }

  private buildNavigationFlow(exploration: ExplorationResult): UserFlow {
    const steps: FlowStep[] = exploration.pages.slice(0, 5).flatMap(p => [
      { action: "navigate", target: p.url },
      ...(p.headings[0] ? [{ action: "assert", target: "text", value: p.headings[0] }] : []),
    ]);

    return {
      name:        "Navigation — Key Pages",
      description: "Verify all key pages load and display expected content",
      type:        "navigation",
      priority:    "medium",
      pages:       exploration.pages.map(p => p.url),
      steps,
    };
  }

  private sampleValue(type: string, name?: string): string {
    if (type === "email")    return "testuser@example.com";
    if (type === "password") return "TestPassword123";
    if (type === "tel")      return "+1234567890";
    if (type === "number")   return "42";
    if (type === "date")     return "2024-01-01";
    if (name?.toLowerCase().includes("name"))  return "Test User";
    if (name?.toLowerCase().includes("city"))  return "London";
    if (name?.toLowerCase().includes("zip") || name?.toLowerCase().includes("post")) return "SW1A 1AA";
    return "sample text";
  }

  private deduplicateFlows(flows: UserFlow[]): UserFlow[] {
    const seen = new Set<string>();
    return flows.filter(f => {
      const key = `${f.type}:${f.pages[0]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildSummary(exploration: ExplorationResult): string {
    const pageInfo = exploration.pages.map(p =>
      `URL: ${p.url} | Title: ${p.title} | ` +
      `Inputs: ${p.inputs.map(i => i.type).join(",")} | ` +
      `Buttons: ${p.buttons.slice(0, 3).join(",")}`
    ).join("\n");
    return `Application: ${exploration.baseUrl}\nPages:\n${pageInfo}`;
  }

  private mergeMetadata(
    heuristic: UserFlow[],
    enriched: Array<{ name: string; description: string; type: UserFlow["type"]; priority: UserFlow["priority"] }>,
  ): UserFlow[] {
    return heuristic.map((flow, i) => ({
      ...flow,
      name:        enriched[i]?.name        ?? flow.name,
      description: enriched[i]?.description ?? flow.description,
      priority:    enriched[i]?.priority    ?? flow.priority,
    }));
  }

  private async llmEnhance(exploration: ExplorationResult, heuristic: UserFlow[]): Promise<UserFlow[]> {
    const res = await this.llm.complete({
      system:      SYSTEM_PROMPT,
      userMessage: this.buildSummary(exploration),
      maxTokens:   1024,
    });
    const parsed = JSON.parse(res.content) as { flows: UserFlow[] };
    return parsed.flows?.length ? parsed.flows.map((f, i) => ({ ...heuristic[i], ...f })) : heuristic;
  }
}
