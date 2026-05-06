import * as fs   from "fs";
import * as os   from "os";
import * as path from "path";
import { HealerCache }    from "../../src/healer/HealerCache";
import { SelectorHealer } from "../../src/healer/SelectorHealer";
import { LLMProvider, LLMRequest, LLMResponse } from "../../src/llm/LLMProvider";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpCache(): string {
  return path.join(os.tmpdir(), `healer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function stubLLM(selector: string): LLMProvider {
  return {
    name: "stub",
    complete: async (_req: LLMRequest): Promise<LLMResponse> => ({
      content: selector,
      model:   "stub",
    }),
  };
}

const nullLLM: LLMProvider = {
  name: "stub",
  complete: async () => ({ content: "null", model: "stub" }),
};

const mockLLM: LLMProvider = {
  name: "mock",
  complete: async () => ({ content: "", model: "mock" }),
};

/**
 * Minimal Page mock.
 * selectorCount controls what page.locator(sel).count() returns.
 * Pass a Map to return different counts per selector.
 * locatorText is returned by locator().textContent() (null = no visible text).
 */
function makePage(
  candidate: Record<string, string> = {},
  selectorCount: number | Map<string, number> = 1,
  locatorText: string | null = null,
) {
  return {
    evaluate: async (_fn: unknown) => [
      {
        tag:      candidate.tag      ?? "input",
        id:       candidate.id       ?? "login-button",
        dataTest: candidate.dataTest ?? "login-button",
        type:     candidate.type     ?? "submit",
        text:     candidate.text     ?? "Login",
      },
    ],
    locator: (sel: string) => ({
      count: async () =>
        typeof selectorCount === "number"
          ? selectorCount
          : (selectorCount.get(sel) ?? 0),
      textContent:  async () => locatorText,
      getAttribute: async (_attr: string) => null as string | null,
    }),
    title: async () => "Test Page",
  };
}

// ── HealerCache ───────────────────────────────────────────────────────────────

describe("HealerCache", () => {
  test("returns undefined for unknown descriptor", () => {
    const cache = new HealerCache(tmpCache());
    expect(cache.get("https://example.com", "login_button")).toBeUndefined();
  });

  test("stores and retrieves a selector", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "login_button", '[data-test="login-button"]');
    expect(cache.get("https://example.com", "login_button")).toBe('[data-test="login-button"]');
  });

  test("persists to disk and reloads on next instantiation", () => {
    const file = tmpCache();
    const c1 = new HealerCache(file);
    c1.set("https://example.com", "submit", "#submit-btn");

    const c2 = new HealerCache(file);
    expect(c2.get("https://example.com", "submit")).toBe("#submit-btn");

    fs.unlinkSync(file);
  });

  test("isolates selectors by page URL", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://app-a.com", "btn", "#a");
    cache.set("https://app-b.com", "btn", "#b");

    expect(cache.get("https://app-a.com", "btn")).toBe("#a");
    expect(cache.get("https://app-b.com", "btn")).toBe("#b");
  });

  test("overwrites existing entry when set again with same selector", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "menu", "#menu", { confidence: 0.5 });
    cache.set("https://example.com", "menu", "#menu", { confidence: 0.9 });
    // Still one entry, updated confidence
    expect(cache.getAll("https://example.com", "menu")).toHaveLength(1);
    expect(cache.get("https://example.com", "menu")).toBe("#menu");
  });

  test("normalizes URL — strips query params from cache key", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com/page?session=abc123&ts=999", "btn", "#x");
    expect(cache.get("https://example.com/page", "btn")).toBe("#x");
    expect(cache.get("https://example.com/page?different=params", "btn")).toBe("#x");
  });

  // ── Multi-selector (ranking) ───────────────────────────────────────────────

  test("getAll returns all selectors for a descriptor", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#a", { confidence: 0.7 });
    cache.set("https://example.com", "btn", "#b", { confidence: 0.9 });
    const all = cache.getAll("https://example.com", "btn");
    expect(all).toContain("#a");
    expect(all).toContain("#b");
    expect(all).toHaveLength(2);
  });

  test("getAll returns selectors ranked by score — higher confidence first", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#low",  { confidence: 0.5 });
    cache.set("https://example.com", "btn", "#high", { confidence: 0.9 });
    const all = cache.getAll("https://example.com", "btn");
    expect(all[0]).toBe("#high");
    expect(all[1]).toBe("#low");
  });

  test("get returns the highest-scored selector", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#low",  { confidence: 0.4 });
    cache.set("https://example.com", "btn", "#high", { confidence: 0.95 });
    expect(cache.get("https://example.com", "btn")).toBe("#high");
  });

  test("successCount boosts score — most-used selector wins", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#a", { confidence: 0.85 });
    cache.set("https://example.com", "btn", "#b", { confidence: 0.85 });
    // Give #b more successes
    cache.markSuccess("https://example.com", "btn", "#b");
    cache.markSuccess("https://example.com", "btn", "#b");
    expect(cache.get("https://example.com", "btn")).toBe("#b");
  });

  // ── markSuccess / markFailure / eviction ───────────────────────────────────

  test("markSuccess increments successCount without eviction", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#x");
    cache.markSuccess("https://example.com", "btn", "#x");
    cache.markSuccess("https://example.com", "btn", "#x");
    expect(cache.get("https://example.com", "btn")).toBe("#x");
    const entries = cache.entries()["https://example.com/"]["btn"];
    expect(entries[0].successCount).toBe(2);
  });

  test("markFailure evicts specific selector after EVICT_THRESHOLD (3) failures", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#x");
    cache.markFailure("https://example.com", "btn", "#x");
    cache.markFailure("https://example.com", "btn", "#x");
    expect(cache.get("https://example.com", "btn")).toBe("#x"); // still alive at 2
    cache.markFailure("https://example.com", "btn", "#x");      // evicted at 3
    expect(cache.get("https://example.com", "btn")).toBeUndefined();
  });

  test("markFailure without selector targets best-scored entry", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#best",  { confidence: 0.9 });
    cache.set("https://example.com", "btn", "#other", { confidence: 0.4 });
    cache.markFailure("https://example.com", "btn"); // targets #best
    const entries = cache.entries()["https://example.com/"]["btn"];
    const best = entries.find(e => e.selector === "#best")!;
    expect(best.failureCount).toBe(1);
    const other = entries.find(e => e.selector === "#other")!;
    expect(other.failureCount).toBe(0);
  });

  test("evicting one selector leaves the others intact", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#a");
    cache.set("https://example.com", "btn", "#b");
    for (let i = 0; i < 3; i++) cache.markFailure("https://example.com", "btn", "#a");
    expect(cache.get("https://example.com", "btn")).toBe("#b");
    expect(cache.getAll("https://example.com", "btn")).toEqual(["#b"]);
  });

  test("markFailure is a no-op for unknown descriptors", () => {
    const cache = new HealerCache(tmpCache());
    expect(() => cache.markFailure("https://example.com", "ghost")).not.toThrow();
  });

  test("migrates legacy string-value cache file on load", () => {
    const file = tmpCache();
    fs.writeFileSync(file, JSON.stringify({
      "https://example.com/": { "btn": "#legacy" },
    }));
    const cache = new HealerCache(file);
    expect(cache.get("https://example.com/", "btn")).toBe("#legacy");
    fs.unlinkSync(file);
  });

  test("migrates legacy single-CacheEntry format on load", () => {
    const file = tmpCache();
    fs.writeFileSync(file, JSON.stringify({
      "https://example.com/": {
        "btn": { selector: "#x", confidence: 0.85, source: "llm",
                 lastUsed: new Date().toISOString(), successCount: 1, failureCount: 0 },
      },
    }));
    const cache = new HealerCache(file);
    expect(cache.get("https://example.com/", "btn")).toBe("#x");
    fs.unlinkSync(file);
  });

  // ── Refinement 1: cap selector list ───────────────────────────────────────

  test("caps selector list at 5 — drops lowest-scored entry on overflow", () => {
    const cache = new HealerCache(tmpCache());
    // Add 6 selectors with increasing confidence; #s1 (lowest) should be evicted
    for (let i = 1; i <= 6; i++) {
      cache.set("https://example.com", "btn", `#s${i}`, { confidence: i * 0.1 + 0.3 });
    }
    const all = cache.getAll("https://example.com", "btn");
    expect(all).toHaveLength(5);
    expect(all).not.toContain("#s1"); // lowest confidence — evicted
    expect(all).toContain("#s6");     // highest — kept
  });

  // ── Refinement 2: score decay ──────────────────────────────────────────────

  test("score decay — a 60-day-old entry with high successCount ranks below a fresh entry", () => {
    const file    = tmpCache();
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    fs.writeFileSync(file, JSON.stringify({
      "https://example.com/": {
        "btn": [
          { selector: "#old", confidence: 0.85, source: "llm", lastUsed: oldDate,                    successCount: 10, failureCount: 0 },
          { selector: "#new", confidence: 0.85, source: "llm", lastUsed: new Date().toISOString(),   successCount: 0,  failureCount: 0 },
        ],
      },
    }));
    const cache = new HealerCache(file);
    // #old: 8.5 + 10*2*exp(-60/30) ≈ 8.5 + 2.7  = 11.2  (recencyBoost = 0 at 60 days)
    // #new: 8.5 + 0                + 7            = 15.5  (full recencyBoost)
    expect(cache.get("https://example.com/", "btn")).toBe("#new");
    fs.unlinkSync(file);
  });

  // ── Refinement 3: confidence calibration ──────────────────────────────────

  test("markSuccess raises confidence toward 1 via calibration", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#x", { confidence: 0.5 });
    cache.markSuccess("https://example.com", "btn", "#x");
    cache.markSuccess("https://example.com", "btn", "#x");
    const entry = cache.entries()["https://example.com/"]["btn"][0];
    // successRate = 1.0 → confidence moves toward 1
    expect(entry.confidence).toBeGreaterThan(0.5);
  });

  test("markFailure lowers confidence toward 0 via calibration", () => {
    const cache = new HealerCache(tmpCache());
    cache.set("https://example.com", "btn", "#x", { confidence: 0.85 });
    cache.markFailure("https://example.com", "btn", "#x");
    const entry = cache.entries()["https://example.com/"]["btn"][0];
    // successRate = 0.0 → confidence = 0.85*0.7 = 0.595
    expect(entry.confidence).toBeLessThan(0.85);
  });
});

// ── SelectorHealer — cache layer ──────────────────────────────────────────────

describe("SelectorHealer — cache", () => {
  test("getCached returns undefined before any healing", () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    expect(healer.getCached("https://example.com", "login_button")).toBeUndefined();
  });

  test("getCached returns entry written directly to cache", () => {
    const file = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "login_button", '[data-test="login-button"]');
    expect(healer.getCached("https://example.com", "login_button")).toBe('[data-test="login-button"]');
  });
});

// ── SelectorHealer — tryCache (multi-selector fallback) ──────────────────────

describe("SelectorHealer — tryCache", () => {
  test("returns null when no cached selectors exist", async () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.tryCache("https://example.com", "btn", makePage() as any);
    expect(result).toBeNull();
  });

  test("returns valid cached selector when count === 1", async () => {
    const file = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "btn", "#x");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.tryCache("https://example.com", "btn", makePage({}, 1) as any);
    expect(result).toBe("#x");
  });

  test("skips stale selector (count !== 1) and returns next valid one", async () => {
    const file = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "btn", "#stale", { confidence: 0.9 });
    healer.cache.set("https://example.com", "btn", "#valid", { confidence: 0.5 });

    // #stale returns 0 (not found), #valid returns 1
    const counts = new Map([["#stale", 0], ["#valid", 1]]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.tryCache("https://example.com", "btn", makePage({}, counts) as any);
    expect(result).toBe("#valid");
    // #stale should be marked failed
    expect(healer.getCached("https://example.com", "btn")).toBe("#valid");
  });

  test("evicts stale selector and returns null when all are invalid", async () => {
    const file = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "btn", "#gone");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.tryCache("https://example.com", "btn", makePage({}, 0) as any);
    expect(result).toBeNull();
  });
});

// ── SelectorHealer — LLM healing ──────────────────────────────────────────────

describe("SelectorHealer — healing", () => {
  test("returns null and skips LLM when provider is mock", async () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage() as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("returns null when LLM responds with 'null'", async () => {
    const healer = new SelectorHealer(nullLLM, tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage() as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("returns and caches selector when LLM returns a valid CSS selector", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM('[data-test="login-button"]'), file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage() as any, "https://example.com");

    expect(result).toBe('[data-test="login-button"]');
    expect(healer.getCached("https://example.com", "login_button")).toBe('[data-test="login-button"]');
  });

  test("returns null when healed selector matches 0 elements", async () => {
    const healer = new SelectorHealer(stubLLM('[data-test="login-button"]'), tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage({}, 0) as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("returns null when healed selector matches multiple elements", async () => {
    const healer = new SelectorHealer(stubLLM('[data-test="login-button"]'), tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage({}, 3) as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("does not re-call LLM on second heal — cache is used instead (via getCached)", async () => {
    let calls = 0;
    const countingLLM: LLMProvider = {
      name: "stub",
      complete: async () => { calls++; return { content: "#btn", model: "stub" }; },
    };
    const file   = tmpCache();
    const healer = new SelectorHealer(countingLLM, file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.heal("submit", makePage() as any, "https://example.com");
    expect(calls).toBe(1);
    expect(healer.getCached("https://example.com", "submit")).toBe("#btn");
  });

  test("rejects LLM response that does not look like a CSS selector", async () => {
    const healer = new SelectorHealer(stubLLM("just some text"), tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("btn", makePage() as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("strips surrounding quotes from LLM response", async () => {
    const healer = new SelectorHealer(stubLLM('`[data-test="ok"]`'), tmpCache());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("btn", makePage() as any, "https://example.com");
    expect(result).toBe('[data-test="ok"]');
  });

  test("markFailure evicts stale cache entry via healer", () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    healer.cache.set("https://example.com", "btn", "#x");
    healer.markFailure("https://example.com", "btn", "#x");
    healer.markFailure("https://example.com", "btn", "#x");
    healer.markFailure("https://example.com", "btn", "#x"); // evicted
    expect(healer.getCached("https://example.com", "btn")).toBeUndefined();
  });

  test("markSuccess keeps entry alive and increments counter", () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    healer.cache.set("https://example.com", "btn", "#x");
    healer.markSuccess("https://example.com", "btn", "#x");
    expect(healer.getCached("https://example.com", "btn")).toBe("#x");
  });
});

// ── SelectorHealer — report ───────────────────────────────────────────────────

describe("SelectorHealer — report", () => {
  test("getReport returns no-activity message when nothing happened", () => {
    const healer = new SelectorHealer(mockLLM, tmpCache());
    expect(healer.getReport()).toContain("no activity");
  });

  test("getReport includes cache hit count after tryCache hit", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "btn", "#x");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.tryCache("https://example.com", "btn", makePage({}, 1) as any);
    const report = healer.getReport();
    expect(report).toContain("Cache hits:");
    expect(report).toMatch(/Cache hits:\s+1/);
  });

  test("getReport includes healed locator after successful heal", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM('[data-test="btn"]'), file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.heal("btn", makePage() as any, "https://example.com");
    const report = healer.getReport();
    expect(report).toContain("Healed:");
    expect(report).toContain("btn");
    expect(report).toContain('[data-test="btn"]');
  });

  test("resetEvents clears the event log", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM('#x'), file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.heal("btn", makePage() as any, "https://example.com");
    healer.resetEvents();
    expect(healer.getReport()).toContain("no activity");
  });

  // ── Refinement 4: event sampling ──────────────────────────────────────────

  test("event buffer caps at 500 — oldest events are dropped", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    // Seed 520 unique cache entries and hit tryCache for each → 520 cache_hit events
    for (let i = 0; i < 520; i++) {
      healer.cache.set(`https://example.com/p${i}`, "btn", "#x");
    }
    const page = makePage({}, 1) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < 520; i++) {
      await healer.tryCache(`https://example.com/p${i}`, "btn", page);
    }
    // Buffer capped at 500 → report shows 500, not 520
    expect(healer.getReport()).toMatch(/Cache hits:\s+500/);
  });

  // ── Refinement 5: cold vs warm run type ───────────────────────────────────

  test("getReport shows Warm when all hits came from cache", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(mockLLM, file);
    healer.cache.set("https://example.com", "btn", "#x");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.tryCache("https://example.com", "btn", makePage({}, 1) as any);
    expect(healer.getReport()).toContain("Warm");
  });

  test("getReport shows Cold when all heals came from LLM", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM("#x"), file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.heal("btn", makePage() as any, "https://example.com");
    expect(healer.getReport()).toContain("Cold");
  });

  // ── Semantic validation ───────────────────────────────────────────────────

  test("heal accepts selector when element text matches descriptor", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM("#login-btn"), file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage({}, 1, "Login") as any, "https://example.com");
    expect(result).toBe("#login-btn");
  });

  test("heal rejects selector when element text contradicts descriptor", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM("#logout-btn"), file);
    // "Logout" shares no meaningful words with "login_button" → rejected
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage({}, 1, "Logout") as any, "https://example.com");
    expect(result).toBeNull();
  });

  test("heal skips semantic validation when element has no text content", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM("#icon-btn"), file);
    // null textContent → icon-only element → validation skipped → accepted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await healer.heal("login_button", makePage({}, 1, null) as any, "https://example.com");
    expect(result).toBe("#icon-btn");
  });

  // ── HEALER_LOG_LEVEL ──────────────────────────────────────────────────────

  test("getReport returns empty string when HEALER_LOG_LEVEL is off", () => {
    const orig = process.env.HEALER_LOG_LEVEL;
    try {
      process.env.HEALER_LOG_LEVEL = "off";
      const healer = new SelectorHealer(mockLLM, tmpCache());
      expect(healer.getReport()).toBe("");
    } finally {
      if (orig === undefined) delete process.env.HEALER_LOG_LEVEL;
      else process.env.HEALER_LOG_LEVEL = orig;
    }
  });

  test("getReport shows Mixed when both cache hits and LLM heals occurred", async () => {
    const file   = tmpCache();
    const healer = new SelectorHealer(stubLLM("#y"), file);
    // cache hit on one descriptor
    healer.cache.set("https://a.com", "btn", "#x");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.tryCache("https://a.com", "btn", makePage({}, 1) as any);
    // LLM heal on a different descriptor (never in cache → cold)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await healer.heal("link", makePage() as any, "https://b.com");
    expect(healer.getReport()).toContain("Mixed");
  });
});
