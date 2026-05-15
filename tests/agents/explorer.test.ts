/**
 * Unit tests for AppExplorer pure helper methods.
 * Playwright-dependent methods (explore, exploreAuthenticated) are integration-tested
 * against a live browser and are not covered here.
 */

// AppExplorer is mocked in orchestrator.test.ts — use the real module here.
import { AppExplorer } from "../../src/agents/AppExplorer";
import { ExploredPage } from "../../src/agents/types";

// Access private methods via cast — avoids leaking test-only surface into the public API.
type ExplorerPrivate = {
  resolveUsernameSelector(page: ExploredPage): string;
  resolveSubmitSelector(page: ExploredPage): string;
  normalise(url: string): string;
};

function priv(e: AppExplorer): ExplorerPrivate {
  return e as unknown as ExplorerPrivate;
}

function makePage(overrides: Partial<ExploredPage> = {}): ExploredPage {
  return {
    url:           "https://example.com/login",
    title:         "Login",
    headings:      [],
    buttons:       [],
    inputs:        [],
    links:         [],
    internalLinks: [],
    ...overrides,
  };
}

// ── resolveUsernameSelector ───────────────────────────────────────────────────

describe("resolveUsernameSelector", () => {
  const explorer = new AppExplorer();

  test("prefers input[type=email] with name attribute", () => {
    const page = makePage({ inputs: [{ type: "email", name: "userEmail" }] });
    expect(priv(explorer).resolveUsernameSelector(page)).toBe('input[name="userEmail"]');
  });

  test("matches input whose name contains 'email'", () => {
    const page = makePage({ inputs: [{ type: "text", name: "emailAddress" }] });
    expect(priv(explorer).resolveUsernameSelector(page)).toBe('input[name="emailAddress"]');
  });

  test("matches input whose name contains 'user'", () => {
    const page = makePage({ inputs: [{ type: "text", name: "username" }] });
    expect(priv(explorer).resolveUsernameSelector(page)).toBe('input[name="username"]');
  });

  test("matches input whose placeholder contains 'user'", () => {
    const page = makePage({ inputs: [{ type: "text", placeholder: "Enter username" }] });
    // no name — falls back to generic selector
    expect(priv(explorer).resolveUsernameSelector(page)).toContain('input:not([type="password"])');
  });

  test("returns generic fallback when no recognisable field found", () => {
    const page = makePage({ inputs: [{ type: "text" }] });
    const sel = priv(explorer).resolveUsernameSelector(page);
    expect(sel).toContain('input:not([type="password"])');
    expect(sel).toContain('not([type="hidden"])');
  });

  test("email type takes precedence over username-named field", () => {
    const page = makePage({
      inputs: [
        { type: "text",  name: "username" },
        { type: "email", name: "emailAddr" },
      ],
    });
    expect(priv(explorer).resolveUsernameSelector(page)).toBe('input[name="emailAddr"]');
  });
});

// ── resolveSubmitSelector ─────────────────────────────────────────────────────

describe("resolveSubmitSelector", () => {
  const explorer = new AppExplorer();

  test("prefers input[type=submit] with name attribute", () => {
    const page = makePage({ inputs: [{ type: "submit", name: "loginBtn" }] });
    expect(priv(explorer).resolveSubmitSelector(page)).toBe('input[name="loginBtn"]');
  });

  test("returns generic fallback when no submit input found", () => {
    const page = makePage({ inputs: [{ type: "text", name: "user" }] });
    const sel  = priv(explorer).resolveSubmitSelector(page);
    expect(sel).toContain('button[type="submit"]');
    expect(sel).toContain('button');
  });

  test("returns generic fallback for empty inputs", () => {
    const page = makePage({ inputs: [] });
    const sel  = priv(explorer).resolveSubmitSelector(page);
    expect(sel).toContain('button');
  });
});

// ── normalise ─────────────────────────────────────────────────────────────────

describe("normalise", () => {
  const explorer = new AppExplorer();
  const norm = (u: string) => priv(explorer).normalise(u);

  test("strips trailing slash", () => {
    expect(norm("https://example.com/")).toBe("https://example.com");
    expect(norm("https://example.com/path/")).toBe("https://example.com/path");
  });

  test("strips hash fragment", () => {
    expect(norm("https://example.com/page#section")).toBe("https://example.com/page");
  });

  test("strips query string", () => {
    expect(norm("https://example.com/search?q=test")).toBe("https://example.com/search");
  });

  test("strips both hash and query string", () => {
    expect(norm("https://example.com/page?x=1#top")).toBe("https://example.com/page");
  });

  test("preserves scheme and host", () => {
    expect(norm("https://app.mycompany.com/dashboard")).toBe("https://app.mycompany.com/dashboard");
  });

  test("returns the original string for non-URL input", () => {
    expect(norm("/relative/path")).toBe("/relative/path");
  });

  test("two equivalent URLs normalise to the same string", () => {
    expect(norm("https://example.com/page/")).toBe(norm("https://example.com/page"));
  });
});
