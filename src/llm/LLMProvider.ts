export interface LLMRequest {
  system: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/**
 * Returns the appropriate LLM provider based on environment.
 * - ANTHROPIC_API_KEY set → AnthropicLLMProvider (requires npm install @anthropic-ai/sdk)
 * - Not set            → MockLLMProvider (rule-based, no API key needed)
 */
export function createLLMProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AnthropicLLMProvider } = require("./AnthropicLLMProvider");
    return new AnthropicLLMProvider(process.env.ANTHROPIC_API_KEY);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MockLLMProvider } = require("./MockLLMProvider");
  return new MockLLMProvider();
}
