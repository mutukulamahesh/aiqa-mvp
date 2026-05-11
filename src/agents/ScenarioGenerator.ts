import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { parseTestDefinition } from "../dsl/DslParser";
import { UserFlow, FlowStep, GeneratedScenario } from "./types";

export type { GeneratedScenario };

const SYSTEM_PROMPT =
  "You are a QA engineer refining test steps. Given existing steps derived from real DOM attributes, " +
  "you may add useful assertion or wait steps. NEVER change 'target' or 'value' fields in existing steps — " +
  "they are real CSS selectors or DOM attributes. Return ONLY a JSON object with a 'steps' array.";

export class ScenarioGenerator {
  private llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  async generate(flows: UserFlow[], baseUrl: string): Promise<GeneratedScenario[]> {
    const scenarios: GeneratedScenario[] = [];

    for (const flow of flows) {
      // Real LLM can suggest additional steps; mock uses flow steps directly
      const steps = this.llm.name !== "mock"
        ? await this.llmSteps(flow)
        : flow.steps;

      const yaml = this.buildYaml(flow, steps, baseUrl);
      let validated = true;
      let validationError: string | undefined;
      try {
        parseTestDefinition(yaml);
      } catch (err) {
        validated = false;
        validationError = (err as Error).message;
      }
      scenarios.push({
        fileName: this.toFileName(flow.name),
        testName: flow.name,
        flowType: flow.type,
        yaml,
        validated,
        validationError,
      });
    }

    return scenarios;
  }

  // ── YAML builder ─────────────────────────────────────────────────────────

  private buildYaml(flow: UserFlow, steps: FlowStep[], baseUrl: string): string {
    const lines: string[] = [
      `test:`,
      `  name: "${flow.name}"`,
      `  steps:`,
    ];

    for (const step of steps) {
      lines.push(...this.stepToYaml(step, baseUrl));
    }

    return lines.join("\n") + "\n";
  }

  // Produce a YAML-safe quoted string. CSS attribute selectors like [name="x"]
  // contain double quotes, which break double-quoted YAML scalars. Use single
  // quotes when the value contains double quotes (CSS selectors rarely use single
  // quotes). Fall back to escaped double quotes if both quote types are present.
  private qs(s: string): string {
    if (!s.includes('"')) return `"${s}"`;
    if (!s.includes("'")) return `'${s}'`;
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  private stepToYaml(step: FlowStep, baseUrl: string): string[] {
    switch (step.action) {
      case "navigate": {
        const url = step.target?.startsWith("http") ? step.target : `${baseUrl}${step.target ?? ""}`;
        return [`    - navigate: ${this.qs(url)}`];
      }
      case "click":
        return [`    - click: ${this.qs(step.target ?? "Submit")}`];
      case "fill":
        return [
          `    - fill:`,
          `        target: ${this.qs(step.target ?? "field")}`,
          `        value: ${this.qs(step.value ?? "test value")}`,
        ];
      case "assert":
        if (step.target === "url") {
          return [`    - assert:`, `        url: ${this.qs(step.value ?? "/")}`];
        }
        if (step.target === "element_not_visible") {
          return [`    - assert:`, `        element_not_visible: ${this.qs(step.value ?? "")}`];
        }
        return [`    - assert:`, `        text: ${this.qs(step.value ?? "success")}`];
      case "api":
        return [
          `    - api:`,
          `        method: ${this.qs(step.value ?? "GET")}`,
          `        url: ${this.qs(step.target ?? baseUrl)}`,
          `        assert_status: 200`,
        ];
      default:
        return [`    # unsupported step: ${step.action}`];
    }
  }

  // ── LLM enhancement ──────────────────────────────────────────────────────

  private async llmSteps(flow: UserFlow): Promise<FlowStep[]> {
    try {
      const res = await this.llm.complete({
        system:      SYSTEM_PROMPT,
        userMessage: `Flow: ${flow.name}\nType: ${flow.type}\nExisting steps (preserve selectors): ${JSON.stringify(flow.steps)}`,
        maxTokens:   512,
      });
      const parsed = JSON.parse(res.content) as { steps?: FlowStep[] };
      if (parsed.steps?.length) return parsed.steps;
    } catch {
      // Fall through to heuristic steps
    }
    return flow.steps;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }
}
