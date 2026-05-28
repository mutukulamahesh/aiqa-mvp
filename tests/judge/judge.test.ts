import { JudgeHandler }      from "../../src/handlers/JudgeHandler";
import { ExecutionContext }   from "../../src/execution/ExecutionContext";
import { AdapterActions }     from "../../src/adapter/AdapterActions";
import { LLMProvider, LLMRequest, LLMResponse } from "../../src/llm/LLMProvider";
import { parseTestDefinition } from "../../src/dsl/DslParser";
import { KnowledgeRetriever } from "../../src/knowledge/KnowledgeRetriever";
import { RetrievedChunk }     from "../../src/knowledge/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): AdapterActions {
  return {
    navigate:             async () => {},
    click:                async () => {},
    fill:                 async () => {},
    assertTextVisible:    async () => {},
    assertUrlContains:    async () => {},
    assertElementVisible:    async () => {},
    assertElementNotVisible: async () => {},
    screenshot:              async () => {},
    currentUrl:           async () => "http://localhost/",
    waitForSelector:      async () => {},
    waitForUrl:           async () => {},
    getElementText:       async () => "",
    getElementAttribute:  async () => "",
    screenshotBuffer:     async () => Buffer.alloc(0),
    getViewportSize:      async () => ({ width: 1280, height: 720 }),
    countLocator:         async () => 0,
  };
}

function makeCtx(vars: Record<string, unknown> = {}): ExecutionContext {
  const ctx = new ExecutionContext();
  for (const [k, v] of Object.entries(vars)) ctx.set(k, v);
  return ctx;
}

/** Builds a stub LLM that always returns the given raw content string. */
function makeLLM(content: string): LLMProvider {
  return {
    name: "stub",
    async complete(_req: LLMRequest): Promise<LLMResponse> {
      return { content, model: "stub" };
    },
  };
}

/** Builds a stub LLM that returns a valid judge JSON response. */
function makeJudgeLLM(score: number, reason = "ok"): LLMProvider {
  return makeLLM(JSON.stringify({ score, reason }));
}

// ── pass_if operators ─────────────────────────────────────────────────────────

describe("JudgeHandler — pass_if operators", () => {
  const adapter = makeAdapter();

  test("passes when score >= threshold (equal)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.8));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("passes when score >= threshold (above)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("fails when score < threshold for >=", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.5));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).rejects.toThrow("Judge failed");
  });

  test("passes when score > threshold (strict)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.81));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score > 0.8" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("fails when score equals threshold for >", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.8));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score > 0.8" }, adapter, makeCtx())
    ).rejects.toThrow("Judge failed");
  });

  test("passes when score <= threshold (equal)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.3));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score <= 0.3" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("passes when score < threshold (strict)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.2));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score < 0.3" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("fails when score equals threshold for <", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.3));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score < 0.3" }, adapter, makeCtx())
    ).rejects.toThrow("Judge failed");
  });

  test("error message includes score, operator, threshold, and reason", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.4, "too vague"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).rejects.toMatchObject({ message: expect.stringContaining("Judge failed (score: 0.4 >= 0.8)") });
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).rejects.toMatchObject({ message: expect.stringContaining("Reason: too vague") });
  });
});

// ── store_as ──────────────────────────────────────────────────────────────────

describe("JudgeHandler — store_as", () => {
  test("stores { score, verdict, reason } on pass", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9, "looks good"));
    const ctx = makeCtx();
    await handler.execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8", store_as: "result" },
      makeAdapter(), ctx
    );
    expect(ctx.get("result")).toEqual({ score: 0.9, verdict: "pass", reason: "looks good" });
  });

  test("verdict is 'pass' when pass_if passes", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(1.0));
    const ctx = makeCtx();
    await handler.execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5", store_as: "r" },
      makeAdapter(), ctx
    );
    expect((ctx.get("r") as { verdict: string }).verdict).toBe("pass");
  });

  test("verdict is 'fail' and result stored before throwing on failure", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.2, "poor"));
    const ctx = makeCtx();
    await expect(
      handler.execute(
        { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8", store_as: "r" },
        makeAdapter(), ctx
      )
    ).rejects.toThrow("Judge failed");
    // Result must be stored even though it threw
    expect(ctx.get("r")).toEqual({ score: 0.2, verdict: "fail", reason: "poor" });
  });

  test("no store_as — context is not mutated", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    const ctx = makeCtx();
    await handler.execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), ctx
    );
    expect(ctx.get("result")).toBeUndefined();
  });
});

// ── invalid LLM output ────────────────────────────────────────────────────────

describe("JudgeHandler — invalid LLM response", () => {
  test("throws 'judge failed: invalid LLM response format' on non-JSON", async () => {
    const handler = new JudgeHandler(makeLLM("not json at all"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws on missing 'score' field", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws on missing 'reason' field", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: 0.8 })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws when score is out of range (> 1)", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: 1.5, reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws when score is out of range (< 0)", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: -0.1, reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws when score is a string instead of number", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: "0.8", reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws when reason is empty string", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: 0.8, reason: "" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("throws on markdown-wrapped JSON (no free-form parsing)", async () => {
    const handler = new JudgeHandler(makeLLM('```json\n{"score":0.9,"reason":"good"}\n```'));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });
});

// ── invalid pass_if expression ────────────────────────────────────────────────

describe("JudgeHandler — invalid pass_if", () => {
  test("throws AssertionError on unknown operator", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score == 0.8" }, makeAdapter(), makeCtx())
    ).rejects.toThrow('judge: invalid pass_if expression "score == 0.8"');
  });

  test("throws on completely invalid pass_if string", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "pass" }, makeAdapter(), makeCtx())
    ).rejects.toThrow('judge: invalid pass_if expression "pass"');
  });

  test("throws on empty pass_if string", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge: invalid pass_if expression");
  });
});

// ── template resolution ───────────────────────────────────────────────────────

describe("JudgeHandler — template resolution", () => {
  test("resolves {{ }} in value before sending to LLM", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    const ctx = makeCtx({ greeting: "Hello World" });
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "{{ greeting }}", prompt: "Is it a greeting?", pass_if: "score >= 0.5" },
      makeAdapter(), ctx
    );
    expect(capturedUser).toContain("Hello World");
  });

  test("resolves {{ }} in prompt before sending to LLM", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    const ctx = makeCtx({ criteria: "must be positive" });
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "great", prompt: "Criteria: {{ criteria }}", pass_if: "score >= 0.5" },
      makeAdapter(), ctx
    );
    expect(capturedUser).toContain("must be positive");
  });
});

// ── DslParser — judge step ────────────────────────────────────────────────────

describe("DslParser — judge step", () => {
  function parse(yaml: string) { return parseTestDefinition(yaml).steps[0]; }

  test("parses minimal judge step", () => {
    expect(parse(`
test:
  name: t
  steps:
    - judge:
        value: "{{ response }}"
        prompt: "Is this a valid answer?"
        pass_if: "score >= 0.7"
`)).toEqual({
      action:  "judge",
      value:   "{{ response }}",
      prompt:  "Is this a valid answer?",
      pass_if: "score >= 0.7",
    });
  });

  test("parses judge with store_as", () => {
    expect(parse(`
test:
  name: t
  steps:
    - judge:
        value: "some text"
        prompt: "check it"
        pass_if: "score > 0.5"
        store_as: judgement
`)).toEqual({
      action:   "judge",
      value:    "some text",
      prompt:   "check it",
      pass_if:  "score > 0.5",
      store_as: "judgement",
    });
  });

  test("throws on missing 'value'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - judge:
        prompt: "check"
        pass_if: "score >= 0.5"
`)).toThrow('missing "value"');
  });

  test("throws on missing 'prompt'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - judge:
        value: "v"
        pass_if: "score >= 0.5"
`)).toThrow('missing "prompt"');
  });

  test("throws on missing 'pass_if'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - judge:
        value: "v"
        prompt: "p"
`)).toThrow('missing "pass_if"');
  });

  test("'judge' appears in unknown-action error message", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - unknown_step: foo
`)).toThrow("judge");
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("JudgeHandler — determinism", () => {
  test("system prompt instructs LLM to respond deterministically", async () => {
    let capturedSystem = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedSystem = req.system;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    expect(capturedSystem.toLowerCase()).toContain("deterministic");
  });
});

// ── Score boundary ────────────────────────────────────────────────────────────

describe("JudgeHandler — score boundary", () => {
  test("score of exactly 0 is valid and evaluable", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.0, "complete failure"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.0" }, makeAdapter(), makeCtx())
    ).resolves.toBeUndefined();
  });

  test("score of exactly 1 is valid and evaluable", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(1.0, "perfect"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 1.0" }, makeAdapter(), makeCtx())
    ).resolves.toBeUndefined();
  });

  test("null score is rejected as invalid format", async () => {
    const handler = new JudgeHandler(makeLLM('{"score":null,"reason":"ok"}'));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("score above 1 is rejected as invalid format", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: 1.01, reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });

  test("score below 0 is rejected as invalid format", async () => {
    const handler = new JudgeHandler(makeLLM(JSON.stringify({ score: -0.01, reason: "ok" })));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: invalid LLM response format");
  });
});

// ── pass_if robustness ────────────────────────────────────────────────────────

describe("JudgeHandler — pass_if robustness", () => {
  const adapter = makeAdapter();

  test("tolerates extra spaces: 'score   >=   0.7'", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score   >=   0.7" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("case-insensitive: 'SCORE >= 0.7'", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "SCORE >= 0.7" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("decimal shorthand: 'score >= .7' (no leading zero)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= .7" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("decimal shorthand fails correctly: score 0.5 fails 'score >= .7'", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.5));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= .7" }, adapter, makeCtx())
    ).rejects.toThrow("Judge failed");
  });

  test("mixed: 'Score   <=   .5' (case + spaces + shorthand)", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.3));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "Score   <=   .5" }, adapter, makeCtx())
    ).resolves.toBeUndefined();
  });
});

// ── RAG2-08: KnowledgeRetriever integration ───────────────────────────────────

/** Builds a stub KnowledgeRetriever that always returns the given chunks. */
function makeStubRetriever(chunks: RetrievedChunk[]): KnowledgeRetriever {
  return {
    retrieve: async (_query: string, _topK?: number) => chunks,
    // formatContext is not called by JudgeHandler (it uses its own formatter)
  } as unknown as KnowledgeRetriever;
}

function makeACChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    text:       "Coupon must be validated before loyalty points are applied",
    sourceId:   "SCRUM-42",
    sourceName: "jira",
    type:       "story",
    tags:       [],
    confidence: 1.0,
    relations:  [],
    ingestedAt: new Date().toISOString(),
    score:      0.91,
    ...overrides,
  };
}

describe("JudgeHandler — RAG2-08 KnowledgeRetriever", () => {
  const adapter = makeAdapter();

  test("AC chunks are appended to the LLM user message", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    const retriever = makeStubRetriever([makeACChunk()]);
    const handler   = new JudgeHandler(llm, retriever);
    await handler.execute(
      { action: "judge", value: "coupon applied", prompt: "Does it satisfy checkout AC?", pass_if: "score >= 0.5" },
      adapter, makeCtx(),
    );
    expect(capturedUser).toContain("Acceptance criteria from organisational knowledge");
    expect(capturedUser).toContain("SCRUM-42");
    expect(capturedUser).toContain("Coupon must be validated");
  });

  test("system prompt mentions evaluating against AC when provided", async () => {
    let capturedSystem = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedSystem = req.system;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    await new JudgeHandler(llm, makeStubRetriever([makeACChunk()])).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      adapter, makeCtx(),
    );
    expect(capturedSystem).toContain("acceptance criteria");
  });

  test("no retriever = no AC section in LLM message", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      adapter, makeCtx(),
    );
    expect(capturedUser).not.toContain("Acceptance criteria");
  });

  test("empty retriever result = no AC section in LLM message", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    const retriever = makeStubRetriever([]);
    await new JudgeHandler(llm, retriever).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      adapter, makeCtx(),
    );
    expect(capturedUser).not.toContain("Acceptance criteria");
  });

  test("multiple AC chunks are all included", async () => {
    let capturedUser = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        capturedUser = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    const chunks = [
      makeACChunk({ sourceId: "SCRUM-42", text: "Coupon validated before points" }),
      makeACChunk({ sourceId: "SCRUM-43", text: "Expired coupon shows error" }),
    ];
    await new JudgeHandler(llm, makeStubRetriever(chunks)).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.5" },
      adapter, makeCtx(),
    );
    expect(capturedUser).toContain("SCRUM-42");
    expect(capturedUser).toContain("SCRUM-43");
  });

  test("judge step still passes and fails correctly when retriever is present", async () => {
    const retriever = makeStubRetriever([makeACChunk()]);
    const passing   = new JudgeHandler(makeJudgeLLM(0.9), retriever);
    const failing   = new JudgeHandler(makeJudgeLLM(0.4), retriever);

    await expect(
      passing.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).resolves.toBeUndefined();

    await expect(
      failing.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, adapter, makeCtx())
    ).rejects.toThrow("Judge failed");
  });
});

// ── Error message format ──────────────────────────────────────────────────────

describe("JudgeHandler — error message format", () => {
  test("failure includes score, operator, and threshold on the first line", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.3, "not enough detail"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.8" }, makeAdapter(), makeCtx())
    ).rejects.toMatchObject({ message: expect.stringContaining("Judge failed (score: 0.3 >= 0.8)") });
  });

  test("failure includes Reason line with LLM reason", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.1, "completely off topic"));
    await expect(
      handler.execute({ action: "judge", value: "v", prompt: "p", pass_if: "score > 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toMatchObject({ message: expect.stringContaining("Reason: completely off topic") });
  });

  test("failure message has no missing fields — all four present", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.2, "weak answer"));
    let caughtMsg = "";
    try {
      await handler.execute(
        { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.9" }, makeAdapter(), makeCtx()
      );
    } catch (e) {
      caughtMsg = (e as Error).message;
    }
    // score (0.2), operator (>=), threshold (0.9), reason (weak answer)
    expect(caughtMsg).toMatch(/0\.2/);
    expect(caughtMsg).toMatch(/>=/);
    expect(caughtMsg).toMatch(/0\.9/);
    expect(caughtMsg).toMatch(/weak answer/);
  });
});

// ── Input truncation ──────────────────────────────────────────────────────────

describe("JudgeHandler — input truncation", () => {
  function capturingLLM(): { llm: LLMProvider; getLastMsg: () => string } {
    let lastMsg = "";
    const llm: LLMProvider = {
      name: "stub",
      async complete(req): Promise<LLMResponse> {
        lastMsg = req.userMessage;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    return { llm, getLastMsg: () => lastMsg };
  }

  test("appends '...[truncated]' when value exceeds 5000 chars", async () => {
    const { llm, getLastMsg } = capturingLLM();
    const bigValue = "x".repeat(6000);
    await new JudgeHandler(llm).execute(
      { action: "judge", value: bigValue, prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    expect(getLastMsg()).toContain("...[truncated]");
  });

  test("truncated value sent to LLM is exactly 5000 chars + suffix", async () => {
    const { llm, getLastMsg } = capturingLLM();
    const bigValue = "a".repeat(7000);
    await new JudgeHandler(llm).execute(
      { action: "judge", value: bigValue, prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    const valueInMsg = getLastMsg().split("\n\nCriteria:")[0].replace("Value:\n", "");
    expect(valueInMsg).toBe("a".repeat(5000) + "...[truncated]");
  });

  test("does not truncate value of exactly 5000 chars", async () => {
    const { llm, getLastMsg } = capturingLLM();
    const exactValue = "z".repeat(5000);
    await new JudgeHandler(llm).execute(
      { action: "judge", value: exactValue, prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    expect(getLastMsg()).not.toContain("...[truncated]");
  });

  test("does not truncate value of 4999 chars", async () => {
    const { llm, getLastMsg } = capturingLLM();
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "b".repeat(4999), prompt: "p", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    expect(getLastMsg()).not.toContain("...[truncated]");
  });

  test("step still passes after truncation", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute(
        { action: "judge", value: "c".repeat(9999), prompt: "is it long?", pass_if: "score >= 0.5" },
        makeAdapter(), makeCtx()
      )
    ).resolves.toBeUndefined();
  });

  test("appends truncation note to criteria when value is truncated", async () => {
    const { llm, getLastMsg } = capturingLLM();
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "x".repeat(6000), prompt: "check quality", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    const criteriaSection = getLastMsg().split("\n\nCriteria:\n")[1];
    expect(criteriaSection).toContain("Note: input was truncated for length.");
  });

  test("does not append truncation note when value is within limit", async () => {
    const { llm, getLastMsg } = capturingLLM();
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "short value", prompt: "check quality", pass_if: "score >= 0.5" },
      makeAdapter(), makeCtx()
    );
    expect(getLastMsg()).not.toContain("Note: input was truncated for length.");
  });
});

// ── Empty input guard ─────────────────────────────────────────────────────────

describe("JudgeHandler — empty input guard", () => {
  test("throws 'judge failed: empty input' for empty string", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: empty input");
  });

  test("throws 'judge failed: empty input' for whitespace-only value", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    await expect(
      handler.execute({ action: "judge", value: "   \t\n  ", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx())
    ).rejects.toThrow("judge failed: empty input");
  });

  test("does not call LLM when value is empty", async () => {
    let called = false;
    const llm: LLMProvider = {
      name: "stub",
      async complete(): Promise<LLMResponse> {
        called = true;
        return { content: JSON.stringify({ score: 0.9, reason: "ok" }), model: "stub" };
      },
    };
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), makeCtx()
    ).catch(() => {});
    expect(called).toBe(false);
  });

  test("resolves {{ }} template before checking empty — throws when template resolves to empty", async () => {
    const handler = new JudgeHandler(makeJudgeLLM(0.9));
    const ctx = makeCtx({ response: "" });
    await expect(
      handler.execute({ action: "judge", value: "{{ response }}", prompt: "p", pass_if: "score >= 0.5" }, makeAdapter(), ctx)
    ).rejects.toThrow("judge failed: empty input");
  });
});

// ── Score normalization ───────────────────────────────────────────────────────

describe("JudgeHandler — score normalization", () => {
  test("score is normalized to 3 decimal places in store_as", async () => {
    const llm = makeLLM(JSON.stringify({ score: 0.12345, reason: "ok" }));
    const ctx = makeCtx();
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.1", store_as: "r" },
      makeAdapter(), ctx
    );
    expect((ctx.get("r") as { score: number }).score).toBe(0.123);
  });

  test("normalized score is used in error message", async () => {
    const llm = makeLLM(JSON.stringify({ score: 0.49999, reason: "borderline" }));
    await expect(
      new JudgeHandler(llm).execute(
        { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.6" }, makeAdapter(), makeCtx()
      )
    ).rejects.toMatchObject({ message: expect.stringContaining("score: 0.5") });
  });

  test("normalization does not move a passing score below threshold", async () => {
    // 0.7001 rounds to 0.700 — still passes >= 0.7
    const llm = makeLLM(JSON.stringify({ score: 0.7001, reason: "ok" }));
    await expect(
      new JudgeHandler(llm).execute(
        { action: "judge", value: "v", prompt: "p", pass_if: "score >= 0.7" }, makeAdapter(), makeCtx()
      )
    ).resolves.toBeUndefined();
  });

  test("clean integer-like scores are unaffected (1.0 stays 1)", async () => {
    const ctx = makeCtx();
    const llm = makeLLM(JSON.stringify({ score: 1.0, reason: "perfect" }));
    await new JudgeHandler(llm).execute(
      { action: "judge", value: "v", prompt: "p", pass_if: "score >= 1.0", store_as: "r" },
      makeAdapter(), ctx
    );
    expect((ctx.get("r") as { score: number }).score).toBe(1);
  });
});
