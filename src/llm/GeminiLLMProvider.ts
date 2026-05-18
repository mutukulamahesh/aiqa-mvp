import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiLLMProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.model = model ?? GEMINI_MODEL;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const url = `${GEMINI_BASE}/${this.model}:generateContent`;

    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents:           [{ role: "user", parts: [{ text: req.userMessage }] }],
        generationConfig:   { maxOutputTokens: req.maxTokens ?? 1024 },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`[gemini] HTTP ${res.status}: ${text}`);
    }

    const json = await res.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };

    const content = json.candidates[0]?.content?.parts[0]?.text;
    if (!content) throw new Error("[gemini] Empty response from API");
    return { content, model: this.model, raw: json };
  }
}
