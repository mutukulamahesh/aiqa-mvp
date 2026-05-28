import type { IDesktopAdapter } from "./DesktopAdapter";
import type { IVisionAgent }   from "../vision/VisionAgent";
import type { IOcrEngine }     from "../vision/OcrEngine";
import type { DetectedElement, OcrWord } from "../vision/types";

export interface LocatedElement {
  x:           number;
  y:           number;
  confidence:  number;
  source:      "vision" | "ocr";
  description: string;
}

export class AmbiguousElementError extends Error {
  constructor(description: string, candidates: Array<{ description: string; confidence: number }>) {
    super(
      `[DesktopVisionLocator] Ambiguous match for "${description}" — ` +
      `${candidates.length} candidates within 0.1 confidence: ` +
      candidates.map(c => `"${c.description}" (${c.confidence.toFixed(2)})`).join(", "),
    );
    this.name = "AmbiguousElementError";
  }
}

export class ElementNotFoundError extends Error {
  constructor(description: string, minConfidence: number) {
    super(
      `[DesktopVisionLocator] Element not found: "${description}" ` +
      `(no candidate scored above min_confidence ${minConfidence})`,
    );
    this.name = "ElementNotFoundError";
  }
}

export class DesktopVisionLocator {
  constructor(
    private readonly adapter:             IDesktopAdapter,
    private readonly vision:              IVisionAgent,
    private readonly ocr:                 IOcrEngine,
    private readonly defaultMinConfidence = 0.8,
  ) {}

  // Full-screen screenshot → Vision → OCR fallback.
  // Throws ElementNotFoundError or AmbiguousElementError — callers map to assertion/transient.
  async locate(description: string, minConfidence = this.defaultMinConfidence): Promise<LocatedElement> {
    const [buf, size] = await Promise.all([
      this.adapter.screenshot(),
      this.adapter.getScreenSize(),
    ]);

    const elements = await this.vision.analyzeBuffer(buf);
    const visionHit = this.pickBestVision(elements, description, size, minConfidence);
    if (visionHit) return visionHit;

    const words   = await this.ocr.analyzeBuffer(buf);
    const ocrHit  = this.pickBestOcr(words, description, size, minConfidence);
    if (ocrHit) return ocrHit;

    throw new ElementNotFoundError(description, minConfidence);
  }

  private pickBestVision(
    elements:      DetectedElement[],
    description:   string,
    size:          { width: number; height: number },
    minConfidence: number,
  ): LocatedElement | null {
    const scored = elements
      .map(el => ({
        el,
        score: this.descriptionScore(`${el.description} ${el.text}`, description) * el.confidence,
      }))
      .filter(s => s.score >= minConfidence)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    // Uniqueness gate: two candidates within 0.1 → ambiguous, never silently pick one
    if (scored.length >= 2 && scored[0].score - scored[1].score < 0.1) {
      throw new AmbiguousElementError(
        description,
        scored.slice(0, 3).map(s => ({ description: s.el.description, confidence: s.score })),
      );
    }

    const { el, score } = scored[0];
    return {
      x:           Math.round((el.bbox.x + el.bbox.w / 2) * size.width),
      y:           Math.round((el.bbox.y + el.bbox.h / 2) * size.height),
      confidence:  score,
      source:      "vision",
      description: el.description,
    };
  }

  private pickBestOcr(
    words:         OcrWord[],
    description:   string,
    size:          { width: number; height: number },
    minConfidence: number,
  ): LocatedElement | null {
    const desc = description.toLowerCase();
    const matches = words
      .filter(w => w.confidence >= minConfidence)
      .filter(w => {
        const t = w.text.toLowerCase();
        return t.includes(desc) || desc.includes(t);
      })
      .sort((a, b) => b.confidence - a.confidence);

    if (matches.length === 0) return null;

    if (matches.length >= 2 && matches[0].confidence - matches[1].confidence < 0.1) {
      throw new AmbiguousElementError(
        description,
        matches.slice(0, 3).map(w => ({ description: w.text, confidence: w.confidence })),
      );
    }

    const best = matches[0];
    return {
      x:           Math.round((best.bbox.x + best.bbox.w / 2) * size.width),
      y:           Math.round((best.bbox.y + best.bbox.h / 2) * size.height),
      confidence:  best.confidence,
      source:      "ocr",
      description: best.text,
    };
  }

  // Returns 0–1 similarity between a candidate string and a search query.
  // Multiplied by element.confidence in callers to produce a final score.
  private descriptionScore(candidate: string, query: string): number {
    const c = candidate.toLowerCase().trim();
    const q = query.toLowerCase().trim();
    if (c === q)                           return 1.0;
    if (c.includes(q) || q.includes(c))   return 0.9;
    const cWords  = new Set(c.split(/\s+/));
    const qWords  = q.split(/\s+/);
    const overlap = qWords.filter(w => cWords.has(w)).length;
    return (overlap / qWords.length) * 0.8;
  }
}
