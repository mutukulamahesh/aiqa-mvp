/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
// Provider modules are lazy-loaded via require() so that missing optional dependencies
// (e.g. no @anthropic-ai/sdk installed) only throw at runtime when that provider is
// actually used — not at import time when another provider is configured.
/**
 * Canonical LLM prompt format. Every provider translates this internally —
 * callers never deal with provider-specific wire formats.
 */
export interface LLMRequest {
  system:      string;
  userMessage: string;
  maxTokens?:  number;
}

export interface LLMResponse {
  content: string;
  model:   string;
  /** Full provider response, preserved for debugging. Shape is provider-specific. */
  raw?:    unknown;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export type ProviderName = "anthropic" | "openai" | "nvidia" | "gemini" | "mock";

export interface LLMConfig {
  provider:  ProviderName;
  fallback?: ProviderName[];
  model?:    string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates the active LLM provider (or a fallback chain).
 *
 * Resolution order:
 *   1. Explicit LLMConfig argument  (passed from YAML config at CLI startup)
 *   2. LLM_PROVIDER env var  +  optional LLM_FALLBACK (comma-separated names)
 *   3. Auto-detect from whichever API key env var is present
 *   4. MockLLMProvider  (no keys, no explicit config)
 */
export function createLLMProvider(config?: LLMConfig): LLMProvider {
  const resolved = config ?? resolveFromEnv();

  let primary: LLMProvider;
  try {
    primary = buildSingle(resolved.provider, resolved.model);
  } catch (err) {
    // Primary key missing — if fallbacks are configured, degrade gracefully rather than crash.
    // This lets staging configs (provider: anthropic, fallback: [mock]) work in CI without a key.
    if (resolved.fallback?.length) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[LLM] Primary provider "${resolved.provider}" unavailable (${msg}); using fallback.\n`);
      const fallbacks = resolved.fallback.map(name => buildSingle(name));
      if (fallbacks.length === 1) return fallbacks[0];
      const { FallbackLLMProvider } = require("./FallbackLLMProvider");
      return new FallbackLLMProvider(fallbacks);
    }
    throw err;
  }

  if (!resolved.fallback?.length) return primary;

  const { FallbackLLMProvider } = require("./FallbackLLMProvider");
  return new FallbackLLMProvider([
    primary,
    ...resolved.fallback.map(name => buildSingle(name)),
  ]);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER as ProviderName | undefined) ?? autoDetect();
  const fallback = process.env.LLM_FALLBACK
    ? process.env.LLM_FALLBACK.split(",").map(s => s.trim() as ProviderName).filter(Boolean)
    : [];
  return { provider, fallback };
}

function autoDetect(): ProviderName {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY)    return "openai";
  if (process.env.NVIDIA_API_KEY)    return "nvidia";
  if (process.env.GEMINI_API_KEY)    return "gemini";
  return "mock";
}

function buildSingle(name: ProviderName, model?: string): LLMProvider {
  switch (name) {
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      const { AnthropicLLMProvider } = require("./AnthropicLLMProvider");
      return new AnthropicLLMProvider(key, model);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      const { OpenAILLMProvider } = require("./OpenAILLMProvider");
      return new OpenAILLMProvider({ apiKey: key, model });
    }
    case "nvidia": {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new Error("NVIDIA_API_KEY is not set");
      const { OpenAILLMProvider } = require("./OpenAILLMProvider");
      return new OpenAILLMProvider({
        apiKey:  key,
        baseURL: "https://integrate.api.nvidia.com/v1",
        model:   model ?? "meta/llama-3.1-8b-instruct",
      });
    }
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not set");
      const { GeminiLLMProvider } = require("./GeminiLLMProvider");
      return new GeminiLLMProvider(key, model);
    }
    default: {
      const { MockLLMProvider } = require("./MockLLMProvider");
      return new MockLLMProvider();
    }
  }
}
