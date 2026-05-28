import { VisionAgent, StubVisionAgent } from "../../src/vision/VisionAgent";
import type { DetectedElement } from "../../src/vision/types";

const FIXTURE: DetectedElement[] = [
  {
    id: "e1", type: "button", description: "Login button", text: "Login",
    bbox: { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, confidence: 0.92,
  },
  {
    id: "e2", type: "input", description: "Email input field", text: "",
    bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.04 }, confidence: 0.88,
  },
];

// ── StubVisionAgent ───────────────────────────────────────────────────────────

describe("StubVisionAgent", () => {
  test("returns fixture elements from analyzeBuffer", async () => {
    const agent   = new StubVisionAgent(FIXTURE);
    const result  = await agent.analyzeBuffer(Buffer.alloc(10));
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("button");
    expect(result[1].type).toBe("input");
  });

  test("returns empty array when no fixtures provided", async () => {
    const agent  = new StubVisionAgent();
    const result = await agent.analyzeBuffer(Buffer.alloc(10));
    expect(result).toEqual([]);
  });

  test("bbox values are normalized 0–1", async () => {
    const agent   = new StubVisionAgent(FIXTURE);
    const [btn]   = await agent.analyzeBuffer(Buffer.alloc(10));
    expect(btn.bbox.x).toBeGreaterThanOrEqual(0);
    expect(btn.bbox.x).toBeLessThanOrEqual(1);
    expect(btn.bbox.y).toBeGreaterThanOrEqual(0);
    expect(btn.bbox.y).toBeLessThanOrEqual(1);
    expect(btn.bbox.w).toBeGreaterThan(0);
    expect(btn.bbox.h).toBeGreaterThan(0);
  });

  test("each element has id, type, description, text, bbox, confidence", async () => {
    const agent   = new StubVisionAgent(FIXTURE);
    const [el]    = await agent.analyzeBuffer(Buffer.alloc(10));
    expect(el).toHaveProperty("id");
    expect(el).toHaveProperty("type");
    expect(el).toHaveProperty("description");
    expect(el).toHaveProperty("text");
    expect(el).toHaveProperty("bbox");
    expect(el).toHaveProperty("confidence");
  });
});

// ── VisionAgent (no API key) ──────────────────────────────────────────────────

describe("VisionAgent — no API key", () => {
  test("analyzeBuffer returns empty array when no API key is set", async () => {
    const agent  = new VisionAgent({ apiKey: undefined });
    const result = await agent.analyzeBuffer(Buffer.alloc(10));
    expect(result).toEqual([]);
  });
});
