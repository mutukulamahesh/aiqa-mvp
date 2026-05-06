import * as os   from "os";
import * as path from "path";
import { HealerCache }     from "../../src/healer/HealerCache";
import { HealerAnalytics, RunRecord } from "../../src/healer/HealerAnalytics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpFiles() {
  const base = path.join(os.tmpdir(), `ha-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return { cacheFile: `${base}-cache.json`, logFile: `${base}-runs.json` };
}

function make(overrides: Partial<ReturnType<typeof tmpFiles>> = {}) {
  const files   = { ...tmpFiles(), ...overrides };
  const cache   = new HealerCache(files.cacheFile);
  const analytics = new HealerAnalytics(cache, files.logFile);
  return { cache, analytics };
}

/** Populate a cache entry with the given success/failure counts. */
function withCounts(
  cache: HealerCache,
  pageUrl:     string,
  descriptor:  string,
  selector:    string,
  successes:   number,
  failures:    number,
) {
  cache.set(pageUrl, descriptor, selector, { confidence: 0.9, source: "llm" });
  for (let i = 0; i < successes; i++) cache.markSuccess(pageUrl, descriptor, selector);
  // markFailure evicts at 3; keep failures < 3 unless testing eviction separately
  for (let i = 0; i < failures; i++) cache.markFailure(pageUrl, descriptor, selector);
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId:           "run1",
    timestamp:       new Date().toISOString(),
    url:             "https://example.com",
    seededSelectors: 0,
    testsPassed:     1,
    testsFailed:     0,
    ...overrides,
  };
}

// ── recordRun / getMemoryReuseTrend / getTotalLLMCallsSaved ───────────────────

describe("HealerAnalytics — run log", () => {
  test("getMemoryReuseTrend returns [] when no runs recorded", () => {
    const { analytics } = make();
    expect(analytics.getMemoryReuseTrend()).toEqual([]);
  });

  test("recordRun persists and getMemoryReuseTrend returns it", () => {
    const { analytics } = make();
    const run = makeRun({ runId: "r1", seededSelectors: 3 });
    analytics.recordRun(run);
    const trend = analytics.getMemoryReuseTrend();
    expect(trend).toHaveLength(1);
    expect(trend[0].runId).toBe("r1");
    expect(trend[0].seededSelectors).toBe(3);
  });

  test("multiple runs accumulate in order", () => {
    const { analytics } = make();
    analytics.recordRun(makeRun({ runId: "r1", seededSelectors: 0 }));
    analytics.recordRun(makeRun({ runId: "r2", seededSelectors: 2 }));
    analytics.recordRun(makeRun({ runId: "r3", seededSelectors: 5 }));
    const trend = analytics.getMemoryReuseTrend();
    expect(trend.map(r => r.runId)).toEqual(["r1", "r2", "r3"]);
  });

  test("getMemoryReuseTrend respects lastN cap", () => {
    const { analytics } = make();
    for (let i = 1; i <= 8; i++) analytics.recordRun(makeRun({ runId: `r${i}` }));
    expect(analytics.getMemoryReuseTrend(3)).toHaveLength(3);
    expect(analytics.getMemoryReuseTrend(3).map(r => r.runId)).toEqual(["r6", "r7", "r8"]);
  });

  test("getTotalLLMCallsSaved sums seededSelectors across all runs", () => {
    const { analytics } = make();
    analytics.recordRun(makeRun({ seededSelectors: 0 }));
    analytics.recordRun(makeRun({ seededSelectors: 3 }));
    analytics.recordRun(makeRun({ seededSelectors: 5 }));
    expect(analytics.getTotalLLMCallsSaved()).toBe(8);
  });

  test("getTotalLLMCallsSaved returns 0 when no runs", () => {
    const { analytics } = make();
    expect(analytics.getTotalLLMCallsSaved()).toBe(0);
  });
});

// ── getTopUnstablePages ───────────────────────────────────────────────────────

describe("HealerAnalytics — getTopUnstablePages", () => {
  test("returns [] for empty cache", () => {
    const { analytics } = make();
    expect(analytics.getTopUnstablePages()).toEqual([]);
  });

  test("excludes pages with zero uses", () => {
    const { cache, analytics } = make();
    cache.set("https://app.com/login", "email", "#email");
    // no successes or failures recorded — totalUses = 0
    expect(analytics.getTopUnstablePages()).toEqual([]);
  });

  test("computes failureRate correctly", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/checkout", "submit", "#btn", 3, 2); // 5 uses, 2 fails = 40%
    const [page] = analytics.getTopUnstablePages();
    expect(page.pageUrl).toBe("https://app.com/checkout");
    expect(page.totalUses).toBe(5);
    expect(page.failures).toBe(2);
    expect(page.failureRate).toBe(40);
  });

  test("ranks by failure count descending, then failure rate", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/login",    "email",  "#e", 10, 1); // 1 failure, 9% rate
    withCounts(cache, "https://app.com/checkout", "submit", "#b", 3,  2); // 2 failures, 40% rate
    const pages = analytics.getTopUnstablePages();
    expect(pages[0].pageUrl).toContain("checkout");
    expect(pages[1].pageUrl).toContain("login");
  });

  test("respects topN cap", () => {
    const { cache, analytics } = make();
    for (let i = 1; i <= 6; i++) {
      withCounts(cache, `https://app.com/page${i}`, "btn", "#b", 1, 1);
    }
    expect(analytics.getTopUnstablePages(3)).toHaveLength(3);
  });

  test("stable page (no failures) has failureRate 0 and appears last", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/home",     "btn", "#b", 5, 0); // 0 failures
    withCounts(cache, "https://app.com/checkout", "btn", "#b", 3, 2); // 2 failures
    const pages = analytics.getTopUnstablePages();
    expect(pages[0].pageUrl).toContain("checkout");
    const home = pages.find(p => p.pageUrl.endsWith("/home"));
    expect(home?.failures).toBe(0);
    expect(home?.failureRate).toBe(0);
  });
});

// ── getMostHealedSelectors ────────────────────────────────────────────────────

describe("HealerAnalytics — getMostHealedSelectors", () => {
  test("returns [] for empty cache", () => {
    const { analytics } = make();
    expect(analytics.getMostHealedSelectors()).toEqual([]);
  });

  test("omits descriptors with zero uses", () => {
    const { cache, analytics } = make();
    cache.set("https://app.com", "btn", "#b");
    expect(analytics.getMostHealedSelectors()).toEqual([]);
  });

  test("computes successRate correctly", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com", "email", "#e", 4, 1); // 5 uses, 4 successes = 80%
    const [stat] = analytics.getMostHealedSelectors();
    expect(stat.descriptor).toBe("email");
    expect(stat.totalUses).toBe(5);
    expect(stat.successRate).toBe(80);
  });

  test("ranks by totalUses descending", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com", "email",  "#e",  4, 1); // 5 total
    withCounts(cache, "https://app.com", "submit", "#btn", 10, 0); // 10 total
    withCounts(cache, "https://app.com", "nav",    "#n",  2, 0); // 2 total
    const stats = analytics.getMostHealedSelectors();
    expect(stats[0].descriptor).toBe("submit");
    expect(stats[1].descriptor).toBe("email");
    expect(stats[2].descriptor).toBe("nav");
  });

  test("includes status from the most-used entry", () => {
    const { cache, analytics } = make();
    // 3 successes → validated
    withCounts(cache, "https://app.com", "email", "#e", 3, 0);
    const [stat] = analytics.getMostHealedSelectors();
    expect(stat.status).toBe("validated");
  });

  test("respects topN cap", () => {
    const { cache, analytics } = make();
    for (let i = 1; i <= 8; i++) {
      withCounts(cache, "https://app.com", `desc${i}`, `#s${i}`, i, 0);
    }
    expect(analytics.getMostHealedSelectors(4)).toHaveLength(4);
  });
});

// ── getFlakiestSteps ──────────────────────────────────────────────────────────

describe("HealerAnalytics — getFlakiestSteps", () => {
  test("returns [] for empty cache", () => {
    const { analytics } = make();
    expect(analytics.getFlakiestSteps()).toEqual([]);
  });

  test("excludes entries with no failures", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com", "email", "#e", 5, 0);
    expect(analytics.getFlakiestSteps()).toEqual([]);
  });

  test("computes failureRate per individual entry", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/login", "email", "#email", 2, 1); // 1/3 = 33%
    const [step] = analytics.getFlakiestSteps();
    expect(step.selector).toBe("#email");
    expect(step.descriptor).toBe("email");
    expect(step.failureRate).toBe(33);
    expect(step.uses).toBe(3);
  });

  test("ranks by failureRate descending, then uses", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com", "A", "#a", 1, 2); // 2/3 = 67%
    withCounts(cache, "https://app.com", "B", "#b", 2, 1); // 1/3 = 33%
    const steps = analytics.getFlakiestSteps();
    expect(steps[0].descriptor).toBe("A");
    expect(steps[1].descriptor).toBe("B");
  });

  test("respects topN cap", () => {
    const { cache, analytics } = make();
    for (let i = 1; i <= 6; i++) {
      withCounts(cache, "https://app.com", `d${i}`, `#s${i}`, 2, 1); // 3 uses — meets min threshold
    }
    expect(analytics.getFlakiestSteps(3)).toHaveLength(3);
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe("HealerAnalytics — getReport", () => {
  test("returns well-structured report with all fields present", () => {
    const { analytics } = make();
    const report = analytics.getReport();
    expect(report).toMatchObject({
      generatedAt:         expect.any(String),
      totalRuns:           0,
      totalLLMCallsSaved:  0,
      topUnstablePages:    [],
      mostHealedSelectors: [],
      flakiestSteps:       [],
      memoryReuseTrend:    [],
    });
  });

  test("reflects recorded runs and cache data together", () => {
    const { cache, analytics } = make();
    analytics.recordRun(makeRun({ seededSelectors: 4 }));
    analytics.recordRun(makeRun({ seededSelectors: 6 }));
    withCounts(cache, "https://app.com/login", "email", "#e", 5, 0);
    withCounts(cache, "https://app.com/checkout", "btn", "#b", 2, 2);

    const report = analytics.getReport(5);
    expect(report.totalRuns).toBe(2);
    expect(report.totalLLMCallsSaved).toBe(10);
    expect(report.mostHealedSelectors.length).toBeGreaterThan(0);
    expect(report.topUnstablePages.length).toBeGreaterThan(0);
    expect(report.memoryReuseTrend).toHaveLength(2);
  });
});

// ── HealerAnalytics.format ────────────────────────────────────────────────────

describe("HealerAnalytics.format", () => {
  test("returns empty string when no runs and no cache data", () => {
    const { analytics } = make();
    expect(HealerAnalytics.format(analytics.getReport())).toBe("");
  });

  test("includes LLM calls saved when runs exist", () => {
    const { analytics } = make();
    analytics.recordRun(makeRun({ seededSelectors: 5 }));
    analytics.recordRun(makeRun({ seededSelectors: 3 }));
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("LLM calls saved");
    expect(out).toContain("8");
  });

  test("includes memory reuse trend with seeded/cold labels", () => {
    const { analytics } = make();
    analytics.recordRun(makeRun({ runId: "r1", seededSelectors: 0 }));
    analytics.recordRun(makeRun({ runId: "r2", seededSelectors: 4 }));
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("cache cold");
    expect(out).toContain("4 seeded");
    expect(out).toContain("4 heals avoided");
  });

  test("includes most healed selectors section when cache has data", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com", "email", "#e", 5, 0);
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("Most healed selectors");
    expect(out).toContain("email");
  });

  test("includes top unstable pages when failures exist", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/checkout", "submit", "#btn", 3, 2);
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("Top unstable pages");
    expect(out).toContain("/checkout");
  });

  test("includes flakiest steps when individual entries have failures", () => {
    const { cache, analytics } = make();
    withCounts(cache, "https://app.com/login", "email", "#e", 2, 1);
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("Flakiest steps");
    expect(out).toContain("email");
    expect(out).toContain("#e");
  });

  test("shows 'no data' message when runs exist but cache is empty", () => {
    const { analytics } = make();
    analytics.recordRun(makeRun({ seededSelectors: 0 }));
    const out = HealerAnalytics.format(analytics.getReport());
    expect(out).toContain("No healing data yet");
  });
});
