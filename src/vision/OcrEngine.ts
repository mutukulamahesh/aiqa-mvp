import * as path from "path";
import * as fs   from "fs";
import type { OcrWord, BoundingBox } from "./types";

const CACHE_DIR = path.resolve(process.cwd(), ".aiqa", "tesseract-cache");

export interface IOcrEngine {
  analyzeBuffer(buf: Buffer): Promise<OcrWord[]>;
}

export class OcrEngine implements IOcrEngine {
  async analyzeBuffer(buf: Buffer): Promise<OcrWord[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Tesseract: any;
    try {
      const mod  = await import("tesseract.js" as string);
      Tesseract  = mod.default ?? mod;
    } catch {
      process.stderr.write("[OcrEngine] tesseract.js not installed — returning empty OCR result\n");
      return [];
    }

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // first use downloads WASM + eng.traineddata (~25MB) into CACHE_DIR
    if (process.stderr.isTTY) {
      process.stderr.write("[ocr] language data cached at " + CACHE_DIR + "\n");
    }

    try {
      const worker = await Tesseract.createWorker("eng", 1, {
        cachePath: CACHE_DIR,
        logger: () => { /* suppress tesseract progress logs */ },
      });

      const { data } = await worker.recognize(buf);
      await worker.terminate();

      const words: OcrWord[] = [];
      for (const w of data.words ?? []) {
        if (!w.text.trim()) continue;
        const { x0, y0, x1, y1 } = w.bbox;
        const imgW = data.hocr ? 1 : (w.bbox as { imageWidth?: number }).imageWidth ?? 1280;
        const imgH = data.hocr ? 1 : (w.bbox as { imageHeight?: number }).imageHeight ?? 720;
        const bbox: BoundingBox = {
          x: x0 / imgW,
          y: y0 / imgH,
          w: (x1 - x0) / imgW,
          h: (y1 - y0) / imgH,
        };
        words.push({ text: w.text.trim(), bbox, confidence: (w.confidence ?? 0) / 100 });
      }
      return words;
    } catch {
      return [];
    }
  }
}

export class StubOcrEngine implements IOcrEngine {
  constructor(private readonly fixtures: OcrWord[] = []) {}

  async analyzeBuffer(_buf: Buffer): Promise<OcrWord[]> {
    return this.fixtures;
  }
}
