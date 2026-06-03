import { parseTestDefinition } from "../../src/dsl/DslParser";

describe("DSL validator — actionable errors for common mistakes (POL-02)", () => {
  const wrap = (step: string) => `test:\n  name: t\n  steps:\n${step}`;

  // ── Old flat assertion syntax ────────────────────────────────────────────────

  test("assert_element_visible → guided to assert: { visible: }", () => {
    expect(() => parseTestDefinition(wrap('    - assert_element_visible: "#btn"')))
      .toThrow(/assert.*visible/);
  });

  test("assert_element_not_visible → guided to assert: { element_not_visible: }", () => {
    expect(() => parseTestDefinition(wrap('    - assert_element_not_visible: "#modal"')))
      .toThrow(/element_not_visible/);
  });

  test("assert_text_visible → guided to assert: { text: }", () => {
    expect(() => parseTestDefinition(wrap('    - assert_text_visible: "Welcome"')))
      .toThrow(/assert.*text/);
  });

  test("assert_url_contains → guided to assert: { url: }", () => {
    expect(() => parseTestDefinition(wrap('    - assert_url_contains: "/dashboard"')))
      .toThrow(/assert.*url/);
  });

  // ── Old ${} template syntax ──────────────────────────────────────────────────

  test("\\${var} in navigate URL → guided to {{ var }}", () => {
    expect(() => parseTestDefinition(wrap('    - navigate: "https://app.com/${baseUrl}"')))
      .toThrow(/double curly/i);
  });

  test("\\${var} in click target → guided to {{ var }}", () => {
    expect(() => parseTestDefinition(wrap('    - click: "${selector}"')))
      .toThrow(/double curly/i);
  });

  // ── store: shape mistakes ────────────────────────────────────────────────────

  test('store with "from" → guided to "selector"', () => {
    expect(() => parseTestDefinition(
      wrap('    - store:\n        from: ".title"\n        as: pageTitle')
    )).toThrow(/selector/);
  });

  // ── if: shape mistakes ───────────────────────────────────────────────────────

  test('if with "condition" → guided to variable/operator', () => {
    expect(() => parseTestDefinition(
      wrap('    - if:\n        condition: "x == y"\n        then:\n          - wait_ms: 50')
    )).toThrow(/condition.*not valid/i);
  });

  test('if with "then" → guided to "steps"', () => {
    expect(() => parseTestDefinition(
      wrap('    - if:\n        variable: x\n        equals: y\n        then:\n          - wait_ms: 50')
    )).toThrow(/then.*not valid|steps/i);
  });

  // ── for_each: shape mistakes ─────────────────────────────────────────────────

  test('for_each with "items" literal array → guided to "over" variable', () => {
    expect(() => parseTestDefinition(
      wrap('    - for_each:\n        items: [1,2,3]\n        as: x\n        steps: []')
    )).toThrow(/over/);
  });

  // ── Valid steps still parse correctly ────────────────────────────────────────

  test("assert: { visible: } parses without error", () => {
    const def = parseTestDefinition(
      wrap('    - assert:\n        visible: "#btn"')
    );
    expect(def.steps[0]).toMatchObject({ action: "assert", kind: "visible" });
  });

  test("{{ var }} template syntax parses without error", () => {
    const def = parseTestDefinition(
      wrap('    - navigate: "https://app.com/{{ path }}"')
    );
    expect(def.steps[0]).toMatchObject({ action: "navigate" });
  });

  test("store: { selector, as } parses without error", () => {
    const def = parseTestDefinition(
      wrap('    - store:\n        selector: ".title"\n        as: pageTitle')
    );
    expect(def.steps[0]).toMatchObject({ action: "store", selector: ".title", as: "pageTitle" });
  });
});
