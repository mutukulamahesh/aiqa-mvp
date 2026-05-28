import { StubOcrEngine } from "../../src/vision/OcrEngine";
import type { OcrWord }  from "../../src/vision/types";

const FIXTURE: OcrWord[] = [
  { text: "Login", bbox: { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, confidence: 0.95 },
  { text: "Email", bbox: { x: 0.3, y: 0.4, w: 0.15, h: 0.04 }, confidence: 0.88 },
];

describe("StubOcrEngine", () => {
  test("returns fixture words from analyzeBuffer", async () => {
    const engine = new StubOcrEngine(FIXTURE);
    const result = await engine.analyzeBuffer(Buffer.alloc(10));
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Login");
    expect(result[1].text).toBe("Email");
  });

  test("returns empty array when no fixtures provided", async () => {
    const engine = new StubOcrEngine();
    const result = await engine.analyzeBuffer(Buffer.alloc(10));
    expect(result).toEqual([]);
  });

  test("each word has text, bbox, confidence", async () => {
    const engine = new StubOcrEngine(FIXTURE);
    const [word]  = await engine.analyzeBuffer(Buffer.alloc(10));
    expect(word).toHaveProperty("text");
    expect(word).toHaveProperty("bbox");
    expect(word).toHaveProperty("confidence");
  });

  test("bbox values are normalized 0–1", async () => {
    const engine = new StubOcrEngine(FIXTURE);
    const [word]  = await engine.analyzeBuffer(Buffer.alloc(10));
    expect(word.bbox.x).toBeGreaterThanOrEqual(0);
    expect(word.bbox.x).toBeLessThanOrEqual(1);
    expect(word.bbox.y).toBeGreaterThanOrEqual(0);
    expect(word.bbox.y).toBeLessThanOrEqual(1);
    expect(word.bbox.w).toBeGreaterThan(0);
    expect(word.bbox.h).toBeGreaterThan(0);
  });

  test("confidence is in 0–1 range", async () => {
    const engine = new StubOcrEngine(FIXTURE);
    const [word]  = await engine.analyzeBuffer(Buffer.alloc(10));
    expect(word.confidence).toBeGreaterThanOrEqual(0);
    expect(word.confidence).toBeLessThanOrEqual(1);
  });
});
