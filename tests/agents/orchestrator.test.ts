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

  // ── Core pipeline ──────────────────────────────────────────────────────────

  test("runs all 5 stages in order and returns success status", async () => {
    stubAll();
    const stages: number[] = [];

    const agent = new OrchestratorAgent();
    const result = await agent.run({
      url: "https://example.com",
      onProgress: (stage) => stages.push(stage),
    });

    expect(stages).toEqual([1, 2, 3, 4, 5]);
    expect(result.status).toBe("success");
    expect(result.exploration).toBe(EXPLORATION);
    expect(result.flows).toHaveLength(1);
    expect(result.scenarios).toHaveLength(1);
    expect(result.results).toHaveLength(1);
    expect(result.report?.score).toBe(80);
  });

  test("skips invalid scenarios — does not pass them to TestRunner", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO, SCENARIO] });

    const runMock = jest.fn().mockResolvedValue(PASS_RESULT);
    (TestRunner as jest.Mock).mockImplementation(() => ({ run: runMock }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
  });

  test("calls DebuggerAgent for failed tests", async () => {
    stubAll({ testResult: FAIL_RESULT });

    const analyzeMock = jest.fn().mockResolvedValue({
      failure_class: "locator_failure", root_cause: "x", suggested_fix: "y", confidence: 0.9, from_mock: true,
    });
    (DebuggerAgent as jest.Mock).mockImplementation(() => ({ analyze: analyzeMock }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.debugMap.size).toBe(1);
    expect(result.debugMap.get("Login Flow")?.failure_class).toBe("locator_failure");
  });

  test("does not call DebuggerAgent when all tests pass", async () => {
    stubAll({ testResult: PASS_RESULT });

    const analyzeMock = jest.fn();
    (DebuggerAgent as jest.Mock).mockImplementation(() => ({ analyze: analyzeMock }));

    await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(analyzeMock).not.toHaveBeenCalled();
  });

  test("template narrative contains key numbers when LLM is mock", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.narrative).toMatch(/1 page/);
    expect(result.narrative).toMatch(/1 test/);
    expect(result.narrative).toMatch(/Grade B/);
  });

  test("passes no scenarios when all are invalid", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO] });

    const runMock = jest.fn();
    (TestRunner as jest.Mock).mockImplementation(() => ({ run: runMock }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(runMock).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
  });

  test("passes headless and timeout options to TestRunner", async () => {
    stubAll();
    await new OrchestratorAgent().run({ url: "https://example.com", headless: false, timeout: 5000 });
    expect(TestRunner).toHaveBeenCalledWith({ headless: false, timeout: 5000 });
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  test("summary contains url, score, grade and counts after success run", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.summary.url).toBe("https://example.com");
    expect(result.summary.status).toBe("success");
    expect(result.summary.score).toBe(80);
    expect(result.summary.grade).toBe("B");
    expect(result.summary.flows).toBe(1);
    expect(result.summary.scenarios).toBe(1);
    expect(result.summary.valid).toBe(1);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("timings are recorded for each completed stage", async () => {
    stubAll();
    const { timings } = (await new OrchestratorAgent().run({ url: "https://example.com" })).summary;

    expect(typeof timings.explorer).toBe("number");
    expect(typeof timings.flow_mapper).toBe("number");
    expect(typeof timings.scenario_generator).toBe("number");
    expect(typeof timings.test_runner).toBe("number");
    expect(typeof timings.scorer).toBe("number");
  });

  test("warnings from invalid scenarios appear in summary", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO, SCENARIO] });
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.status).toBe("success_with_warnings");
    expect(result.summary.warnings).toHaveLength(1);
    expect(result.summary.warnings[0]).toContain("Broken Flow");
  });

  test("returns success_with_warnings only when tests pass but warnings exist", async () => {
    stubAll({ scenarios: [INVALID_SCENARIO, SCENARIO], testResult: PASS_RESULT });
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.status).toBe("success_with_warnings");
    expect(result.summary.score).toBe(80);
    expect(result.summary.passed).toBe(1);
  });

  test("returns plain success when no warnings and all tests pass", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });
    expect(result.status).toBe("success");
  });

  test("runId is a non-empty string present in both result and summary", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.summary.runId).toBe(result.runId);
  });

  test("stageResults holds data for all four stages on a full success run", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.stageResults.explorer).toBe(EXPLORATION);
    expect(result.stageResults.flowMapper).toHaveLength(1);
    expect(result.stageResults.generator).toHaveLength(1);
    expect(result.stageResults.runner).toHaveLength(1);
  });

  test("stageResults on partial_failure at explorer has no data", async () => {
    (AppExplorer as jest.Mock).mockImplementation(() => ({
      explore: jest.fn().mockRejectedValue(new Error("Network timeout")),
    }));
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.stageResults.explorer).toBeUndefined();
    expect(result.stageResults.flowMapper).toBeUndefined();
  });

  test("stageResults on dry-run has explorer, flowMapper, generator but no runner", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com", dryRun: true });

    expect(result.stageResults.explorer).toBe(EXPLORATION);
    expect(result.stageResults.flowMapper).toHaveLength(1);
    expect(result.stageResults.generator).toHaveLength(1);
    expect(result.stageResults.runner).toBeUndefined();
  });

  test("error object includes message and stage on partial_failure", async () => {
    (AppExplorer as jest.Mock).mockImplementation(() => ({
      explore: jest.fn().mockRejectedValue(new Error("timeout")),
    }));
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.error?.message).toBe("timeout");
    expect(result.error?.stage).toBe("explorer");
  });

  test("summary generatedAt is a valid ISO date string", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com" });
    expect(result.summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── Dry-run ────────────────────────────────────────────────────────────────

  test("dry-run skips TestRunner and returns dry_run status", async () => {
    stubAll();
    const runMock = jest.fn();
    (TestRunner as jest.Mock).mockImplementation(() => ({ run: runMock }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com", dryRun: true });

    expect(runMock).not.toHaveBeenCalled();
    expect(result.status).toBe("dry_run");
    expect(result.results).toHaveLength(0);
    expect(result.scenarios).toHaveLength(1);
    expect(result.report).toBeUndefined();
    expect(result.narrative).toBeUndefined();
  });

  test("dry-run summary has score 0 and grade F since no tests ran", async () => {
    stubAll();
    const result = await new OrchestratorAgent().run({ url: "https://example.com", dryRun: true });

    expect(result.summary.score).toBe(0);
    expect(result.summary.grade).toBe("F");
    expect(result.summary.passed).toBe(0);
  });

  // ── Partial failure ────────────────────────────────────────────────────────

  test("returns partial_failure when AppExplorer throws", async () => {
    (AppExplorer as jest.Mock).mockImplementation(() => ({
      explore: jest.fn().mockRejectedValue(new Error("Network timeout")),
    }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.status).toBe("partial_failure");
    expect(result.failedStage).toBe("explorer");
    expect(result.error).toMatchObject({ message: "Network timeout", stage: "explorer" });
    expect(result.exploration).toBeUndefined();
    expect(result.flows).toBeUndefined();
    expect(result.results).toHaveLength(0);
    expect(result.debugMap.size).toBe(0);
    expect(result.summary.status).toBe("partial_failure");
    expect(result.summary.failedStage).toBe("explorer");
  });

  test("returns partial_failure at flow_mapper but retains exploration", async () => {
    (AppExplorer as jest.Mock).mockImplementation(() => ({
      explore: jest.fn().mockResolvedValue(EXPLORATION),
    }));
    (FlowMapper as jest.Mock).mockImplementation(() => ({
      map: jest.fn().mockRejectedValue(new Error("Mapping error")),
    }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.status).toBe("partial_failure");
    expect(result.failedStage).toBe("flow_mapper");
    expect(result.exploration).toBe(EXPLORATION);
    expect(result.flows).toBeUndefined();
    expect(result.summary.timings.explorer).toBeGreaterThanOrEqual(0);
  });

  test("returns partial_failure at scenario_generator but retains exploration and flows", async () => {
    (AppExplorer as jest.Mock).mockImplementation(() => ({
      explore: jest.fn().mockResolvedValue(EXPLORATION),
    }));
    (FlowMapper as jest.Mock).mockImplementation(() => ({
      map: jest.fn().mockResolvedValue([FLOW]),
    }));
    (ScenarioGenerator as jest.Mock).mockImplementation(() => ({
      generate: jest.fn().mockRejectedValue(new Error("LLM error")),
    }));

    const result = await new OrchestratorAgent().run({ url: "https://example.com" });

    expect(result.status).toBe("partial_failure");
    expect(result.failedStage).toBe("scenario_generator");
    expect(result.exploration).toBe(EXPLORATION);
    expect(result.flows).toHaveLength(1);
    expect(result.scenarios).toBeUndefined();
  });
});
