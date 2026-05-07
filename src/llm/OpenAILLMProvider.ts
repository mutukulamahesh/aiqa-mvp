import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

export interface OpenAIConfig {
  apiKey:   string;
  baseURL?: string;
  model?:   string;
}

const OPENAI_BASE  = "https://api.openai.com/v1";
const OPENAI_MODEL = "gpt-4o-mini";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";

export class OpenAILLMProvider implements LLMProvider {
  readonly name: string;
  private readonly baseURL: string;
  private readonly model:   string;

  constructor(private readonly config: OpenAIConfig) {
    this.baseURL = config.baseURL ?? OPENAI_BASE;
    const isNvidia = this.baseURL.includes("nvidia");
    this.model = config.model ?? (isNvidia ? NVIDIA_MODEL : OPENAI_MODEL);
    this.name  = isNvidia ? "nvidia" : "openai";
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type":  "application/json",
      },
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
      throw new Error(`[${this.name}] HTTP ${res.status}: ${text}`);
    }

    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      model:   string;
    };

    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error(`[${this.name}] Empty response from API`);
    return { content, model: json.model ?? this.model, raw: json };
  }
}
