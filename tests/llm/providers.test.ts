import { LLMProvider, LLMRequest, LLMResponse, createLLMProvider } from "../../src/llm/LLMProvider";
import { OpenAILLMProvider }   from "../../src/llm/OpenAILLMProvider";
import { GeminiLLMProvider }   from "../../src/llm/GeminiLLMProvider";
import { FallbackLLMProvider } from "../../src/llm/FallbackLLMProvider";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubProvider(name: string, result: string | Error): LLMProvider {
  return {
    name,
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      if (result instanceof Error) throw result;
      return { content: result, model: name };
    },
  };
}

function mockFetchOk(body: unknown): jest.SpyInstance {
  return jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok:   true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

function mockFetchError(status: number, text: string): jest.SpyInstance {
  return jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok:         false,
    status,
    statusText: text,
    text:       async () => text,
  } as Response);
}

afterEach(() => jest.restoreAllMocks());

// ── FallbackLLMProvider ───────────────────────────────────────────────────────

describe("FallbackLLMProvider", () => {
  const req: LLMRequest = { system: "sys", userMessage: "msg" };
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));

  test("name is concatenation of chain provider names", () => {
    const fb = new FallbackLLMProvider([stubProvider("a", "ok"), stubProvider("b", "ok")]);
    expect(fb.name).toBe("a+b");
  });

  test("returns first provider response when it succeeds", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("first",  "result-from-first"),
      stubProvider("second", "result-from-second"),
    ]);
    const res = await fb.complete(req);
    expect(res.content).toBe("result-from-first");
  });

  test("falls through to second provider when first throws", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("rate limited")),
      stubProvider("fallback", "recovered"),
    ]);
    const res = await fb.complete(req);
    expect(res.content).toBe("recovered");
    expect(res.model).toBe("fallback");
  });

  test("throws aggregated error when all providers fail", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("a", new Error("err-a")),
      stubProvider("b", new Error("err-b")),
    ]);
    await expect(fb.complete(req)).rejects.toThrow("All LLM providers failed");
    await expect(fb.complete(req)).rejects.toThrow("err-a");
    await expect(fb.complete(req)).rejects.toThrow("err-b");
  });

  test("throws on construction with empty chain", () => {
    expect(() => new FallbackLLMProvider([])).toThrow();
  });

  test("falls through on HTTP 429 (retryable rate limit)", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("[primary] HTTP 429: Too Many Requests")),
      stubProvider("fallback", "rate-limit-recovered"),
    ]);
    const res = await fb.complete(req);
    expect(res.content).toBe("rate-limit-recovered");
  });

  test("falls through on HTTP 500 (retryable server error)", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("[primary] HTTP 500: Internal Server Error")),
      stubProvider("fallback", "server-error-recovered"),
    ]);
    const res = await fb.complete(req);
    expect(res.content).toBe("server-error-recovered");
  });

  test("does not fall through on HTTP 401 (non-retryable auth error)", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("[primary] HTTP 401: Unauthorized")),
      stubProvider("fallback", "should-not-reach"),
    ]);
    await expect(fb.complete(req)).rejects.toThrow("HTTP 401");
  });

  test("does not fall through on HTTP 400 (non-retryable bad request)", async () => {
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("[primary] HTTP 400: Bad Request")),
      stubProvider("fallback", "should-not-reach"),
    ]);
    await expect(fb.complete(req)).rejects.toThrow("HTTP 400");
  });

  test("logs console.warn when fallback provider is activated", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const fb = new FallbackLLMProvider([
      stubProvider("primary",  new Error("network error")),
      stubProvider("fallback", "recovered"),
    ]);
    await fb.complete(req);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fallback"));
    warn.mockRestore();
  });
});

// ── OpenAILLMProvider ─────────────────────────────────────────────────────────

describe("OpenAILLMProvider", () => {
  const req: LLMRequest = { system: "sys", userMessage: "msg", maxTokens: 60 };

  test("name is 'openai' for default base URL", () => {
    const p = new OpenAILLMProvider({ apiKey: "k" });
    expect(p.name).toBe("openai");
  });

  test("name is 'nvidia' when NVIDIA base URL is configured", () => {
    const p = new OpenAILLMProvider({ apiKey: "k", baseURL: "https://integrate.api.nvidia.com/v1" });
    expect(p.name).toBe("nvidia");
  });

  test("sends correct OpenAI chat completions request", async () => {
    const spy = mockFetchOk({ choices: [{ message: { content: "#btn" } }], model: "gpt-4o-mini" });
    const p   = new OpenAILLMProvider({ apiKey: "test-key" });

    await p.complete(req);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    expect(init.headers).toMatchObject({ "Authorization": "Bearer test-key" });

    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toMatchObject({ role: "system", content: "sys" });
    expect(body.messages[1]).toMatchObject({ role: "user",   content: "msg" });
    expect(body.max_tokens).toBe(60);
  });

  test("returns content from choices[0].message.content", async () => {
    mockFetchOk({ choices: [{ message: { content: "[data-test='x']" } }], model: "gpt-4o-mini" });
    const p   = new OpenAILLMProvider({ apiKey: "k" });
    const res = await p.complete(req);
    expect(res.content).toBe("[data-test='x']");
    expect(res.raw).toBeDefined();
  });

  test("throws on non-OK HTTP status", async () => {
    mockFetchError(429, "Too Many Requests");
    const p = new OpenAILLMProvider({ apiKey: "k" });
    await expect(p.complete(req)).rejects.toThrow("HTTP 429");
  });

  test("throws when choices array is empty", async () => {
    mockFetchOk({ choices: [], model: "gpt-4o-mini" });
    const p = new OpenAILLMProvider({ apiKey: "k" });
    await expect(p.complete(req)).rejects.toThrow("Empty response");
  });

  test("uses NVIDIA model and endpoint when configured", async () => {
    const spy = mockFetchOk({ choices: [{ message: { content: "#x" } }], model: "meta/llama-3.1-8b-instruct" });
    const p   = new OpenAILLMProvider({
      apiKey:  "nvapi-key",
      baseURL: "https://integrate.api.nvidia.com/v1",
    });

    await p.complete(req);

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("nvidia");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("meta/llama-3.1-8b-instruct");
  });
});

// ── GeminiLLMProvider ─────────────────────────────────────────────────────────

describe("GeminiLLMProvider", () => {
  const req: LLMRequest = { system: "sys", userMessage: "msg", maxTokens: 60 };

  test("name is 'gemini'", () => {
    expect(new GeminiLLMProvider("k").name).toBe("gemini");
  });

  test("sends correct Gemini generateContent request", async () => {
    const spy = mockFetchOk({
      candidates: [{ content: { parts: [{ text: "answer" }] } }],
    });
    const p = new GeminiLLMProvider("my-key");

    await p.complete(req);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generateContent");
    expect(url).toContain("key=my-key");

    const body = JSON.parse(init.body as string);
    expect(body.system_instruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("msg");
    expect(body.generationConfig.maxOutputTokens).toBe(60);
  });

  test("returns text from candidates[0].content.parts[0].text", async () => {
    mockFetchOk({ candidates: [{ content: { parts: [{ text: "selector-result" }] } }] });
    const res = await new GeminiLLMProvider("k").complete(req);
    expect(res.content).toBe("selector-result");
    expect(res.raw).toBeDefined();
  });

  test("throws on non-OK HTTP status", async () => {
    mockFetchError(403, "Forbidden");
    await expect(new GeminiLLMProvider("k").complete(req)).rejects.toThrow("HTTP 403");
  });

  test("throws when candidates array is empty", async () => {
    mockFetchOk({ candidates: [] });
    await expect(new GeminiLLMProvider("k").complete(req)).rejects.toThrow("Empty response");
  });

  test("uses custom model when provided", async () => {
    const spy = mockFetchOk({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
    await new GeminiLLMProvider("k", "gemini-1.5-pro").complete(req);
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-1.5-pro");
  });
});

// ── createLLMProvider — factory + env detection ───────────────────────────────

describe("createLLMProvider", () => {
  // Save and restore env vars around each test
  let savedEnv: NodeJS.ProcessEnv;
  beforeEach(() => { savedEnv = { ...process.env }; });
  afterEach(() => {
    for (const k of ["LLM_PROVIDER", "LLM_FALLBACK", "ANTHROPIC_API_KEY",
                     "OPENAI_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY"]) {
      delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
  });

  test("returns MockLLMProvider when no env vars are set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_PROVIDER;
    const p = createLLMProvider();
    expect(p.name).toBe("mock");
  });

  test("auto-detects anthropic when ANTHROPIC_API_KEY is set", () => {
    delete process.env.LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const p = createLLMProvider();
    expect(p.name).toBe("anthropic");
  });

  test("auto-detects openai when OPENAI_API_KEY is set", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    const p = createLLMProvider();
    expect(p.name).toBe("openai");
  });

  test("auto-detects nvidia when NVIDIA_API_KEY is set", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.NVIDIA_API_KEY = "nvapi-test";
    const p = createLLMProvider();
    expect(p.name).toBe("nvidia");
  });

  test("auto-detects gemini when GEMINI_API_KEY is set", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    process.env.GEMINI_API_KEY = "AIza-test";
    const p = createLLMProvider();
    expect(p.name).toBe("gemini");
  });

  test("LLM_PROVIDER env var overrides auto-detection", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test"; // would normally win auto-detect
    process.env.OPENAI_API_KEY    = "sk-test";
    process.env.LLM_PROVIDER      = "openai";
    const p = createLLMProvider();
    expect(p.name).toBe("openai");
  });

  test("LLM_FALLBACK builds a chain — name contains '+'", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.LLM_PROVIDER   = "openai";
    process.env.LLM_FALLBACK   = "mock";
    const p = createLLMProvider();
    expect(p.name).toContain("+");
    expect(p.name).toContain("mock");
  });

  test("explicit LLMConfig takes precedence over env vars", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.LLM_PROVIDER      = "anthropic"; // env says anthropic
    const p = createLLMProvider({ provider: "mock" }); // explicit says mock
    expect(p.name).toBe("mock");
  });

  test("explicit LLMConfig with fallback builds a chain", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const p = createLLMProvider({ provider: "openai", fallback: ["mock"] });
    expect(p.name).toBe("openai+mock");
  });
});
