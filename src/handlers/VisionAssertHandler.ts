import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction }  from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions }  from "../adapter/AdapterActions";
import { AssertionError }  from "../errors";
import { wwrite } from "../execution/WorkerContext";
import type { IVisionAgent }       from "../vision/VisionAgent";
import type { IOcrEngine }         from "../vision/OcrEngine";
import { SmartLocatorEngine }      from "../vision/SmartLocatorEngine";
import type { DetectedElement }    from "../vision/types";

export class VisionAssertHandler implements StepHandler {
  readonly handles = ["vision_assert"];

  private readonly engine: SmartLocatorEngine;

  constructor(
    private readonly vision: IVisionAgent,
    private readonly ocr:    IOcrEngine,
  ) {
    this.engine = new SmartLocatorEngine(vision, ocr);
  }

  async execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "vision_assert") return;

    const description   = ctx.resolve(step.description);
    const minConfidence = step.min_confidence ?? 0.5;

    // Capture screenshot as buffer
    const buf      = await adapter.screenshotBuffer();
    const elements = await this.vision.analyzeBuffer(buf);

    if (!elements.length) {
      throw new AssertionError(
        `vision_assert: no elements detected on page (description: "${description}")`,
      );
    }

    const best = this.bestMatch(description, elements);
    if (!best || best.confidence < minConfidence) {
      throw new AssertionError(
        `vision_assert: element not found matching "${description}" ` +
        `(best confidence: ${(best?.confidence ?? 0).toFixed(2)}, required: ${minConfidence})`,
      );
    }

    // Attempt selector resolution via SmartLocatorEngine
    const engine    = this.engine;
    const validator = {
      screenshot:   () => Promise.resolve(buf),
      count: (sel: string) => adapter.countLocator(sel),
    };
    const selector = await engine.locate(description, validator);

    const stored = {
      description: best.description,
      type:        best.type,
      selector:    selector ?? null,
      confidence:  best.confidence,
    };

    wwrite(`[vision] detected: "${best.description}" (${best.type}) confidence=${best.confidence.toFixed(2)}${selector ? ` selector="${selector}"` : " (no DOM selector resolved)"}`);

    if (step.store_as) ctx.set(step.store_as, stored);
  }

  private bestMatch(query: string, elements: DetectedElement[]): DetectedElement | null {
    const q = query.toLowerCase();
    let best: DetectedElement | null = null;
    let bestScore = 0;

    for (const el of elements) {
      const desc  = el.description.toLowerCase();
      const text  = el.text.toLowerCase();
      let score   = 0;

      if (desc === q || text === q)                                   score = 3;
      else if (desc.includes(q) || q.includes(desc))                  score = 2;
      else if (text.includes(q) || q.includes(text))                  score = 2;
      else if (desc.split(" ").some(w => q.includes(w) && w.length > 3)) score = 1;

      score *= el.confidence;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore > 0 ? best : null;
  }
}
