import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { MemoryStore, makeStepKey, FLAKINESS_THRESHOLD } from "../../src/memory/MemoryStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

function store(): MemoryStore {
  return new MemoryStore(); // in-memory only
}

// ── makeStepKey ───────────────────────────────────────────────────────────────

describe("makeStepKey", () => {
  test("formats as testName::stepN::action", () => {
    expect(makeStepKey("Login flow", 2, "click")).toBe("Login flow::step3::click");
  });

  test("step index is 1-based", () => {
    expect(makeStepKey("T", 0, "navigate")).toBe("T::step1::navigate");
  });
});

// ── Flakiness scoring ─────────────────────────────────────────────────────────

describe("MemoryStore — flakiness scoring", () => {
  test("score starts at 0 for unknown step", () => {
    expect(store().getScore("unknown::step1::click")).toBe(0);
  });

  test("single fail raises score from 0 to ~0.2", () => {
    const m = store();
    m.recordOutcome("k", false);
    expect(m.getScore("k")).toBeCloseTo(0.2, 2);
  });

  test("two fails raise score to ~0.36", () => {
    const m = store();
    m.recordOutcome("k", false);
    m.recordOutcome("k", false);
    expect(m.getScore("k")).toBeCloseTo(0.36, 2);
  });

  test("three fails push score above threshold (0.4)", () => {
    const m = store();
    m.recordOutcome("k", false);
    m.recordOutcome("k", false);
    m.recordOutcome("k", false);
    expect(m.getScore("k")).toBeGreaterThanOrEqual(FLAKINESS_THRESHOLD);
  });

  test("pass after fail decays score by ~20%", () => {
    const m = store();
    m.recordOutcome("k", false); // score ≈ 0.2
    const before = m.getScore("k");
    m.recordOutcome("k", true);
    expect(m.getScore("k")).toBeCloseTo(before * 0.8, 2);
  });

  test("runCount and failCount tracked correctly", () => {
    const m = store();
    m.recordOutcome("k", false);
    m.recordOutcome("k", true);
    m.recordOutcome("k", false);
    const steps = m.getFlakySteps(0); // threshold 0 = return all
    expect(steps[0].runCount).toBe(3);
    expect(steps[0].failCount).toBe(2);
  });

  test("score is capped and does not exceed 1.0", () => {
    const m = store();
    for (let i = 0; i < 50; i++) m.recordOutcome("k", false);
    expect(m.getScore("k")).toBeLessThanOrEqual(1.0);
  });
});

// ── extraWaitMs ───────────────────────────────────────────────────────────────

describe("MemoryStore — extraWaitMs", () => {
  test("returns 0 for score below threshold", () => {
    const m = store();
    expect(m.extraWaitMs("unknown-step")).toBe(0);
  });

  test("returns 1000ms when score is between 0.4 and 0.6", () => {
    const m = store();
    // 3 fails → score ≈ 0.49
    m.recordOutcome("k", false);
    m.recordOutcome("k", false);
    m.recordOutcome("k", false);
    expect(m.extraWaitMs("k")).toBe(1000);
  });

  test("returns 2000ms when score is between 0.6 and 0.8", () => {
    const m = store();
    // 5 fails → score ≈ 0.67
    for (let i = 0; i < 5; i++) m.recordOutcome("k", false);
    expect(m.extraWaitMs("k")).toBe(2000);
  });

  test("returns 3000ms when score is >= 0.8", () => {
    const m = store();
    // 8 fails → score ≈ 0.83
    for (let i = 0; i < 8; i++) m.recordOutcome("k", false);
    expect(m.extraWaitMs("k")).toBe(3000);
  });
});

// ── getFlakySteps ─────────────────────────────────────────────────────────────

describe("MemoryStore — getFlakySteps", () => {
  test("returns empty array when nothing is tracked", () => {
    expect(store().getFlakySteps()).toHaveLength(0);
  });

  test("returns only steps at or above the threshold", () => {
    const m = store();
    // "low" stays below threshold (1 fail ≈ 0.2)
    m.recordOutcome("low", false);
    // "flaky" crosses threshold (3 fails ≈ 0.49)
    m.recordOutcome("flaky", false);
    m.recordOutcome("flaky", false);
    m.recordOutcome("flaky", false);

    const flaky = m.getFlakySteps();
    expect(flaky).toHaveLength(1);
    expect(flaky[0].stepKey).toBe("flaky");
  });

  test("custom threshold is respected", () => {
    const m = store();
    m.recordOutcome("k", false); // ≈ 0.2
    expect(m.getFlakySteps(0.1)).toHaveLength(1);
    expect(m.getFlakySteps(0.5)).toHaveLength(0);
  });
});

// ── Known-pattern cache ───────────────────────────────────────────────────────

describe("MemoryStore — known patterns", () => {
  const pattern = { failureClass: "locator_failure", rootCause: "rc", suggestedFix: "sf" };

  test("getKnownPattern returns undefined for unknown step", () => {
    expect(store().getKnownPattern("no-such-step")).toBeUndefined();
  });

  test("storePattern then getKnownPattern returns the stored values", () => {
    const m = store();
    m.storePattern("k", pattern);
    const result = m.getKnownPattern("k");
    expect(result?.failureClass).toBe("locator_failure");
    expect(result?.rootCause).toBe("rc");
    expect(result?.suggestedFix).toBe("sf");
  });

  test("getKnownPattern increments hitCount and llmCallsSaved", () => {
    const m = store();
    m.storePattern("k", pattern);
    m.getKnownPattern("k");
    m.getKnownPattern("k");
    const known = m.getKnownPattern("k");
    expect(known?.hitCount).toBe(3);
  });

  test("second storePattern call is a no-op (first-seen wins)", () => {
    const m = store();
    m.storePattern("k", { failureClass: "locator_failure", rootCause: "first", suggestedFix: "sf" });
    m.storePattern("k", { failureClass: "timing_issue",    rootCause: "second", suggestedFix: "sf2" });
    expect(m.getKnownPattern("k")?.rootCause).toBe("first");
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe("MemoryStore — getReport", () => {
  test("returns empty string when no steps tracked", () => {
    expect(store().getReport()).toBe("");
  });

  test("returns non-empty string when steps are tracked", () => {
    const m = store();
    m.recordOutcome("step", false);
    expect(m.getReport()).toBeTruthy();
  });

  test("report includes flaky step key when above threshold", () => {
    const m = store();
    for (let i = 0; i < 3; i++) m.recordOutcome("Login flow::step2::click", false);
    const report = m.getReport();
    expect(report).toContain("Login flow::step2::click");
    expect(report).toContain("Flaky steps");
  });

  test("report shows LLM calls saved count", () => {
    const m = store();
    const pat = { failureClass: "locator_failure", rootCause: "rc", suggestedFix: "sf" };
    m.storePattern("k", pat);
    m.getKnownPattern("k");
    m.getKnownPattern("k");
    expect(m.getReport()).toContain("LLM calls saved:    2");
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe("MemoryStore — persistence", () => {
  let tmpFile: string;
  beforeEach(() => { tmpFile = path.join(os.tmpdir(), `aiqa-mem-test-${Date.now()}.json`); });
  afterEach(() => { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); });

  test("save writes a valid JSON file", () => {
    const m = new MemoryStore(tmpFile, "suite1");
    m.recordOutcome("k", false);
    m.save();
    expect(fs.existsSync(tmpFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    expect(raw.suiteId).toBe("suite1");
    expect(raw.steps["k"]).toBeDefined();
  });

  test("loading an existing file restores flakiness scores", () => {
    const m1 = new MemoryStore(tmpFile, "suite1");
    m1.recordOutcome("k", false);
    m1.recordOutcome("k", false);
    m1.recordOutcome("k", false);
    m1.save();

    const m2 = new MemoryStore(tmpFile, "suite1");
    expect(m2.getScore("k")).toBeGreaterThanOrEqual(FLAKINESS_THRESHOLD);
  });

  test("loading an existing file restores known patterns", () => {
    const m1 = new MemoryStore(tmpFile, "suite1");
    m1.storePattern("k", { failureClass: "timing_issue", rootCause: "rc", suggestedFix: "sf" });
    m1.save();

    const m2 = new MemoryStore(tmpFile, "suite1");
    expect(m2.getKnownPattern("k")?.failureClass).toBe("timing_issue");
  });

  test("loading a non-existent file starts fresh", () => {
    const m = new MemoryStore("/tmp/this-does-not-exist-aiqa.json", "s");
    expect(m.getScore("k")).toBe(0);
  });

  test("save() is a no-op when no filePath is provided", () => {
    const m = store();
    m.recordOutcome("k", false);
    expect(() => m.save()).not.toThrow();
  });
});
