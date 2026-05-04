import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { parseTestDefinition } from "../dsl/DslParser";
import { RawTestCase } from "./types";

export interface TranslationResult {
  yaml:      string;
  warnings:  string[];
  validated: boolean;
}

const SYSTEM_PROMPT = `You are an AIQA DSL generator. Convert natural-language test steps to AIQA YAML.

Available step actions:
  - navigate: <url>
  - click: <button text or selector>
  - fill:
      target: <field label or selector>
      value: <text>
  - assert:
      text: <text that should be visible on page>
  - assert:
      url: <url substring the current URL must contain>
  - assert:
      visible: <element text or selector that must be visible>
  - api:
      method: GET|POST|PUT|DELETE
      url: <full url>
      assert_status: <http status code>

Rules:
  1. Output ONLY the YAML steps list — no markdown fences, no prose.
  2. If a step is too vague to map, emit it as a YAML comment:
       # WARNING: could not map step — "<original step>"
  3. Replace missing data (url, value, etc.) with a placeholder comment:
       # TODO: replace with real test data`;

export class TestCaseTranslator {
  private readonly llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  async translate(tc: RawTestCase, tags: string[] = ["imported"]): Promise<TranslationResult> {
    const warnings: string[] = [];

    const stepsYaml = this.llm.name === "mock"
      ? this.heuristicTranslate(tc.steps, warnings)
      : await this.llmTranslate(tc, warnings);

    const yaml = this.buildTestYaml(tc, tags, stepsYaml);

    let validated = false;
    try {
      parseTestDefinition(yaml);
      validated = true;
    } catch (err) {
      warnings.push(`YAML validation failed: ${(err as Error).message}`);
    }

    return { yaml, warnings, validated };
  }

  // ── LLM path ─────────────────────────────────────────────────────────────

  private async llmTranslate(tc: RawTestCase, warnings: string[]): Promise<string> {
    const userMessage =
      `Test: ${tc.name}\n` +
      (tc.precondition ? `Precondition: ${tc.precondition}\n` : "") +
      `Steps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n` +
      (tc.expected ? `Expected: ${tc.expected}` : "");

    try {
      const res = await this.llm.complete({ system: SYSTEM_PROMPT, userMessage, maxTokens: 1024 });
      return res.content.trim();
    } catch (err) {
      warnings.push(`LLM call failed, falling back to heuristic: ${(err as Error).message}`);
      return this.heuristicTranslate(tc.steps, warnings);
    }
  }

  // ── Heuristic path (mock / fallback) ─────────────────────────────────────

  private heuristicTranslate(steps: string[], warnings: string[]): string {
    return steps.map(step => this.mapStep(step, warnings)).join("\n");
  }

  private mapStep(step: string, warnings: string[]): string {
    // Strip Gherkin subject prefix ("I ", "the user ", "a user ")
    const s = step.trim().replace(/^(I |the user |a user )/i, "");
    const lower = s.toLowerCase();

    // navigate — explicit verb
    if (/^(go to|navigate to|open|visit|load|browse to)\s+/i.test(s)) {
      const url = s.replace(/^(go to|navigate to|open|visit|load|browse to)\s+/i, "").trim();
      return `- navigate: "${url}"`;
    }

    // navigate — any step containing a URL
    if (/https?:\/\//.test(s)) {
      const url = (s.match(/https?:\/\/\S+/) ?? [])[0] ?? s;
      return `- navigate: "${url}"`;
    }

    // click
    if (/^(click|press|tap|select|choose|submit)\s+/i.test(s)) {
      const target = s
        .replace(/^(click|press|tap|select|choose|submit)\s+/i, "")
        .replace(/^(the|on the|on)\s+/i, "")
        .replace(/\s+(button|link|checkbox|radio|tab|menu|icon)\s*$/i, "")
        .trim();
      return `- click: "${target || s}"`;
    }

    // fill — try to extract field and value
    if (/^(enter|fill|type|input|set|provide)\s+/i.test(s)) {
      const valueMatch = s.match(/"([^"]+)"/);
      const value      = valueMatch ? valueMatch[1] : "# TODO: replace with real test data";
      const withoutVerb  = s.replace(/^(enter|fill|type|input|set|provide)\s+/i, "");
      const fieldMatch   = withoutVerb.match(/(?:in|into|for|on|the)\s+(.+?)(?:\s+field|\s+input|\s+box|$)/i);
      const target       = fieldMatch
        ? fieldMatch[1].replace(/"[^"]+"/g, "").trim()
        : withoutVerb.replace(/"[^"]+"/g, "").replace(/\s+(in|into|for|on)\s+.*/i, "").trim() || "# TODO: replace with real target";
      return `- fill:\n    target: "${target}"\n    value: "${value}"`;
    }

    // assert text visible
    if (/^(verify|check|assert|confirm|should see|ensure|validate|expect)\s+/i.test(s)) {
      const valueMatch = s.match(/"([^"]+)"/);
      if (valueMatch) {
        return `- assert:\n    text: "${valueMatch[1]}"`;
      }
      const text = s
        .replace(/^(verify|check|assert|confirm|should see|ensure|validate|expect)\s+/i, "")
        .replace(/\s+(is|are|appears?|visible|present|displayed?|shown?)\s*$/i, "")
        .trim();
      return `- assert:\n    text: "${text}"`;
    }

    // URL assertion
    if (/url|address|page|redirect/i.test(lower) && /contains?|should be|redirected|navigated/i.test(lower)) {
      const urlMatch = s.match(/"([^"]+)"/);
      if (urlMatch) return `- assert:\n    url: "${urlMatch[1]}"`;
    }

    // Vague — emit as warning comment
    warnings.push(`Could not map step: "${s}"`);
    return `# WARNING: could not map step — "${s}"`;
  }

  // ── YAML builder ──────────────────────────────────────────────────────────

  private buildTestYaml(tc: RawTestCase, tags: string[], stepsYaml: string): string {
    const tagLine = `  tags: [${tags.join(", ")}]`;
    const lines   = [
      `test:`,
      `  name: "${tc.name.replace(/"/g, "'")}"`,
      tagLine,
      `  steps:`,
    ];

    for (const line of stepsYaml.split("\n")) {
      lines.push(`    ${line}`);
    }

    if (tc.precondition) {
      lines.push(`  # Precondition: ${tc.precondition}`);
    }
    if (tc.expected) {
      lines.push(`  # Expected: ${tc.expected}`);
    }

    return lines.join("\n") + "\n";
  }
}
