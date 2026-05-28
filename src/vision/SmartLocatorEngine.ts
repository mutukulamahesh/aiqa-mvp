import type { DetectedElement, OcrWord } from "./types";
import type { IVisionAgent } from "./VisionAgent";
import type { IOcrEngine }   from "./OcrEngine";

export interface DomValidator {
  count(selector: string): Promise<number>;
  screenshot(): Promise<Buffer>;
}

export class SmartLocatorEngine {
  constructor(
    private readonly vision: IVisionAgent,
    private readonly ocr:    IOcrEngine,
  ) {}

  async locate(description: string, validator: DomValidator): Promise<string | null> {
    const buf      = await validator.screenshot();
    const elements = await this.vision.analyzeBuffer(buf);
    const words    = await this.ocr.analyzeBuffer(buf);

    if (!elements.length) return null;

    const best = this.bestMatch(description, elements);
    if (!best) return null;

    const candidates = this.generateCandidates(best, words);
    for (const sel of candidates) {
      try {
        const n = await validator.count(sel);
        if (n === 1) return sel;
      } catch {
        // invalid selector syntax — skip
      }
    }
    return null;
  }

  // Find element whose description or text best matches the query
  private bestMatch(query: string, elements: DetectedElement[]): DetectedElement | null {
    const q = query.toLowerCase();
    let best: DetectedElement | null = null;
    let bestScore = 0;

    for (const el of elements) {
      const desc  = el.description.toLowerCase();
      const text  = el.text.toLowerCase();
      let score   = 0;

      if (desc === q || text === q)                                  score = 3;
      else if (desc.includes(q) || q.includes(desc))                 score = 2;
      else if (text.includes(q) || q.includes(text))                 score = 2;
      else if (desc.split(" ").some(w => q.includes(w) && w.length > 3)) score = 1;

      score *= el.confidence;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore > 0 ? best : null;
  }

  // Generate CSS selector candidates from element observable facts (no DOM guessing)
  private generateCandidates(el: DetectedElement, words: OcrWord[]): string[] {
    const candidates: string[] = [];
    const text = el.text.trim();

    if (text) {
      // Text-based selectors — most reliable from visual information
      if (el.type === "button") {
        candidates.push(`button:has-text("${text}")`);
        candidates.push(`[type="submit"]:has-text("${text}")`);
        candidates.push(`[role="button"]:has-text("${text}")`);
      }
      if (el.type === "link") {
        candidates.push(`a:has-text("${text}")`);
      }
      if (el.type === "input") {
        candidates.push(`input[placeholder="${text}"]`);
        candidates.push(`input[aria-label="${text}"]`);
        candidates.push(`[placeholder="${text}"]`);
      }
      // Generic text-based fallback
      candidates.push(`text="${text}"`);
    }

    // OCR word proximity — find words near the element's bbox centre
    const cx = el.bbox.x + el.bbox.w / 2;
    const cy = el.bbox.y + el.bbox.h / 2;
    const nearbyWords = words
      .filter(w => {
        const wx = w.bbox.x + w.bbox.w / 2;
        const wy = w.bbox.y + w.bbox.h / 2;
        return Math.hypot(wx - cx, wy - cy) < 0.08 && w.confidence > 0.6;
      })
      .sort((a, b) => b.confidence - a.confidence);

    for (const w of nearbyWords.slice(0, 2)) {
      if (w.text && w.text !== text) {
        candidates.push(`text="${w.text}"`);
        if (el.type === "button") candidates.push(`button:has-text("${w.text}")`);
      }
    }

    return candidates;
  }
}
