import * as os   from "os";
import * as path from "path";
import { FlowMapper }       from "../../src/agents/FlowMapper";
import { HealerCache }      from "../../src/healer/HealerCache";
import { ExplorationResult } from "../../src/agents/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpCache(): string {
  return path.join(os.tmpdir(), `fm-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

/** Validates a cache entry by recording 3 successes (threshold for status === "validated"). */
function validate(cache: HealerCache, pageUrl: string, descriptor: string, selector: string): void {
  cache.set(pageUrl, descriptor, selector, { confidence: 0.9, source: "llm" });
  cache.markSuccess(pageUrl, descriptor, selector);
  cache.markSuccess(pageUrl, descriptor, selector);
  cache.markSuccess(pageUrl, descriptor, selector);
}

function makeExploration(overrides: Partial<{
  url:      string;
  inputs:   { type: string; name?: string; placeholder?: string }[];
  buttons:  string[];
  headings: string[];
}> = {}): ExplorationResult {
  const url  = overrides.url ?? "https://example.com/login";
  const page = {
    url,
    title:         "Login",
    headings:      overrides.headings   ?? ["Sign in"],
    buttons:       overrides.buttons    ?? ["Sign In", "Submit"],
    inputs:        overrides.inputs     ?? [
      { type: "email",    name: "email" },
      { type: "password", name: "password" },
    ],
    links:         [],
    internalLinks: [],
  };
  return {
    baseUrl:     "https://example.com",
    exploredAt:  new Date().toISOString(),
    pages:       [page],
    totalPages:  1,
    totalLinks:  0,
  };
}

const mockLLM = { name: "mock", complete: async () => ({ content: "", model: "mock" }) };

// ── FlowMapper — cache seeding (perPageFlows) ────────────────────────────────

describe("FlowMapper — cache seeding (perPageFlows)", () => {
  test("uses original descriptor when cache is empty", () => {
    const fm    = new FlowMapper(undefined);
    const flows = fm.perPageFlows(makeExploration({
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    const fills = flows.flatMap(f => f.steps.filter(s => s.action === "fill"));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every(s => !/^[#.\[]/.test(s.target!))).toBe(true);
  });

  test("seeds validated CSS selector into fill target", () => {
    const url   = "https://example.com/login";
    const cache = new HealerCache(tmpCache());
    validate(cache, url, "email", "#email-field");

    const fm    = new FlowMapper(undefined, cache);
    const flows = fm.perPageFlows(makeExploration({
      url,
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    const fills = flows.flatMap(f => f.steps.filter(s => s.action === "fill"));
    expect(fills.some(s => s.target === "#email-field")).toBe(true);
  });

  test("does not seed provisional entries (2 successes, below threshold)", () => {
    const url   = "https://example.com/login";
    const cache = new HealerCache(tmpCache());
    cache.set(url, "email", "#email-field", { confidence: 0.9, source: "llm" });
    cache.markSuccess(url, "email", "#email-field");
    cache.markSuccess(url, "email", "#email-field"); // only 2 → still provisional

    const fm    = new FlowMapper(undefined, cache);
    const flows = fm.perPageFlows(makeExploration({
      url,
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    const fills = flows.flatMap(f => f.steps.filter(s => s.action === "fill"));
    expect(fills.every(s => s.target !== "#email-field")).toBe(true);
  });

  test("seeds only the matched descriptor — unmatched inputs keep their label", () => {
    const url   = "https://example.com/form";
    const cache = new HealerCache(tmpCache());
    validate(cache, url, "city", "#city-input");

    const fm    = new FlowMapper(undefined, cache);
    const flows = fm.perPageFlows(makeExploration({
      url,
      buttons: ["Submit"],
      inputs:  [
        { type: "text", name: "city" },
        { type: "text", name: "zip"  },
      ],
    }));
    const fills = flows.flatMap(f => f.steps.filter(s => s.action === "fill"));
    const cityFill = fills.find(s => s.target === "#city-input" || s.target === "city");
    const zipFill  = fills.find(s => s.target === "zip");

    expect(cityFill?.target).toBe("#city-input");
    expect(zipFill?.target).toBe("zip");
  });
});

// ── FlowMapper — cache seeding (map/buildAuthSteps) ──────────────────────────

describe("FlowMapper — cache seeding (map/buildAuthSteps)", () => {
  const LOGIN_URL = "https://example.com/login";

  test("seeds email fill target on auth flow", async () => {
    const cache = new HealerCache(tmpCache());
    validate(cache, LOGIN_URL, "email", "#email-input");

    const fm    = new FlowMapper(mockLLM, cache);
    const flows = await fm.map(makeExploration({ url: LOGIN_URL }));
    const authFlow = flows.find(f => f.type === "authentication");
    const emailStep = authFlow?.steps.find(s => s.action === "fill" && s.target !== "password");
    expect(emailStep?.target).toBe("#email-input");
  });

  test("seeds password fill target on auth flow", async () => {
    const cache = new HealerCache(tmpCache());
    validate(cache, LOGIN_URL, "password", "#pwd");

    const fm    = new FlowMapper(mockLLM, cache);
    const flows = await fm.map(makeExploration({ url: LOGIN_URL }));
    const authFlow  = flows.find(f => f.type === "authentication");
    const pwdStep = authFlow?.steps.find(s => s.action === "fill" && (s.value ?? "").includes("PASSWORD"));
    expect(pwdStep?.target).toBe("#pwd");
  });

  test("seeds click target on auth flow", async () => {
    const cache = new HealerCache(tmpCache());
    validate(cache, LOGIN_URL, "Sign In", "#login-btn");

    const fm    = new FlowMapper(mockLLM, cache);
    const flows = await fm.map(makeExploration({ url: LOGIN_URL, buttons: ["Sign In"] }));
    const authFlow  = flows.find(f => f.type === "authentication");
    const clickStep = authFlow?.steps.find(s => s.action === "click");
    expect(clickStep?.target).toBe("#login-btn");
  });

  test("falls back to text descriptor when click target not in cache", async () => {
    const cache = new HealerCache(tmpCache()); // empty

    const fm    = new FlowMapper(mockLLM, cache);
    const flows = await fm.map(makeExploration({ url: LOGIN_URL, buttons: ["Sign In"] }));
    const authFlow  = flows.find(f => f.type === "authentication");
    const clickStep = authFlow?.steps.find(s => s.action === "click");
    expect(clickStep?.target).toBe("Sign In");
  });
});

// ── FlowMapper — contextKey-aware seeding ────────────────────────────────────

describe("FlowMapper — contextKey-aware seeding", () => {
  const URL = "https://example.com/login";

  test("seeds selector when contextKey matches page title + headings", () => {
    const cache = new HealerCache(tmpCache());
    // Compute the contextKey the same way pageContextKey does: title + first 2 headings
    // The exploration fixture has title="Login" and headings=["Sign in"]
    validate(cache, URL, "email", "#email-ctx");

    const fm    = new FlowMapper(undefined, cache);
    // makeExploration defaults: title="Login", headings=["Sign in"]
    const flows = fm.perPageFlows(makeExploration({
      url:     URL,
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    const fill = flows.flatMap(f => f.steps.filter(s => s.action === "fill"))[0];
    expect(fill.target).toBe("#email-ctx");
  });

  test("skips selector stored under a different context (different title)", () => {
    const cache = new HealerCache(tmpCache());
    // Manually set a validated entry with a contextKey from a different page state
    const { pageContextKey } = require("../../src/healer/contextKey");
    const wrongCtxKey = pageContextKey("Dashboard", ["Overview"]);
    cache.set(URL, "email", "#wrong-ctx-selector", { confidence: 0.9, source: "llm", contextKey: wrongCtxKey });
    // Mark validated
    cache.markSuccess(URL, "email", "#wrong-ctx-selector");
    cache.markSuccess(URL, "email", "#wrong-ctx-selector");
    cache.markSuccess(URL, "email", "#wrong-ctx-selector");

    const fm = new FlowMapper(undefined, cache);
    // Page has title="Login" and headings=["Sign in"] → different contextKey
    const flows = fm.perPageFlows(makeExploration({
      url:     URL,
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    const fill = flows.flatMap(f => f.steps.filter(s => s.action === "fill"))[0];
    // Should NOT use the wrong-context selector
    expect(fill.target).not.toBe("#wrong-ctx-selector");
  });
});

// ── FlowMapper — getSeedCount ─────────────────────────────────────────────────

describe("FlowMapper — getSeedCount", () => {
  test("returns 0 when no cache is provided", () => {
    const fm = new FlowMapper(undefined);
    fm.perPageFlows(makeExploration({
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    expect(fm.getSeedCount()).toBe(0);
  });

  test("returns 0 when cache has no validated entries", () => {
    const cache = new HealerCache(tmpCache()); // empty
    const fm    = new FlowMapper(undefined, cache);
    fm.perPageFlows(makeExploration({
      buttons: ["Submit"],
      inputs:  [{ type: "email", name: "email" }],
    }));
    expect(fm.getSeedCount()).toBe(0);
  });

  test("increments for each target replaced by a validated CSS selector", () => {
    const url   = "https://example.com/form";
    const cache = new HealerCache(tmpCache());
    validate(cache, url, "email", "#email");
    validate(cache, url, "zip",   "#zip");

    const fm = new FlowMapper(undefined, cache);
    fm.perPageFlows(makeExploration({
      url,
      buttons: ["Submit"],
      inputs:  [
        { type: "email", name: "email" },
        { type: "text",  name: "zip"   },
      ],
    }));
    expect(fm.getSeedCount()).toBe(2);
  });
});
