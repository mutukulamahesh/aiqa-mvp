import { StubDesktopAdapter }                        from "../../src/desktop/DesktopAdapter";
import { DesktopVisionLocator,
         AmbiguousElementError,
         ElementNotFoundError }                     from "../../src/desktop/DesktopVisionLocator";
import { StubVisionAgent }                           from "../../src/vision/VisionAgent";
import { StubOcrEngine }                             from "../../src/vision/OcrEngine";
import type { DetectedElement }                      from "../../src/vision/types";

const SCREEN = { width: 1920, height: 1080 };

function makeEl(overrides: Partial<DetectedElement> = {}): DetectedElement {
  return {
    id:          "e1",
    type:        "button",
    description: "Login button",
    text:        "Login",
    bbox:        { x: 0.5, y: 0.5, w: 0.1, h: 0.05 },
    confidence:  0.9,
    ...overrides,
  };
}

function makeLocator(
  elements: DetectedElement[] = [],
  ocrWords: Array<{ text: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }> = [],
  minConf = 0.8,
) {
  const adapter = new StubDesktopAdapter({ screenSize: SCREEN });
  const vision  = new StubVisionAgent(elements);
  const ocr     = new StubOcrEngine(ocrWords.map(w => ({ ...w, confidence: w.confidence })));
  return { locator: new DesktopVisionLocator(adapter, vision, ocr, minConf), adapter };
}

describe("DesktopVisionLocator", () => {
  test("locates element by description via vision", async () => {
    const { locator } = makeLocator([makeEl()]);
    const result = await locator.locate("Login button");
    expect(result.source).toBe("vision");
    expect(result.x).toBe(Math.round((0.5 + 0.1 / 2) * SCREEN.width));
    expect(result.y).toBe(Math.round((0.5 + 0.05 / 2) * SCREEN.height));
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("falls through to OCR when vision finds nothing", async () => {
    const { locator } = makeLocator([], [{ text: "Submit", confidence: 0.9, bbox: { x: 0.3, y: 0.4, w: 0.1, h: 0.05 } }]);
    const result = await locator.locate("Submit");
    expect(result.source).toBe("ocr");
    expect(result.description).toBe("Submit");
  });

  test("throws ElementNotFoundError when nothing matches", async () => {
    const { locator } = makeLocator();
    await expect(locator.locate("Nonexistent button")).rejects.toBeInstanceOf(ElementNotFoundError);
  });

  test("throws AmbiguousElementError when two vision candidates within 0.1", async () => {
    const el1 = makeEl({ description: "Save button", confidence: 0.9 });
    const el2 = makeEl({ id: "e2", description: "Save draft", confidence: 0.9 });
    const { locator } = makeLocator([el1, el2]);
    await expect(locator.locate("Save")).rejects.toBeInstanceOf(AmbiguousElementError);
  });

  test("throws AmbiguousElementError when two OCR matches within 0.1", async () => {
    const { locator } = makeLocator([], [
      { text: "Save", confidence: 0.9, bbox: { x: 0.3, y: 0.4, w: 0.1, h: 0.05 } },
      { text: "Save", confidence: 0.9, bbox: { x: 0.6, y: 0.4, w: 0.1, h: 0.05 } },
    ]);
    await expect(locator.locate("Save")).rejects.toBeInstanceOf(AmbiguousElementError);
  });

  test("respects custom minConfidence — skips element below threshold", async () => {
    const { locator } = makeLocator([makeEl({ confidence: 0.6 })]);
    // default minConf is 0.8; 0.6 * 1.0 score = 0.6 which is < 0.8
    await expect(locator.locate("Login button")).rejects.toBeInstanceOf(ElementNotFoundError);
  });

  test("picks clear winner when top candidate leads by > 0.1", async () => {
    const el1 = makeEl({ description: "Login button", confidence: 0.95 });
    const el2 = makeEl({ id: "e2", description: "Register link", confidence: 0.5 });
    const { locator } = makeLocator([el1, el2]);
    const result = await locator.locate("Login button");
    expect(result.description).toBe("Login button");
  });

  test("converts bbox center to absolute pixel coordinates", async () => {
    const el = makeEl({ bbox: { x: 0.25, y: 0.25, w: 0.1, h: 0.1 }, confidence: 0.95 });
    const { locator } = makeLocator([el]);
    const result = await locator.locate("Login button");
    expect(result.x).toBe(Math.round(0.3 * SCREEN.width));   // 0.25 + 0.1/2
    expect(result.y).toBe(Math.round(0.3 * SCREEN.height));
  });

  test("takes screenshot and getScreenSize exactly once per locate call", async () => {
    const el = makeEl();
    const adapter = new StubDesktopAdapter({ screenSize: SCREEN });
    const locator  = new DesktopVisionLocator(adapter, new StubVisionAgent([el]), new StubOcrEngine(), 0.8);
    await locator.locate("Login button");
    const methods = adapter.calls.map(c => c.method);
    expect(methods.filter(m => m === "screenshot")).toHaveLength(1);
    expect(methods.filter(m => m === "getScreenSize")).toHaveLength(1);
  });

  test("OCR fallback: partial description matches word text", async () => {
    const { locator } = makeLocator([], [{ text: "Username", confidence: 0.85, bbox: { x: 0.2, y: 0.3, w: 0.15, h: 0.04 } }]);
    const result = await locator.locate("Username field");
    expect(result.source).toBe("ocr");
  });

  test("throws immediately with clear error when description is empty (L3)", async () => {
    const { locator } = makeLocator();
    await expect(locator.locate("")).rejects.toThrow(/description must not be empty/);
  });

  test("throws immediately with clear error when description is whitespace-only (L3)", async () => {
    const { locator } = makeLocator();
    await expect(locator.locate("   ")).rejects.toThrow(/description must not be empty/);
  });
});
