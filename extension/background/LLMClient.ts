/**
 * LLMClient — fetch()-based Anthropic API client for the service worker.
 * No Node.js SDK — plain fetch() so it works in a browser extension context.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL   = "claude-opus-4-7";

interface Message {
  role:    "user" | "assistant";
  content: string;
}

interface CompletionOptions {
  system?:    string;
  maxTokens?: number;
}

export class LLMClient {
  constructor(private readonly apiKey: string) {}

  async complete(
    messages:  Message[],
    opts:      CompletionOptions = {}
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model:      MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      messages,
    };
    if (opts.system) body.system = opts.system;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key":          this.apiKey,
        "anthropic-version":  "2023-06-01",
        "content-type":       "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content.find((c) => c.type === "text")?.text ?? "";
  }
}
