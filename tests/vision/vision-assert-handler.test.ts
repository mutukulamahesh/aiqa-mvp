import { VisionAssertHandler } from "../../src/handlers/VisionAssertHandler";
import { StubVisionAgent }     from "../../src/vision/VisionAgent";
import { StubOcrEngine }       from "../../src/vision/OcrEngine";
import { ExecutionContext }     from "../../src/execution/ExecutionContext";
import { AdapterActions }      from "../../src/adapter/AdapterActions";
import type { DetectedElement } from "../../src/vision/types";

const BTN: DetectedElement = {
  id: "e1", type: "button", description: "Login button", text: "Login",
  bbox: { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, confidence: 0.92,
};
const INPUT: DetectedElement = {
  id: "e2", type: "input", description: "Email input field", text: "Email",
  bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.04 }, confidence: 0.88,
};

function makeAdapter(overrides: Partial<AdapterActions> = {}): AdapterActions {
  return {
    navigate:                async () => {},
    click:                   async () => {},
    fill:                    async () => {},
    assertTextVisible:       async () => {},
    assertUrlContains:       async () => {},
    assertElementVisible:    async () => {},
    assertElementNotVisible: async () => {},
    screenshot:              async () => {},
    currentUrl:              async () => "http://localhost/",
    waitForSelector:         async () => {},
    waitForUrl:              async () => {},
    getElementText:          async () => "",
    getElementAttribute:     async () => "",
    screenshotBuffer:        async () => Buffer.alloc(0),
    getViewportSize:         async () => ({ width: 1280, height: 720 }),
    countLocator:            async () => 0,
    ...overrides,
  };
}

// ── Element found ─────────────────────────────────────────────────────────────

describe("VisionAssertHandler — element found", () => {
  test("resolves when element matches description and confidence >= min", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent([BTN]), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "Login button", min_confidence: 0.5 },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).resolves.toBeUndefined();
  });

  test("stores description, type, selector, confidence in store_as", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent([BTN]), new StubOcrEngine());
    const ctx = new ExecutionContext();
    await handler.execute(
      { action: "vision_assert", description: "Login button", store_as: "found" },
      makeAdapter(),
      ctx,
    );
    const stored = ctx.get("found") as { description: string; type: string; confidence: number; selector: null };
    expect(stored.type).toBe("button");
    expect(stored.confidence).toBeCloseTo(0.92, 2);
    expect(stored).toHaveProperty("selector");
    expect(stored).toHaveProperty("description");
  });

  test("selector is null when countLocator always returns 0", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent([BTN]), new StubOcrEngine());
    const ctx = new ExecutionContext();
    await handler.execute(
      { action: "vision_assert", description: "Login button", store_as: "res" },
      makeAdapter({ countLocator: async () => 0 }),
      ctx,
    );
    const stored = ctx.get("res") as { selector: string | null };
    expect(stored.selector).toBeNull();
  });

  test("resolves for input element matched by description", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent([INPUT]), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "Email input field" },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).resolves.toBeUndefined();
  });
});

// ── No elements ───────────────────────────────────────────────────────────────

describe("VisionAssertHandler — no elements", () => {
  test("throws when vision finds no elements on page", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent(), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "Login button" },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).rejects.toThrow("no elements detected");
  });
});

// ── Confidence below threshold ────────────────────────────────────────────────

describe("VisionAssertHandler — confidence threshold", () => {
  test("throws when best confidence is below min_confidence", async () => {
    const lowConf: DetectedElement = { ...BTN, confidence: 0.3 };
    const handler = new VisionAssertHandler(new StubVisionAgent([lowConf]), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "Login button", min_confidence: 0.8 },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).rejects.toThrow(/confidence/i);
  });

  test("passes when confidence equals min_confidence exactly", async () => {
    const exactConf: DetectedElement = { ...BTN, confidence: 0.8 };
    const handler = new VisionAssertHandler(new StubVisionAgent([exactConf]), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "Login button", min_confidence: 0.8 },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).resolves.toBeUndefined();
  });
});

// ── No match ─────────────────────────────────────────────────────────────────

describe("VisionAssertHandler — no match", () => {
  test("throws when description does not match any element", async () => {
    const handler = new VisionAssertHandler(new StubVisionAgent([BTN]), new StubOcrEngine());
    await expect(
      handler.execute(
        { action: "vision_assert", description: "nonexistent widget xyz 9999" },
        makeAdapter(),
        new ExecutionContext(),
      ),
    ).rejects.toThrow();
  });
});
