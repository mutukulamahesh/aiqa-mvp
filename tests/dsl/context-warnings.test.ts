import { parseTestDefinition } from "../../src/dsl/DslParser";

describe("DSL context warnings (POL-05)", () => {
  let stderrLines: string[];
  let origWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrLines = [];
    origWrite   = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    process.stderr.write = origWrite;
  });

  const yaml = (steps: string) =>
    `test:\n  name: "t"\n  steps:\n${steps}`;

  // ── warns when page not yet loaded ────────────────────────────────────────────

  test("warns: assert visible with no prior navigate", () => {
    parseTestDefinition(yaml(`    - assert:\n        visible: "#btn"`));
    expect(stderrLines.some(l => l.includes('assert "visible"'))).toBe(true);
    expect(stderrLines.some(l => l.includes("navigate"))).toBe(true);
  });

  test("warns: assert text with no prior navigate", () => {
    parseTestDefinition(yaml(`    - assert:\n        text: "Welcome"`));
    expect(stderrLines.some(l => l.includes('assert "text"'))).toBe(true);
  });

  test("warns: assert element_not_visible with no prior navigate", () => {
    parseTestDefinition(yaml(`    - assert:\n        element_not_visible: "#modal"`));
    expect(stderrLines.some(l => l.includes('assert "element_not_visible"'))).toBe(true);
  });

  test("warns: store with no prior navigate", () => {
    parseTestDefinition(yaml(`    - store:\n        selector: ".title"\n        as: t`));
    expect(stderrLines.some(l => l.includes("store:"))).toBe(true);
  });

  // ── no warning when navigate precedes ─────────────────────────────────────────

  test("no warning: navigate then assert visible", () => {
    parseTestDefinition(yaml(
      `    - navigate: "https://example.com"\n    - assert:\n        visible: "#btn"`
    ));
    expect(stderrLines.filter(l => l.includes("⚠️"))).toHaveLength(0);
  });

  test("no warning: navigate then store", () => {
    parseTestDefinition(yaml(
      `    - navigate: "https://example.com"\n    - store:\n        selector: ".t"\n        as: x`
    ));
    expect(stderrLines.filter(l => l.includes("⚠️"))).toHaveLength(0);
  });

  // ── assert url/equals do NOT warn — they work without a page ─────────────────

  test("no warning: assert url without navigate (url check is valid pre-page)", () => {
    parseTestDefinition(yaml(`    - assert:\n        url: "/dashboard"`));
    expect(stderrLines.filter(l => l.includes("⚠️"))).toHaveLength(0);
  });

  // ── db/api steps do NOT warn ─────────────────────────────────────────────────

  test("no warning: db step without navigate", () => {
    parseTestDefinition(yaml(`    - db:\n        query: "SELECT 1"`));
    expect(stderrLines.filter(l => l.includes("⚠️"))).toHaveLength(0);
  });
});
