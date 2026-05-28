import { SmartLocatorEngine, DomValidator } from "../../src/vision/SmartLocatorEngine";
import { StubVisionAgent }                  from "../../src/vision/VisionAgent";
import { StubOcrEngine }                    from "../../src/vision/OcrEngine";
import type { DetectedElement, OcrWord }    from "../../src/vision/types";

const BTN: DetectedElement = {
  id: "e1", type: "button", description: "Login button", text: "Login",
  bbox: { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, confidence: 0.92,
};
const INPUT: DetectedElement = {
  id: "e2", type: "input", description: "Email input field", text: "Email",
  bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.04 }, confidence: 0.88,
};
const LINK: DetectedElement = {
  id: "e3", type: "link", description: "Forgot password link", text: "Forgot password",
  bbox: { x: 0.5, y: 0.7, w: 0.2, h: 0.03 }, confidence: 0.85,
};

function makeValidator(countFn: (sel: string) => Promise<number> = async () => 0): DomValidator {
  return {
    screenshot: async () => Buffer.alloc(0),
    count:      countFn,
  };
}

// ── No elements ───────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — no elements", () => {
  test("returns null when vision finds no elements", async () => {
    const engine = new SmartLocatorEngine(new StubVisionAgent(), new StubOcrEngine());
    expect(await engine.locate("Login button", makeValidator())).toBeNull();
  });
});

// ── Button ────────────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — button", () => {
  test("returns selector when count returns 1", async () => {
    const engine = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine());
    const result = await engine.locate("Login button", makeValidator(async () => 1));
    expect(result).toBeTruthy();
  });

  test("returns null when all candidates return count 0", async () => {
    const engine = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine());
    expect(await engine.locate("Login button", makeValidator(async () => 0))).toBeNull();
  });

  test("first matching candidate contains the element text", async () => {
    const engine = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine());
    const tried: string[] = [];
    const validator: DomValidator = {
      screenshot: async () => Buffer.alloc(0),
      count: async (sel) => { tried.push(sel); return sel.includes("Login") ? 1 : 0; },
    };
    const result = await engine.locate("Login button", validator);
    expect(result).not.toBeNull();
    expect(result).toContain("Login");
  });
});

// ── Input ─────────────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — input element", () => {
  test("generates input-specific candidates (placeholder / aria-label)", async () => {
    const tried: string[] = [];
    const engine  = new SmartLocatorEngine(new StubVisionAgent([INPUT]), new StubOcrEngine());
    const validator: DomValidator = {
      screenshot: async () => Buffer.alloc(0),
      count: async (sel) => { tried.push(sel); return 1; },
    };
    await engine.locate("Email input field", validator);
    const inputSels = tried.filter(s => s.startsWith("input[") || s.includes("placeholder"));
    expect(inputSels.length).toBeGreaterThan(0);
  });
});

// ── Link ──────────────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — link element", () => {
  test("generates anchor-based candidate for link type", async () => {
    const tried: string[] = [];
    const engine  = new SmartLocatorEngine(new StubVisionAgent([LINK]), new StubOcrEngine());
    const validator: DomValidator = {
      screenshot: async () => Buffer.alloc(0),
      count: async (sel) => { tried.push(sel); return 1; },
    };
    await engine.locate("Forgot password link", validator);
    expect(tried.some(s => s.startsWith("a:"))).toBe(true);
  });
});

// ── OCR proximity ─────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — OCR proximity", () => {
  test("includes nearby OCR words as additional candidates", async () => {
    // Word centre near BTN centre (0.5, 0.625) — distance < 0.08 threshold
    const nearWord: OcrWord = {
      text: "Submit",
      bbox: { x: 0.46, y: 0.61, w: 0.06, h: 0.03 },
      confidence: 0.9,
    };
    const tried: string[] = [];
    const engine  = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine([nearWord]));
    const validator: DomValidator = {
      screenshot: async () => Buffer.alloc(0),
      count: async (sel) => { tried.push(sel); return 0; },
    };
    await engine.locate("Login button", validator);
    expect(tried.some(s => s.includes("Submit"))).toBe(true);
  });

  test("does not include distant OCR words", async () => {
    const farWord: OcrWord = {
      text: "Footer",
      bbox: { x: 0.0, y: 0.95, w: 0.1, h: 0.02 },
      confidence: 0.9,
    };
    const tried: string[] = [];
    const engine  = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine([farWord]));
    const validator: DomValidator = {
      screenshot: async () => Buffer.alloc(0),
      count: async (sel) => { tried.push(sel); return 0; },
    };
    await engine.locate("Login button", validator);
    expect(tried.some(s => s.includes("Footer"))).toBe(false);
  });
});

// ── No match ──────────────────────────────────────────────────────────────────

describe("SmartLocatorEngine — no match", () => {
  test("returns null when description does not match any element", async () => {
    const engine = new SmartLocatorEngine(new StubVisionAgent([BTN]), new StubOcrEngine());
    expect(await engine.locate("nonexistent widget xyz 9999", makeValidator(async () => 1))).toBeNull();
  });
});
