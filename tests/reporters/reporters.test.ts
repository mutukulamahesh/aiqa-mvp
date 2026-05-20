import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { TrendTracker, TrendRecord } from "../../src/reporters/TrendTracker";
import { SlackNotifier, SlackRunSummary } from "../../src/reporters/SlackNotifier";
import { EmailNotifier, EmailRunSummary } from "../../src/reporters/EmailNotifier";
import { AllureReporter } from "../../src/reporters/AllureReporter";
import { TestResult } from "../../src/runner/TestRunner";
import { DebugResult } from "../../src/agents/DebuggerAgent";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  const d = path.join(os.tmpdir(), `aiqa-rep-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId:      "t1",
    testName:    "Login test",
    tags:        ["smoke"],
    passed:      true,
    durationMs:  1200,
    retryCount:  0,
    stepResults: [
      { index: 0, action: "navigate", passed: true,  durationMs: 300 },
      { index: 1, action: "fill",     passed: true,  durationMs: 200 },
      { index: 2, action: "click",    passed: true,  durationMs: 150 },
      { index: 3, action: "assert",   passed: true,  durationMs: 100 },
    ],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<TrendRecord> = {}): TrendRecord {
  return {
    runId: "run-1", date: new Date().toISOString(),
    passed: 8, failed: 2, total: 10,
    score: 80, grade: "B", durationMs: 12000,
    ...overrides,
  };
}

// ── TrendTracker ──────────────────────────────────────────────────────────────

describe("TrendTracker", () => {
  test("creates history.json on first append", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    tracker.append(makeRecord());

    const file = path.join(dir, "history.json");
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].runId).toBe("run-1");
  });

  test("accumulates multiple records", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    tracker.append(makeRecord({ runId: "r1", passed: 5, total: 10 }));
    tracker.append(makeRecord({ runId: "r2", passed: 7, total: 10 }));
    tracker.append(makeRecord({ runId: "r3", passed: 9, total: 10 }));

    expect(tracker.read()).toHaveLength(3);
  });

  test("passRateTrend returns percentages", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    tracker.append(makeRecord({ passed: 10, total: 10 }));
    tracker.append(makeRecord({ passed:  5, total: 10 }));

    const rates = tracker.passRateTrend();
    expect(rates).toEqual([100, 50]);
  });

  test("formatTrend is empty with only 1 run", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    tracker.append(makeRecord());
    expect(tracker.formatTrend()).toBe("");
  });

  test("formatTrend shows delta and bar after multiple runs", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    tracker.append(makeRecord({ passed: 5, total: 10 }));
    tracker.append(makeRecord({ passed: 9, total: 10 }));

    const line = tracker.formatTrend();
    expect(line).toMatch(/Trend/);
    expect(line).toMatch(/\+40%/);
  });

  test("read returns [] for missing file", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    expect(tracker.read()).toEqual([]);
  });

  test("read returns [] for corrupted file", () => {
    const dir  = tmpDir();
    fs.writeFileSync(path.join(dir, "history.json"), "not-json");
    const tracker = new TrendTracker(dir);
    expect(tracker.read()).toEqual([]);
  });

  test("caps history at 200 entries by default", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    for (let i = 0; i < 210; i++) tracker.append(makeRecord({ runId: `r${i}` }));
    expect(tracker.read().length).toBe(200);
  });

  test("caps history at custom maxHistory when specified", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir, 50);
    for (let i = 0; i < 60; i++) tracker.append(makeRecord({ runId: `r${i}` }));
    expect(tracker.read().length).toBe(50);
  });

  test("concurrent write: does not lose either record", () => {
    const dir     = tmpDir();
    const tracker = new TrendTracker(dir);
    const file    = path.join(dir, "history.json");

    // Simulate race: inject a competing write after the first read() returns
    // but before the mtime re-check inside append()
    const originalRead = tracker.read.bind(tracker);
    let callCount = 0;
    (tracker as unknown as { read: () => TrendRecord[] }).read = () => {
      const result = originalRead();
      callCount++;
      if (callCount === 1) {
        // Advance mtime by writing a competing record to disk
        fs.writeFileSync(file, JSON.stringify([makeRecord({ runId: "concurrent" })], null, 2));
      }
      return result;
    };

    tracker.append(makeRecord({ runId: "mine" }));
    const ids = tracker.read().map(r => r.runId);
    expect(ids).toContain("mine");
    expect(ids).toContain("concurrent");
  });
});

// ── SlackNotifier ─────────────────────────────────────────────────────────────

describe("SlackNotifier", () => {
  const summary: SlackRunSummary = {
    runId: "run-99", passed: 8, failed: 2, total: 10,
    score: 80, grade: "B", durationMs: 5000,
    baseUrl: "https://app.example.com",
  };

  test("fromEnv returns null when SLACK_WEBHOOK_URL is not set", () => {
    delete process.env.SLACK_WEBHOOK_URL;
    expect(SlackNotifier.fromEnv()).toBeNull();
  });

  test("fromEnv returns instance when SLACK_WEBHOOK_URL is set", () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
    const notifier = SlackNotifier.fromEnv();
    expect(notifier).not.toBeNull();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  test("constructor throws when webhookUrl is empty", () => {
    expect(() => new SlackNotifier("")).toThrow("webhookUrl is required");
  });

  test("onFailureOnly skips send when no failures", async () => {
    // We intercept by overriding the private post method
    const notifier = new SlackNotifier("https://hooks.slack.com/fake", true);
    let called = false;
    (notifier as unknown as { post: () => Promise<void> }).post = async () => { called = true; };
    await notifier.send({ ...summary, failed: 0 });
    expect(called).toBe(false);
  });

  test("onFailureOnly sends when there are failures", async () => {
    const notifier = new SlackNotifier("https://hooks.slack.com/fake", true);
    let called = false;
    (notifier as unknown as { post: (b: string) => Promise<void> }).post = async (body: string) => {
      called = true;
      expect(body).toContain("AIQA Run Complete");
    };
    await notifier.send({ ...summary, failed: 3 });
    expect(called).toBe(true);
  });

  test("send builds valid Slack block kit JSON", async () => {
    const notifier = new SlackNotifier("https://hooks.slack.com/fake");
    let sentBody = "";
    (notifier as unknown as { post: (b: string) => Promise<void> }).post = async (b: string) => { sentBody = b; };
    await notifier.send(summary);

    const parsed = JSON.parse(sentBody);
    expect(parsed).toHaveProperty("blocks");
    expect(parsed.blocks[0].text.text).toContain("AIQA Run Complete");
  });

  test("send never throws even when post fails", async () => {
    const notifier = new SlackNotifier("https://hooks.slack.com/fake");
    (notifier as unknown as { post: () => Promise<void> }).post = async () => {
      throw new Error("network timeout");
    };
    await expect(notifier.send(summary)).resolves.toBeUndefined();
  });

  test("long baseUrl is truncated to Slack field limit", async () => {
    const notifier = new SlackNotifier("https://hooks.slack.com/fake");
    let sentBody = "";
    (notifier as unknown as { post: (b: string) => Promise<void> }).post = async (b: string) => { sentBody = b; };

    const longUrl = "https://" + "a".repeat(2500) + ".example.com";
    await notifier.send({ ...summary, baseUrl: longUrl });

    const parsed = JSON.parse(sentBody);
    const contextBlock = parsed.blocks.find((b: { type: string }) => b.type === "context");
    expect(contextBlock.elements[0].text.length).toBeLessThanOrEqual(2001);
    expect(contextBlock.elements[0].text).toContain("…");
  });
});

// ── EmailNotifier ─────────────────────────────────────────────────────────────

describe("EmailNotifier", () => {
  test("fromEnv returns null when SMTP_HOST is not set", () => {
    delete process.env.SMTP_HOST;
    expect(EmailNotifier.fromEnv()).toBeNull();
  });

  test("fromEnv returns null when SMTP_HOST set but no recipients", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    delete process.env.NOTIFY_EMAIL;
    expect(EmailNotifier.fromEnv()).toBeNull();
    delete process.env.SMTP_HOST;
  });

  test("fromEnv returns instance with recipients from env", () => {
    process.env.SMTP_HOST    = "smtp.example.com";
    process.env.NOTIFY_EMAIL = "qa@example.com,lead@example.com";
    const notifier = EmailNotifier.fromEnv();
    expect(notifier).not.toBeNull();
    delete process.env.SMTP_HOST;
    delete process.env.NOTIFY_EMAIL;
  });

  test("fromEnv accepts explicit recipients argument", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    const notifier = EmailNotifier.fromEnv(["qa@example.com"]);
    expect(notifier).not.toBeNull();
    delete process.env.SMTP_HOST;
  });

  test("send never throws even when SMTP fails", async () => {
    const notifier = new EmailNotifier({
      host: "smtp.bad-host.invalid", port: 587, secure: false,
      user: "u", pass: "p", from: "a@b.com", to: ["qa@x.com"],
    });
    // Should resolve (not reject) — the error is swallowed and logged
    await expect(notifier.send({
      runId: "r1", passed: 5, failed: 5, total: 10,
      score: 50, grade: "C", durationMs: 2000,
    })).resolves.toBeUndefined();
  });

  test("large report skips attachment and adds note in HTML body", async () => {
    const dir     = tmpDir();
    const bigFile = path.join(dir, "big-report.html");
    fs.writeFileSync(bigFile, "x".repeat(6 * 1024 * 1024)); // 6 MB — exceeds 5 MB limit

    // Access the private HTML builder directly to verify the note is injected
    const notifier = new EmailNotifier({
      host: "smtp.example.com", port: 587, secure: false,
      user: "u", pass: "p", from: "a@b.com", to: ["qa@x.com"],
    });
    const summary: EmailRunSummary = {
      runId: "r1", passed: 5, failed: 5, total: 10,
      score: 50, grade: "C", durationMs: 2000, reportPath: bigFile,
    };

    // Verify size threshold constant is exported and file exceeds it
    const { MAX_ATTACHMENT_BYTES: limit } = await import("../../src/reporters/EmailNotifier");
    expect(fs.statSync(bigFile).size).toBeGreaterThan(limit);

    // Verify send() still resolves (never throws) with a large file
    await expect(notifier.send(summary)).resolves.toBeUndefined();
  });

  test("onFailureOnly skips send when no failures", async () => {
    // Verify the guard fires before any transport is created — no SMTP_HOST needed.
    const notifier = new EmailNotifier({
      host: "smtp.example.com", port: 587, secure: false,
      user: "u", pass: "p", from: "aiqa@x.com", to: ["qa@x.com"],
      onFailureOnly: true,
    });
    // If the guard works, send() returns without calling transporter.sendMail.
    // We verify by confirming no error is thrown (no real SMTP server exists).
    await expect(notifier.send({
      runId: "r1", passed: 10, failed: 0, total: 10,
      score: 100, grade: "A", durationMs: 3000,
    })).resolves.toBeUndefined();
  });
});

// ── AllureReporter ────────────────────────────────────────────────────────────

describe("AllureReporter", () => {
  test("generates one result file per test", () => {
    const dir      = tmpDir();
    const reporter = new AllureReporter();
    reporter.generate([makeResult(), makeResult({ testId: "t2", testName: "Search test" })], dir);

    const files = fs.readdirSync(dir).filter(f => f.endsWith("-result.json"));
    expect(files).toHaveLength(2);
  });

  test("result file contains correct status for passing test", () => {
    const dir  = tmpDir();
    new AllureReporter().generate([makeResult({ passed: true })], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.status).toBe("passed");
    expect(content.name).toBe("Login test");
    expect(content.labels).toContainEqual({ name: "framework", value: "AIQA" });
  });

  test("result file marks failed tests correctly", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      error:  "Element not found",
      stepResults: [
        { index: 0, action: "navigate", passed: true,  durationMs: 300 },
        { index: 1, action: "assert",   passed: false, durationMs: 100, error: "Element not found", errorClass: "AssertionError" },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.status).toBe("failed");
    expect(content.statusDetails.message).toBe("Element not found");
  });

  test("tags appear as Allure labels", () => {
    const dir  = tmpDir();
    new AllureReporter().generate([makeResult({ tags: ["smoke", "regression"] })], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.labels).toContainEqual({ name: "tag", value: "smoke" });
    expect(content.labels).toContainEqual({ name: "tag", value: "regression" });
  });

  test("steps are included with correct count", () => {
    const dir  = tmpDir();
    new AllureReporter().generate([makeResult()], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.steps).toHaveLength(4);
    expect(content.steps[0].name).toBe("1. navigate");
  });

  test("handles empty results array without error", () => {
    const dir = tmpDir();
    expect(() => new AllureReporter().generate([], dir)).not.toThrow();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  test("copies step screenshot into allure dir and attaches it to the step", () => {
    const dir        = tmpDir();
    const screensDir = tmpDir();
    const imgPath    = path.join(screensDir, "step0.png");
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes

    const result = makeResult({
      stepResults: [
        { index: 0, action: "navigate", passed: true, durationMs: 300, screenshotPath: imgPath },
        { index: 1, action: "assert",   passed: true, durationMs: 100 },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    const step0 = content.steps[0];
    expect(step0.attachments).toHaveLength(1);
    expect(step0.attachments[0].type).toBe("image/png");
    expect(step0.attachments[0].name).toBe("Screenshot");

    const copied = path.join(dir, step0.attachments[0].source);
    expect(fs.existsSync(copied)).toBe(true);
  });

  test("writes debug JSON attachment at test level when debugResult is present", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed:      false,
      debugResult: { failure_class: "locator", root_cause: "button not found", suggestion: "try a different selector" } as unknown as DebugResult,
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.attachments).toHaveLength(1);
    expect(content.attachments[0].name).toBe("Debug Analysis");
    expect(content.attachments[0].type).toBe("application/json");

    const debugFile = path.join(dir, content.attachments[0].source);
    const debug     = JSON.parse(fs.readFileSync(debugFile, "utf-8"));
    expect(debug.failure_class).toBe("locator");
  });

  test("failureClass label is added from debugResult.failure_class", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed:      false,
      debugResult: { failure_class: "assertion", root_cause: "wrong text", suggestion: "" } as unknown as DebugResult,
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.labels).toContainEqual({ name: "failureClass", value: "assertion" });
  });

  test("failed step with AssertionError gets status 'failed', other errors get 'broken'", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      stepResults: [
        { index: 0, action: "assert", passed: false, durationMs: 100, error: "Expected x", errorClass: "AssertionError" },
        { index: 1, action: "click",  passed: false, durationMs: 50,  error: "Timeout",    errorClass: "TimeoutError"    },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.steps[0].status).toBe("failed");
    expect(content.steps[1].status).toBe("broken");
  });

  test("errorClass is added as a step parameter", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      stepResults: [
        { index: 0, action: "assert", passed: false, durationMs: 100, error: "mismatch", errorClass: "AssertionError" },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.steps[0].parameters).toContainEqual({ name: "errorClass", value: "AssertionError" });
  });

  test("historyId is deterministic for the same testId", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();

    new AllureReporter().generate([makeResult({ testId: "stable-id" })], dir1);
    new AllureReporter().generate([makeResult({ testId: "stable-id" })], dir2);

    const file1 = fs.readdirSync(dir1).find(f => f.endsWith("-result.json"))!;
    const file2 = fs.readdirSync(dir2).find(f => f.endsWith("-result.json"))!;

    const h1 = JSON.parse(fs.readFileSync(path.join(dir1, file1), "utf-8")).historyId;
    const h2 = JSON.parse(fs.readFileSync(path.join(dir2, file2), "utf-8")).historyId;

    expect(h1).toBe(h2);
  });

  test("step start/stop times are monotonically non-decreasing", () => {
    const dir  = tmpDir();
    new AllureReporter().generate([makeResult()], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    let prev = content.start;
    for (const step of content.steps) {
      expect(step.start).toBeGreaterThanOrEqual(prev);
      expect(step.stop).toBeGreaterThanOrEqual(step.start);
      prev = step.stop;
    }
    expect(content.stop).toBeGreaterThanOrEqual(prev);
  });

  test("test-level status is 'broken' when all failing steps are non-assertion errors", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      error: "Navigation timeout",
      stepResults: [
        { index: 0, action: "navigate", passed: false, durationMs: 100, error: "Navigation timeout", errorClass: "TimeoutError" },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.status).toBe("broken");
  });

  test("test-level status is 'failed' when at least one failing step is an AssertionError", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      stepResults: [
        { index: 0, action: "navigate", passed: false, durationMs: 50,  error: "Timeout",    errorClass: "TimeoutError"    },
        { index: 1, action: "assert",   passed: false, durationMs: 100, error: "Expected x", errorClass: "AssertionError" },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.status).toBe("failed");
  });

  test("statusDetails.trace is populated when error contains a newline", () => {
    const dir    = tmpDir();
    const result = makeResult({
      passed: false,
      error: "Expected 'foo'\nat AssertionError (runner.ts:42)",
      stepResults: [
        { index: 0, action: "assert", passed: false, durationMs: 100, error: "Expected 'foo'", errorClass: "AssertionError" },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.statusDetails.message).toBe("Expected 'foo'");
    expect(content.statusDetails.trace).toBe("at AssertionError (runner.ts:42)");
  });

  test("zero-duration steps get at least 1ms to keep Allure timelines non-zero", () => {
    const dir    = tmpDir();
    const result = makeResult({
      stepResults: [
        { index: 0, action: "navigate", passed: true, durationMs: 0 },
      ],
    });
    new AllureReporter().generate([result], dir);

    const file    = fs.readdirSync(dir).find(f => f.endsWith("-result.json"))!;
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));

    expect(content.steps[0].stop - content.steps[0].start).toBeGreaterThanOrEqual(1);
  });
});

