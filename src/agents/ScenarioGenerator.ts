import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { UserFlow, FlowStep } from "./FlowMapper";

export interface GeneratedScenario {
  fileName: string;
  testName: string;
  flowType: string;
  yaml:     string;
}

const SYSTEM_PROMPT =
  "You are a QA engineer generating YAML test scenarios. " +
  "Return ONLY a JSON object with a 'steps' array of step hint strings " +
  "that describe what the test should do.";

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
      scenarios.push({
        fileName: this.toFileName(flow.name),
        testName: flow.name,
        flowType: flow.type,
        yaml,
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

  private stepToYaml(step: FlowStep, baseUrl: string): string[] {
    switch (step.action) {
      case "navigate": {
        const url = step.target?.startsWith("http") ? step.target : `${baseUrl}${step.target ?? ""}`;
        return [`    - navigate: "${url}"`];
      }
      case "click":
        return [`    - click: "${step.target ?? "Submit"}"`];
      case "fill":
        return [
          `    - fill:`,
          `        target: "${step.target ?? "field"}"`,
          `        value: "${step.value ?? "test value"}"`,
        ];
      case "assert":
        if (step.target === "url") {
          return [`    - assert:`, `        url: "${step.value ?? "/"}"`];
        }
        return [`    - assert:`, `        text: "${step.value ?? "success"}"`];
      case "api":
        return [
          `    - api:`,
          `        method: "${step.value ?? "GET"}"`,
          `        url: "${step.target ?? baseUrl}"`,
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
        userMessage: `Flow: ${flow.name}\nType: ${flow.type}\nPages: ${flow.pages.join(", ")}`,
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
