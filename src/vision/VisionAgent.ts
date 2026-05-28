import type { DetectedElement } from "./types";

const VISION_PROMPT = `Analyze this screenshot of a web application.
Identify all interactive and significant UI elements visible on screen.

Return ONLY valid JSON — no explanation, no markdown fences:
{
  "elements": [
    {
      "id": "e1",
      "type": "button|input|link|text|image|checkbox|select|other",
      "description": "human-readable description of the element",
      "text": "visible text on or inside the element",
      "bbox": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 },
      "confidence": 0.9
    }
  ]
}

Rules:
- bbox values are normalized 0–1 fractions of image dimensions (x=left, y=top, w=width, h=height)
- confidence is 0–1 (certainty about element type and position)
- Do NOT include any CSS selector, XPath, or DOM attribute — you cannot see the DOM
- Focus on elements a user would interact with or read`;

export interface IVisionAgent {
  analyzeBuffer(buf: Buffer): Promise<DetectedElement[]>;
}

export class VisionAgent implements IVisionAgent {
  private readonly apiKey: string | undefined;
  private readonly model:  string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model  = opts.model ?? "claude-sonnet-4-6";
  }

  async analyzeBuffer(buf: Buffer): Promise<DetectedElement[]> {
    if (!this.apiKey) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Anthropic: any;
    try {
      const mod = await import("@anthropic-ai/sdk" as string);
      Anthropic  = mod.default ?? mod;
    } catch {
      process.stderr.write("[VisionAgent] @anthropic-ai/sdk not installed — returning empty scan\n");
      return [];
    }

    try {
      const client   = new Anthropic({ apiKey: this.apiKey });
      const response = await client.messages.create({
        model:      this.model,
        max_tokens: 2048,
        messages:   [{
          role:    "user",
          content: [
            {
              type:   "image",
              source: { type: "base64", media_type: "image/png", data: buf.toString("base64") },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        }],
      });

      const block = response.content[0];
      if (!block || block.type !== "text") return [];

      const jsonMatch = (block.text as string).match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as { elements?: DetectedElement[] };
      return Array.isArray(parsed.elements) ? parsed.elements : [];
    } catch {
      return [];
    }
  }
}

export class StubVisionAgent implements IVisionAgent {
  constructor(private readonly fixtures: DetectedElement[] = []) {}

  async analyzeBuffer(_buf: Buffer): Promise<DetectedElement[]> {
    return this.fixtures;
  }
}
