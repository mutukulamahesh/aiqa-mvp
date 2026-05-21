import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

// Ollama runs locally — data never leaves the machine.
// Requires Ollama running at baseUrl (default: http://localhost:11434).
// No API key needed. Model must be pulled first: `ollama pull llama3.2`
export class OllamaLLMProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly model:   string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    this.model   = opts.model ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:      this.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: "system", content: req.system      },
          { role: "user",   content: req.userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`[ollama] HTTP ${res.status}: ${text} — is Ollama running at ${this.baseUrl}?`);
    }

    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      model:   string;
    };

    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error("[ollama] Empty response — is the model pulled? Run: ollama pull " + this.model);
    return { content, model: json.model ?? this.model, raw: json };
  }
}
