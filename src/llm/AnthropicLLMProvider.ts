import { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

/**
 * Anthropic Claude LLM provider.
 *
 * To enable:
 *   1. npm install @anthropic-ai/sdk
 *   2. export ANTHROPIC_API_KEY="sk-ant-..."
 *
 * The factory in LLMProvider.ts will pick this up automatically when the
 * env var is set — no changes to any agent code required.
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(private apiKey: string, private model = "claude-haiku-4-5-20251001") {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    // Dynamic import — no hard compile-time dependency on the SDK.
    // If the SDK is missing, a clear error is thrown rather than crashing at startup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Anthropic: any;
    try {
      const mod = await import("@anthropic-ai/sdk" as string);
      Anthropic = mod.default ?? mod;
    } catch {
      throw new Error(
        "[AnthropicLLMProvider] @anthropic-ai/sdk is not installed.\n" +
        "Run: npm install @anthropic-ai/sdk\n" +
        "Or unset ANTHROPIC_API_KEY to fall back to the mock provider."
      );
    }

    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model:      this.model,
      max_tokens: req.maxTokens ?? 1024,
      system:     req.system,
      messages:   [{ role: "user", content: req.userMessage }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new Error("[AnthropicLLMProvider] Unexpected non-text response from API");
    }

    return { content: block.text, model: response.model, raw: response };
  }
}
