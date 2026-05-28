import * as fs   from "fs";
import * as os   from "os";
import * as path from "path";
import { UptimeTracker } from "../../src/reporters/UptimeTracker";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aiqa-uptime-"));
}

// ── read ──────────────────────────────────────────────────────────────────────

describe("UptimeTracker.read", () => {
  test("returns empty object when uptime.json does not exist", () => {
    const dir = makeTmpDir();
    expect(new UptimeTracker(dir).read()).toEqual({});
  });

  test("returns empty object when uptime.json is corrupt JSON", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "uptime.json"), "not-json");
    expect(new UptimeTracker(dir).read()).toEqual({});
  });

  test("returns parsed log when file is valid", () => {
    const dir  = makeTmpDir();
    const log  = { "tests/login.yaml": [{ date: new Date().toISOString(), passed: true, durationMs: 1000 }] };
    fs.writeFileSync(path.join(dir, "uptime.json"), JSON.stringify(log));
    expect(new UptimeTracker(dir).read()).toEqual(log);
  });
});

// ── append ────────────────────────────────────────────────────────────────────

describe("UptimeTracker.append", () => {
  test("creates uptime.json on first append", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    tracker.append([{ testFile: "tests/a.yaml", passed: true, durationMs: 500 }]);
    expect(fs.existsSync(path.join(dir, "uptime.json"))).toBe(true);
  });

  test("records passed and durationMs correctly", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    tracker.append([{ testFile: "tests/a.yaml", passed: false, durationMs: 1234 }]);
    const log = tracker.read();
    expect(log["tests/a.yaml"]).toHaveLength(1);
    expect(log["tests/a.yaml"][0].passed).toBe(false);
    expect(log["tests/a.yaml"][0].durationMs).toBe(1234);
  });

  test("accumulates multiple entries across calls", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    tracker.append([{ testFile: "tests/a.yaml", passed: true,  durationMs: 100 }]);
    tracker.append([{ testFile: "tests/a.yaml", passed: false, durationMs: 200 }]);
    expect(tracker.read()["tests/a.yaml"]).toHaveLength(2);
  });

  test("handles multiple test files in one append", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    tracker.append([
      { testFile: "tests/a.yaml", passed: true,  durationMs: 100 },
      { testFile: "tests/b.yaml", passed: false, durationMs: 200 },
    ]);
    const log = tracker.read();
    expect(Object.keys(log)).toHaveLength(2);
    expect(log["tests/a.yaml"][0].passed).toBe(true);
    expect(log["tests/b.yaml"][0].passed).toBe(false);
  });

  test("prunes entries older than 30 days", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    const old     = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const log     = { "tests/a.yaml": [{ date: old, passed: true, durationMs: 100 }] };
    fs.writeFileSync(path.join(dir, "uptime.json"), JSON.stringify(log));
    tracker.append([{ testFile: "tests/a.yaml", passed: true, durationMs: 200 }]);
    expect(tracker.read()["tests/a.yaml"]).toHaveLength(1);
    expect(tracker.read()["tests/a.yaml"][0].durationMs).toBe(200);
  });

  test("retains entries within 30 days", () => {
    const dir     = makeTmpDir();
    const tracker = new UptimeTracker(dir);
    const recent  = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const log     = { "tests/a.yaml": [{ date: recent, passed: true, durationMs: 100 }] };
    fs.writeFileSync(path.join(dir, "uptime.json"), JSON.stringify(log));
    tracker.append([{ testFile: "tests/a.yaml", passed: false, durationMs: 200 }]);
    expect(tracker.read()["tests/a.yaml"]).toHaveLength(2);
  });

  test("creates results directory if it does not exist", () => {
    const dir     = path.join(os.tmpdir(), `aiqa-uptime-new-${Date.now()}`);
    const tracker = new UptimeTracker(dir);
    tracker.append([{ testFile: "tests/a.yaml", passed: true, durationMs: 100 }]);
    expect(fs.existsSync(path.join(dir, "uptime.json"))).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── formatSummary ─────────────────────────────────────────────────────────────

describe("UptimeTracker.formatSummary", () => {
  test("returns no-history message when log is empty", () => {
    const dir    = makeTmpDir();
    const result = new UptimeTracker(dir).formatSummary({}, process.cwd());
    expect(result).toContain("no uptime history yet");
  });

  test("shows 100% bar for all-passing file", () => {
    const dir  = makeTmpDir();
    const now  = new Date().toISOString();
    const log  = {
      "/abs/tests/login.yaml": [
        { date: now, passed: true,  durationMs: 100 },
        { date: now, passed: true,  durationMs: 200 },
      ],
    };
    const out = new UptimeTracker(dir).formatSummary(log, "/abs");
    expect(out).toContain("100%");
    expect(out).toContain("██████████");
  });

  test("shows 0% bar and ❌ for all-failing file", () => {
    const dir  = makeTmpDir();
    const now  = new Date().toISOString();
    const log  = { "/abs/tests/bad.yaml": [{ date: now, passed: false, durationMs: 100 }] };
    const out  = new UptimeTracker(dir).formatSummary(log, "/abs");
    expect(out).toContain("0%");
    expect(out).toContain("❌");
  });

  test("sorts worst uptime first", () => {
    const dir  = makeTmpDir();
    const now  = new Date().toISOString();
    const log  = {
      "/abs/tests/good.yaml": [{ date: now, passed: true,  durationMs: 100 }],
      "/abs/tests/bad.yaml":  [{ date: now, passed: false, durationMs: 100 }],
    };
    const out  = new UptimeTracker(dir).formatSummary(log, "/abs");
    expect(out.indexOf("bad.yaml")).toBeLessThan(out.indexOf("good.yaml"));
  });

  test("full date string appears untruncated in output", () => {
    const dir      = makeTmpDir();
    const isoDate  = new Date().toISOString();
    const log      = { "/abs/tests/a.yaml": [{ date: isoDate, passed: true, durationMs: 100 }] };
    const out      = new UptimeTracker(dir).formatSummary(log, "/abs");
    const displayed = new Date(isoDate).toLocaleString();
    // dynamic dateW means the date is never padded to fewer chars than its actual length
    expect(out).toContain(displayed);
  });

  test("shows run count", () => {
    const dir  = makeTmpDir();
    const now  = new Date().toISOString();
    const log  = {
      "/abs/tests/a.yaml": [
        { date: now, passed: true, durationMs: 100 },
        { date: now, passed: true, durationMs: 200 },
        { date: now, passed: true, durationMs: 300 },
      ],
    };
    const out = new UptimeTracker(dir).formatSummary(log, "/abs");
    expect(out).toContain("3");
  });
});
