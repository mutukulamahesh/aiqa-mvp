/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { logger } from "../utils/logger";
import { getConfig } from "../config/ConfigLoader";
// Provider modules are lazy-loaded via require() so that missing optional dependencies
// (e.g. no @anthropic-ai/sdk installed) only throw at runtime when that provider is
// actually used — not at import time when another provider is configured.
// Import types at the top for TypeScript safety; values are loaded lazily below.
import type { AnthropicLLMProvider as _AnthropicType } from "./AnthropicLLMProvider";
import type { OpenAILLMProvider   as _OpenAIType }    from "./OpenAILLMProvider";
import type { GeminiLLMProvider   as _GeminiType }    from "./GeminiLLMProvider";
import type { MockLLMProvider     as _MockType }      from "./MockLLMProvider";
import type { FallbackLLMProvider as _FallbackType }  from "./FallbackLLMProvider";
import type { OllamaLLMProvider   as _OllamaType }    from "./OllamaLLMProvider";
import { getCircuitBreaker }                          from "../utils/circuitBreaker";

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

export type ProviderName = "anthropic" | "openai" | "nvidia" | "gemini" | "ollama" | "mock";

export interface LLMConfig {
  provider:  ProviderName;
  fallback?: ProviderName[];
  model?:    string;
  baseUrl?:  string;
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

  let privacyMode = false;
  try { privacyMode = getConfig().privacy_mode; } catch { /* config not loaded in tests */ }
  if (privacyMode && resolved.provider !== "ollama" && resolved.provider !== "mock") {
    throw new Error(
      `[privacy_mode] Provider "${resolved.provider}" makes outbound calls. ` +
      `Only "ollama" and "mock" are permitted when privacy_mode is true. ` +
      `Set llm.provider: ollama in your config or disable privacy_mode.`
    );
  }

  let primary: LLMProvider;
  try {
    primary = buildSingle(resolved.provider, resolved.model, resolved.baseUrl);
  } catch (err) {
    if (resolved.fallback?.length) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[LLM] Primary provider "${resolved.provider}" unavailable (${msg}); using fallback.\n`);
      const fallbacks = resolved.fallback.map(name => buildSingle(name));
      if (fallbacks.length === 1) return withCircuitBreaker(fallbacks[0]);
      const { FallbackLLMProvider } = require("./FallbackLLMProvider") as { FallbackLLMProvider: typeof _FallbackType };
      return withCircuitBreaker(new FallbackLLMProvider(fallbacks));
    }
    throw err;
  }

  if (!resolved.fallback?.length) return withCircuitBreaker(primary);

  const { FallbackLLMProvider } = require("./FallbackLLMProvider") as { FallbackLLMProvider: typeof _FallbackType };
  return withCircuitBreaker(new FallbackLLMProvider([
    primary,
    ...resolved.fallback.map(name => buildSingle(name)),
  ]));
}

/**
 * Wraps a provider with a circuit breaker so repeated LLM failures trip the
 * circuit and return fast errors instead of hanging requests.
 * Mock providers are excluded — they never make real network calls.
 */
function withCircuitBreaker(provider: LLMProvider): LLMProvider {
  if (provider.name === "mock") return provider;
  const cb = getCircuitBreaker(provider.name);
  return {
    name: provider.name,
    complete: (req) => cb.call(() => provider.complete(req)),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER as ProviderName | undefined) ?? autoDetect();
  const rawFallback = process.env.LLM_FALLBACK;
  const fallback: ProviderName[] = rawFallback
    ? rawFallback.split(",").map(s => s.trim() as ProviderName).filter(Boolean)
    : [];
  if (rawFallback && fallback.length === 0) {
    logger.warn(`[LLMProvider] LLM_FALLBACK="${rawFallback}" produced no valid providers — fallback disabled`);
  }
  return { provider, fallback };
}

function autoDetect(): ProviderName {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY)    return "openai";
  if (process.env.NVIDIA_API_KEY)    return "nvidia";
  if (process.env.GEMINI_API_KEY)    return "gemini";
  return "mock";
}

function buildSingle(name: ProviderName, model?: string, baseUrl?: string): LLMProvider {
  switch (name) {
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      const { AnthropicLLMProvider } = require("./AnthropicLLMProvider") as { AnthropicLLMProvider: typeof _AnthropicType };
      return new AnthropicLLMProvider(key, model);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      const { OpenAILLMProvider } = require("./OpenAILLMProvider") as { OpenAILLMProvider: typeof _OpenAIType };
      return new OpenAILLMProvider({ apiKey: key, model });
    }
    case "nvidia": {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new Error("NVIDIA_API_KEY is not set");
      const { OpenAILLMProvider } = require("./OpenAILLMProvider") as { OpenAILLMProvider: typeof _OpenAIType };
      return new OpenAILLMProvider({
        apiKey:  key,
        baseURL: "https://integrate.api.nvidia.com/v1",
        model:   model ?? "meta/llama-3.1-8b-instruct",
      });
    }
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not set");
      const { GeminiLLMProvider } = require("./GeminiLLMProvider") as { GeminiLLMProvider: typeof _GeminiType };
      return new GeminiLLMProvider(key, model);
    }
    case "ollama": {
      const { OllamaLLMProvider } = require("./OllamaLLMProvider") as { OllamaLLMProvider: typeof _OllamaType };
      return new OllamaLLMProvider({ model, baseUrl });
    }
    default: {
      const { MockLLMProvider } = require("./MockLLMProvider") as { MockLLMProvider: typeof _MockType };
      return new MockLLMProvider();
    }
  }
}
