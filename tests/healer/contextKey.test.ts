import { contextHash, pageContextKey } from "../../src/healer/contextKey";

describe("contextHash", () => {
  test("returns a non-empty 8-char hex string", () => {
    const h = contextHash("Login|Welcome");
    expect(h).toMatch(/^[0-9a-f]{1,8}$/);
    expect(h.length).toBeGreaterThan(0);
  });

  test("is deterministic — same input produces same hash", () => {
    expect(contextHash("Login|Welcome")).toBe(contextHash("Login|Welcome"));
  });

  test("different inputs produce different hashes", () => {
    expect(contextHash("Login|Welcome")).not.toBe(contextHash("Dashboard|Hello"));
  });
});

describe("pageContextKey", () => {
  test("returns empty string when title and headings are both empty", () => {
    expect(pageContextKey("", [])).toBe("");
  });

  test("returns a hash when only title is present", () => {
    const k = pageContextKey("Login Page", []);
    expect(k).toMatch(/^[0-9a-f]+$/);
    expect(k).not.toBe("");
  });

  test("is deterministic for the same title + headings", () => {
    const k1 = pageContextKey("Login", ["Sign in", "Forgot password?"]);
    const k2 = pageContextKey("Login", ["Sign in", "Forgot password?"]);
    expect(k1).toBe(k2);
  });

  test("different page states produce different keys", () => {
    const login     = pageContextKey("Login",     ["Sign in"]);
    const dashboard = pageContextKey("Dashboard", ["Welcome back"]);
    expect(login).not.toBe(dashboard);
  });

  test("uses only the first two headings — extra headings ignored", () => {
    const k1 = pageContextKey("Login", ["h1", "h2"]);
    const k2 = pageContextKey("Login", ["h1", "h2", "h3-ignored"]);
    expect(k1).toBe(k2);
  });
});
