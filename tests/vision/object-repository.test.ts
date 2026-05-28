import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { ObjectRepository, normalizeUrl } from "../../src/vision/ObjectRepository";
import type { DetectedElement } from "../../src/vision/types";

const EL: DetectedElement = {
  id: "e1", type: "button", description: "Login button", text: "Login",
  bbox: { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, confidence: 0.92,
};

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `aiqa-repo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── normalizeUrl ──────────────────────────────────────────────────────────────

describe("normalizeUrl", () => {
  test("lowercases hostname", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/path")).toBe("https://example.com/path");
  });

  test("strips :443 from https URLs", () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe("https://example.com/path");
  });

  test("strips :80 from http URLs", () => {
    expect(normalizeUrl("http://example.com:80/path")).toBe("http://example.com/path");
  });

  test("preserves non-default ports", () => {
    expect(normalizeUrl("https://example.com:8443/path")).toContain(":8443");
  });

  test("strips query string", () => {
    expect(normalizeUrl("https://example.com/path?foo=bar")).not.toContain("?");
  });

  test("strips fragment", () => {
    expect(normalizeUrl("https://example.com/path#section")).not.toContain("#");
  });

  test("preserves pathname case — /Login and /login are distinct", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Login")).toBe("https://example.com/Login");
  });

  test("strips trailing slash from pathname", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  test("preserves root slash", () => {
    const normalized = normalizeUrl("https://example.com/");
    expect(new URL(normalized).pathname).toBe("/");
  });

  test("idempotent — same result after double normalization", () => {
    const once  = normalizeUrl("https://EXAMPLE.COM:443/path/?q=1#frag");
    const twice = normalizeUrl(once);
    expect(once).toBe(twice);
  });
});

// ── ObjectRepository — get / set ──────────────────────────────────────────────

describe("ObjectRepository — get/set", () => {
  test("get returns null when no entry exists", () => {
    const repo = new ObjectRepository(tmpDir());
    expect(repo.get("https://example.com/", "Home")).toBeNull();
  });

  test("set then get returns stored entry", () => {
    const repo = new ObjectRepository(tmpDir());
    repo.set("https://example.com/login", "Login", [EL]);
    const entry = repo.get("https://example.com/login", "Login");
    expect(entry).not.toBeNull();
    expect(entry!.elements).toHaveLength(1);
    expect(entry!.elements[0].id).toBe("e1");
  });

  test("normalizes URL on set — trailing slash and case variant resolves to same entry", () => {
    const repo = new ObjectRepository(tmpDir());
    repo.set("https://EXAMPLE.COM:443/login/", "Login", [EL]);
    const entry = repo.get("https://example.com/login", "Login");
    expect(entry).not.toBeNull();
  });

  test("stored entry has key, elements, capturedAt", () => {
    const repo = new ObjectRepository(tmpDir());
    repo.set("https://example.com/", "Home", [EL]);
    const entry = repo.get("https://example.com/", "Home");
    expect(entry).toHaveProperty("key");
    expect(entry).toHaveProperty("elements");
    expect(entry).toHaveProperty("capturedAt");
  });

  test("capturedAt is a valid ISO date string", () => {
    const repo = new ObjectRepository(tmpDir());
    repo.set("https://example.com/", "Home", [EL]);
    const entry = repo.get("https://example.com/", "Home")!;
    expect(new Date(entry.capturedAt).toISOString()).toBe(entry.capturedAt);
  });

  test("same URL but different title gives different entry", () => {
    const repo = new ObjectRepository(tmpDir());
    const el2: DetectedElement = { ...EL, id: "e2", description: "Submit" };
    repo.set("https://example.com/", "Page A", [EL]);
    repo.set("https://example.com/", "Page B", [el2]);
    expect(repo.get("https://example.com/", "Page A")!.elements[0].id).toBe("e1");
    expect(repo.get("https://example.com/", "Page B")!.elements[0].id).toBe("e2");
  });
});

// ── ObjectRepository — merge ──────────────────────────────────────────────────

describe("ObjectRepository — merge", () => {
  test("merge into empty creates new entry", () => {
    const repo = new ObjectRepository(tmpDir());
    repo.merge("https://example.com/", "Home", [EL]);
    expect(repo.get("https://example.com/", "Home")!.elements).toHaveLength(1);
  });

  test("merge adds elements with new ids", () => {
    const repo = new ObjectRepository(tmpDir());
    const el2: DetectedElement = { ...EL, id: "e2", type: "input" };
    repo.set("https://example.com/", "Home", [EL]);
    repo.merge("https://example.com/", "Home", [el2]);
    expect(repo.get("https://example.com/", "Home")!.elements).toHaveLength(2);
  });

  test("merge replaces element with same id", () => {
    const repo = new ObjectRepository(tmpDir());
    const updated: DetectedElement = { ...EL, description: "Updated description" };
    repo.set("https://example.com/", "Home", [EL]);
    repo.merge("https://example.com/", "Home", [updated]);
    const entry = repo.get("https://example.com/", "Home")!;
    expect(entry.elements).toHaveLength(1);
    expect(entry.elements[0].description).toBe("Updated description");
  });
});
