// Factory mocks prevent Jest from loading the real modules (which would pull
// in Playwright's ESM dynamic import and crash in the Jest CJS environment).
jest.mock("../../src/agents/AppExplorer", () => ({
  AppExplorer: jest.fn(),
}));
jest.mock("../../src/runner/TestRunner", () => ({
  TestRunner: jest.fn(),
}));
jest.mock("../../src/agents/FlowMapper");
jest.mock("../../src/agents/ScenarioGenerator");
jest.mock("../../src/agents/DebuggerAgent");
jest.mock("../../src/agents/ReadinessScorer");

import { OrchestratorAgent }  from "../../src/agents/OrchestratorAgent";
import { AppExplorer }        from "../../src/agents/AppExplorer";
import { FlowMapper }         from "../../src/agents/FlowMapper";
import { ScenarioGenerator }  from "../../src/agents/ScenarioGenerator";
import { DebuggerAgent }      from "../../src/agents/DebuggerAgent";
import { ReadinessScorer }    from "../../src/agents/ReadinessScorer";
import { TestRunner }         from "../../src/runner/TestRunner";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EXPLORATION = {
  baseUrl: "https://example.com",
  exploredAt: "2026-01-01T00:00:00.000Z",
  pages: [{ url: "https://example.com", title: "Home", headings: [], buttons: [], inputs: [], links: [], internalLinks: [] }],
  totalPages: 1,
  totalLinks: 0,
};

const FLOW = {
  name: "Login Flow",
  description: "Standard login",
  type: "authentication" as const,
  priority: "high" as const,
  pages: ["https://example.com"],
  steps: [{ action: "navigate", target: "https://example.com" }],
};

const VALID_YAML = `test:\n  name: "Login Flow"\n  steps:\n    - navigate: "https://example.com"\n`;

const SCENARIO = {
  fileName: "login_flow",
  testName: "Login Flow",
  flowType: "authentication",
  yaml: VALID_YAML,
  validated: true,
};

const INVALID_SCENARIO = {
  fileName: "broken_flow",
  testName: "Broken Flow",
  flowType: "navigation",
  yaml: `test:\n  name: "Broken"\n  steps:\n`,
  validated: false,
  validationError: "steps must be non-empty",
};

const PASS_RESULT = {
  testId: "t1", testName: "Login Flow", tags: [], passed: true,
  durationMs: 50, retryCount: 0, stepResults: [{ action: "navigate", passed: true, durationMs: 50 }],
};

const FAIL_RESULT = {
  testId: "t2", testName: "Login Flow", tags: [], passed: false,
  durationMs: 30, retryCount: 0, error: "Element not found",
  stepResults: [{ action: "click", passed: false, durationMs: 30, error: "Element not found" }],
};

const READINESS_REPORT = {
  score: 80, grade: "B" as const,
  totalTests: 1, passed: 1, failed: 0,
  passRatePct: 100, coverageLayers: ["UI"],
  failureBreakdown: {}, topIssues: [],
  recommendation: "Good coverage.",
  generatedAt: "2026-01-01T00:00:00.000Z",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubAll(overrides: {
  scenarios?: typeof SCENARIO[];
  testResult?: typeof PASS_RESULT;
  report?: typeof READINESS_REPORT;
} = {}) {
  (AppExplorer as jest.Mock).mockImplementation(() => ({
    explore: jest.fn().mockResolvedValue(EXPLORATION),
  }));
  (FlowMapper as jest.Mock).mockImplementation(() => ({
    map: jest.fn().mockResolvedValue([FLOW]),
  }));
  (ScenarioGenerator as jest.Mock).mockImplementation(() => ({
    generate: jest.fn().mockResolvedValue(overrides.scenarios ?? [SCENARIO]),
  }));
  (TestRunner as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockResolvedValue(overrides.testResult ?? PASS_RESULT),
  }));
  (DebuggerAgent as jest.Mock).mockImplementation(() => ({
    analyze: jest.fn().mockResolvedValue({
      failure_class: "locator_failure",
      root_cause: "Element not found",
      suggested_fix: "Fix the selector",
      confidence: 0.9,
      from_mock: true,
    }),
  }));
  (ReadinessScorer as jest.Mock).mockImplementation(() => ({
    score: jest.fn().mockReturnValue(overrides.report ?? READINESS_REPORT),
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OrchestratorAgent", () => {
  beforeEach(() => jest.clearAllMocks());

  test("runs all 5 stages in order and returns a result", async () => {
    stubAll();
    const stages: number[] = [];

    const agent = new OrchestratorAgent();
    const result = await agent.run("https://example.com", {
      onProgress: (stage) => stages.push(stage),
    });

    expect(stages).toEqual([1, 2, 3, 4, 5]);
    expect(result.exploration).toBe(EXPLORATION);
    expect(result.flows).toHaveLength(1);
    expect(result.scenarios).toHaveLength(1);
    expect(result.results).toHaveLength(1);
    expect(result.report.score).toBe(80);
  });

  test("skips invalid scenarios — does not pass them to TestRunner", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO, SCENARIO] });

    const runMock = jest.fn().mockResolvedValue(PASS_RESULT);
    (TestRunner as jest.Mock).mockImplementation(() => ({ run: runMock }));

    const agent = new OrchestratorAgent();
    const result = await agent.run("https://example.com");

    // Only the valid scenario should be run
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
  });

  test("calls DebuggerAgent for failed tests", async () => {
    stubAll({ testResult: FAIL_RESULT });

    const analyzeMock = jest.fn().mockResolvedValue({
      failure_class: "locator_failure", root_cause: "x", suggested_fix: "y", confidence: 0.9, from_mock: true,
    });
    (DebuggerAgent as jest.Mock).mockImplementation(() => ({ analyze: analyzeMock }));

    const agent = new OrchestratorAgent();
    const result = await agent.run("https://example.com");

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.debugMap.size).toBe(1);
    expect(result.debugMap.get("Login Flow")?.failure_class).toBe("locator_failure");
  });

  test("does not call DebuggerAgent when all tests pass", async () => {
    stubAll({ testResult: PASS_RESULT });

    const analyzeMock = jest.fn();
    (DebuggerAgent as jest.Mock).mockImplementation(() => ({ analyze: analyzeMock }));

    const agent = new OrchestratorAgent();
    await agent.run("https://example.com");

    expect(analyzeMock).not.toHaveBeenCalled();
  });

  test("template narrative contains key numbers when LLM is mock", async () => {
    stubAll();
    const agent = new OrchestratorAgent();
    const result = await agent.run("https://example.com");

    expect(result.narrative).toMatch(/1 page/);
    expect(result.narrative).toMatch(/1 test/);
    expect(result.narrative).toMatch(/Grade B/);
  });

  test("passes no scenarios when all are invalid", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO] });

    const runMock = jest.fn();
    (TestRunner as jest.Mock).mockImplementation(() => ({ run: runMock }));

    const agent = new OrchestratorAgent();
    const result = await agent.run("https://example.com");

    expect(runMock).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
  });

  test("passes correct headless option to TestRunner", async () => {
    stubAll();

    const agent = new OrchestratorAgent();
    await agent.run("https://example.com", { headless: false });

    expect(TestRunner).toHaveBeenCalledWith({ headless: false });
  });
});
