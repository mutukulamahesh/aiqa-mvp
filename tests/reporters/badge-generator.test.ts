import { generateBadgeSvg } from "../../src/reporters/BadgeGenerator";

// ── SVG structure ─────────────────────────────────────────────────────────────

describe("generateBadgeSvg — structure", () => {
  const result = generateBadgeSvg({ score: 85, grade: "A" });

  test("returns valid SVG opening tag", () => {
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  test("contains linearGradient, clipPath, and text elements", () => {
    expect(result.svg).toContain("<linearGradient");
    expect(result.svg).toContain("<clipPath");
    expect(result.svg).toContain("<text");
  });

  test("score and grade appear in SVG", () => {
    expect(result.svg).toContain("85/100 A");
  });

  test("totalW equals labelW + valueW", () => {
    expect(result.totalW).toBe(result.labelW + result.valueW);
  });

  test("SVG width attribute matches totalW", () => {
    expect(result.svg).toContain(`width="${result.totalW}"`);
  });
});

// ── colour thresholds ─────────────────────────────────────────────────────────

describe("generateBadgeSvg — colour thresholds", () => {
  test("score >= 80 → green (#4c1)", () => {
    expect(generateBadgeSvg({ score: 80, grade: "A" }).svg).toContain("#4c1");
  });

  test("score 60–79 → yellow (#dfb317)", () => {
    expect(generateBadgeSvg({ score: 60, grade: "B" }).svg).toContain("#dfb317");
    expect(generateBadgeSvg({ score: 79, grade: "B" }).svg).toContain("#dfb317");
  });

  test("score < 60 → red (#e05d44)", () => {
    expect(generateBadgeSvg({ score: 59, grade: "C" }).svg).toContain("#e05d44");
    expect(generateBadgeSvg({ score: 0,  grade: "F" }).svg).toContain("#e05d44");
  });
});

// ── label handling ────────────────────────────────────────────────────────────

describe("generateBadgeSvg — label", () => {
  test("uses default label when none provided", () => {
    expect(generateBadgeSvg({ score: 70, grade: "B" }).svg).toContain("AIQA Readiness");
  });

  test("uses custom label when provided", () => {
    const result = generateBadgeSvg({ score: 70, grade: "B", label: "My Project" });
    expect(result.svg).toContain("My Project");
  });

  test("custom label affects labelW", () => {
    const short = generateBadgeSvg({ score: 70, grade: "B", label: "Hi" });
    const long  = generateBadgeSvg({ score: 70, grade: "B", label: "Very Long Label Text" });
    expect(long.labelW).toBeGreaterThan(short.labelW);
  });
});

// ── XML escaping ──────────────────────────────────────────────────────────────

describe("generateBadgeSvg — XML escaping", () => {
  test("escapes & in label", () => {
    const result = generateBadgeSvg({ score: 70, grade: "B", label: "A & B" });
    expect(result.svg).toContain("A &amp; B");
    expect(result.svg).not.toContain("A & B");
  });

  test("escapes < in label", () => {
    const result = generateBadgeSvg({ score: 70, grade: "B", label: "A < B" });
    expect(result.svg).toContain("A &lt; B");
  });

  test("escapes > in label", () => {
    const result = generateBadgeSvg({ score: 70, grade: "B", label: "A > B" });
    expect(result.svg).toContain("A &gt; B");
  });

  test("escapes double-quote in label", () => {
    const result = generateBadgeSvg({ score: 70, grade: "B", label: 'Say "hi"' });
    expect(result.svg).toContain("Say &quot;hi&quot;");
  });
});

// ── non-ASCII rejection ───────────────────────────────────────────────────────

describe("generateBadgeSvg — non-ASCII validation", () => {
  test("throws on emoji in label", () => {
    expect(() => generateBadgeSvg({ score: 70, grade: "B", label: "Score 🚀" }))
      .toThrow("printable ASCII");
  });

  test("throws on CJK character in label", () => {
    expect(() => generateBadgeSvg({ score: 70, grade: "B", label: "テスト" }))
      .toThrow("printable ASCII");
  });

  test("accepts all printable ASCII", () => {
    expect(() => generateBadgeSvg({ score: 70, grade: "B", label: "Score: A+ (v1.0)" }))
      .not.toThrow();
  });
});
