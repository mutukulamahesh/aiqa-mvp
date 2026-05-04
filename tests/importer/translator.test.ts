import { TestCaseTranslator } from "../../src/importers/TestCaseTranslator";
import { parseTestDefinition } from "../../src/dsl/DslParser";
import type { LLMProvider } from "../../src/llm/LLMProvider";
import type { RawTestCase } from "../../src/importers/types";

const mockLlm: LLMProvider = { name: "mock", complete: jest.fn() };
const translator = new TestCaseTranslator(mockLlm);

const raw = (steps: string[]): RawTestCase => ({ id: "t1", name: "Test", steps });

describe("TestCaseTranslator — heuristic path", () => {
  it("maps a navigate-verb step to navigate:", async () => {
    const { yaml } = await translator.translate(raw(["navigate to https://example.com"]));
    expect(yaml).toContain("navigate:");
    expect(yaml).toContain("https://example.com");
  });

  it("maps an inline URL to navigate:", async () => {
    const { yaml } = await translator.translate(raw(["go to https://staging.app/login"]));
    expect(yaml).toContain("navigate:");
  });

  it("maps click verb to click:", async () => {
    const { yaml } = await translator.translate(raw(["click the Submit button"]));
    expect(yaml).toContain("- click:");
  });

  it("maps fill verb with quoted value to fill:", async () => {
    const { yaml } = await translator.translate(raw(['enter "admin@test.com" in the email field']));
    expect(yaml).toContain("- fill:");
    expect(yaml).toContain("admin@test.com");
  });

  it("maps verify verb to assert:", async () => {
    const { yaml } = await translator.translate(raw(['verify "Dashboard" is visible']));
    expect(yaml).toContain("- assert:");
    expect(yaml).toContain("Dashboard");
  });

  it("strips Gherkin I-subject before pattern matching", async () => {
    const { yaml } = await translator.translate(raw(["I click the Login button"]));
    expect(yaml).toContain("- click:");
  });

  it("strips 'the user' subject prefix before pattern matching", async () => {
    const { yaml } = await translator.translate(raw(["the user navigates to https://app.io"]));
    expect(yaml).toContain("navigate:");
  });

  it("emits WARNING comment and warning entry for vague step", async () => {
    const { yaml, warnings } = await translator.translate(raw(["do something magical"]));
    expect(yaml).toContain("# WARNING: could not map step");
    expect(warnings.some(w => w.includes("do something magical"))).toBe(true);
  });

  it("output YAML is non-empty and includes test: key", async () => {
    const { yaml } = await translator.translate(raw(["navigate to https://example.com"]));
    expect(yaml.trim().length).toBeGreaterThan(0);
    expect(yaml).toContain("test:");
    expect(yaml).toContain("steps:");
  });

  it("propagates custom tags into generated YAML", async () => {
    const { yaml } = await translator.translate(
      raw(["navigate to https://example.com"]),
      ["smoke", "regression"],
    );
    expect(yaml).toContain("[smoke, regression]");
  });

  it("sets validated=true for fully mappable steps", async () => {
    const { validated } = await translator.translate(raw(["navigate to https://example.com"]));
    expect(validated).toBe(true);
  });

  it("sets validated=false and records a validation warning when all steps are unmappable", async () => {
    const { validated, warnings } = await translator.translate(raw(["do magic", "be awesome"]));
    expect(validated).toBe(false);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining("validation failed")]));
  });

  it("contains at least the expected number of step lines for multi-step input", async () => {
    const steps = [
      "navigate to https://example.com",
      "click the Login button",
      'verify "Welcome" is visible',
    ];
    const { yaml } = await translator.translate(raw(steps));
    const stepLines = yaml.split("\n").filter(l => l.trimStart().startsWith("- "));
    expect(stepLines.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseTestDefinition", () => {
  it("accepts a valid AIQA YAML string", () => {
    const yaml = [
      `test:`,
      `  name: "Smoke test"`,
      `  tags: [smoke]`,
      `  steps:`,
      `    - navigate: "https://example.com"`,
    ].join("\n");
    expect(() => parseTestDefinition(yaml)).not.toThrow();
  });

  it("throws when the top-level test: key is missing", () => {
    expect(() => parseTestDefinition("name: broken")).toThrow('missing top-level "test:" key');
  });

  it("throws when steps array is empty", () => {
    const yaml = `test:\n  name: "T"\n  steps: []\n`;
    expect(() => parseTestDefinition(yaml)).toThrow('"test.steps" must be a non-empty array');
  });

  it("throws for an unknown step action", () => {
    const yaml = `test:\n  name: "T"\n  steps:\n    - bogus: "x"\n`;
    expect(() => parseTestDefinition(yaml)).toThrow("unknown action");
  });

  it("throws when test.name is missing", () => {
    const yaml = `test:\n  steps:\n    - navigate: "https://example.com"\n`;
    expect(() => parseTestDefinition(yaml)).toThrow('missing "test.name"');
  });
});
