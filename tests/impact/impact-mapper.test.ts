import { ImpactMapper } from "../../src/impact/ImpactMapper";
import { TestDefinition } from "../../src/dsl/types";

function def(overrides: Partial<TestDefinition> & { name: string }): TestDefinition {
  return { steps: [], ...overrides };
}

const mapper = new ImpactMapper();

// ── isImpacted ─────────────────────────────────────────────────────────────────

describe("ImpactMapper.isImpacted — explicit filesUnderTest", () => {
  test("exact path match triggers impact", () => {
    const d = def({ name: "Login", filesUnderTest: ["src/auth/login.ts"] });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("suffix match allows short paths in declaration", () => {
    const d = def({ name: "Login", filesUnderTest: ["auth/login.ts"] });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("no match when unrelated file changes", () => {
    const d = def({ name: "Login", filesUnderTest: ["src/auth/login.ts"] });
    expect(mapper.isImpacted(d, ["src/payments/checkout.ts"])).toBe(false);
  });

  test("case-insensitive path comparison", () => {
    const d = def({ name: "Login", filesUnderTest: ["src/Auth/Login.ts"] });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("windows-style backslash paths normalised", () => {
    const d = def({ name: "Login", filesUnderTest: ["src\\auth\\login.ts"] });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });
});

describe("ImpactMapper.isImpacted — tag heuristic (no filesUnderTest)", () => {
  test("tag matches directory segment in changed file", () => {
    const d = def({ name: "Auth flow", tags: ["auth"] });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("tag does not match if it is only a substring (not a full segment)", () => {
    const d = def({ name: "Payment", tags: ["pay"] });
    // "pay" is NOT a full segment of "src/payments/checkout.ts"
    expect(mapper.isImpacted(d, ["src/payments/checkout.ts"])).toBe(false);
  });

  test("multiple tags — any match triggers impact", () => {
    const d = def({ name: "Checkout", tags: ["cart", "payments"] });
    expect(mapper.isImpacted(d, ["src/payments/checkout.ts"])).toBe(true);
  });
});

describe("ImpactMapper.isImpacted — name heuristic (no filesUnderTest, no tags)", () => {
  test("word from test name matches path segment", () => {
    const d = def({ name: "Login smoke test" });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("word matches filename stem (strips extension)", () => {
    // "login" word matches "login.ts" because "login.ts".split(".") = ["login","ts"]
    const d = def({ name: "Login flow" });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("word does NOT match partial segment — auth vs author false-positive", () => {
    // With the old substring strategy, "auth" would match "src/author/bio.ts" because
    // "src/author/bio.ts".includes("auth") is true. With segment-word matching it does not.
    const d = def({ name: "Auth flow" }); // words: ["auth", "flow"]
    expect(mapper.isImpacted(d, ["src/author/bio.ts"])).toBe(false);
    // but "auth" DOES match the directory segment "auth"
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });

  test("short words (< 4 chars) are ignored to reduce noise", () => {
    // "api" is 3 chars (filtered), "test" is 4 chars (kept).
    // "test" matches the stem of "test.ts" (segment-word split: ["test", "ts"])
    const d = def({ name: "API test" });
    expect(mapper.isImpacted(d, ["src/test.ts"])).toBe(true);
    // "api" alone (3 chars) would be filtered even when the path has an "api" segment
    const apiOnly = def({ name: "API" }); // only word is "api" — too short, filtered
    expect(mapper.isImpacted(apiOnly, ["src/api/users.ts"])).toBe(false);
  });

  test("no match when name words are unrelated to changed paths", () => {
    const d = def({ name: "Dashboard overview" });
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(false);
  });
});

describe("ImpactMapper.isImpacted — edge cases", () => {
  test("returns false when changedFiles is empty", () => {
    const d = def({ name: "Login", filesUnderTest: ["src/auth/login.ts"] });
    expect(mapper.isImpacted(d, [])).toBe(false);
  });

  test("explicit filesUnderTest takes priority over tags", () => {
    // filesUnderTest says auth/login — tags say payments — only auth/login matters
    const d = def({ name: "Login", filesUnderTest: ["src/auth/login.ts"], tags: ["payments"] });
    expect(mapper.isImpacted(d, ["src/payments/checkout.ts"])).toBe(false);
    expect(mapper.isImpacted(d, ["src/auth/login.ts"])).toBe(true);
  });
});

// ── filterTests ─────────────────────────────────────────────────────────────

describe("ImpactMapper.filterTests", () => {
  const changed = ["src/auth/login.ts"];

  test("includes impacted tests", () => {
    const parse = (_f: string) => def({ name: "Login", filesUnderTest: ["src/auth/login.ts"] });
    const result = mapper.filterTests(["login.yaml"], changed, parse);
    expect(result).toEqual(["login.yaml"]);
  });

  test("excludes non-impacted tests", () => {
    const parse = (_f: string) => def({ name: "Checkout", filesUnderTest: ["src/payments/checkout.ts"] });
    const result = mapper.filterTests(["checkout.yaml"], changed, parse);
    expect(result).toEqual([]);
  });

  test("includes test file when the YAML itself is among changed files", () => {
    const parse = (_f: string) => def({ name: "Checkout" }); // no filesUnderTest, no tags, no name match
    // The YAML file itself changed — must be included
    const result = mapper.filterTests(["tests/checkout.yaml"], ["tests/checkout.yaml"], parse);
    expect(result).toEqual(["tests/checkout.yaml"]);
  });

  test("includes file conservatively on parse error", () => {
    const parse = (_f: string): TestDefinition => { throw new Error("parse error"); };
    const result = mapper.filterTests(["broken.yaml"], changed, parse);
    expect(result).toEqual(["broken.yaml"]);
  });

  test("gitRoot parameter resolves absolute paths for comparison", () => {
    const parse = (_f: string) => def({ name: "Unrelated" });
    // File is /repo/tests/login.yaml; gitRoot is /repo; changed is tests/login.yaml
    const result = mapper.filterTests(
      ["/repo/tests/login.yaml"],
      ["tests/login.yaml"],
      parse,
      "/repo",
    );
    expect(result).toEqual(["/repo/tests/login.yaml"]);
  });

  test("empty changedFiles → no tests impacted (returns empty)", () => {
    const parse = (_f: string) => def({ name: "Login", filesUnderTest: ["src/auth/login.ts"] });
    expect(mapper.filterTests(["login.yaml"], [], parse)).toEqual([]);
  });

  test("filesUnderTest + gitRoot: resolves absolute yaml path before comparing changed files", () => {
    // Test declares filesUnderTest pointing to auth/login.ts
    // Changed file is src/auth/login.ts (relative to git root /repo)
    // yaml is at /repo/tests/login.yaml — gitRoot helps match the yaml itself if needed,
    // but here the filesUnderTest declaration drives the match
    const parse = (_f: string) => def({
      name:            "Login",
      filesUnderTest:  ["src/auth/login.ts"],
    });
    const result = mapper.filterTests(
      ["/repo/tests/login.yaml"],
      ["src/auth/login.ts"],
      parse,
      "/repo",
    );
    expect(result).toEqual(["/repo/tests/login.yaml"]);
  });
});
