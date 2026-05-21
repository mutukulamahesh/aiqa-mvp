/**
 * GEN-01: LLMEvalHandler — call any LLM and assert response quality
 */

import { LLMEvalHandler }  from "../../src/handlers/LLMEvalHandler";
import { MockLLMProvider }  from "../../src/llm/MockLLMProvider";
import { HandlerRegistry }  from "../../src/execution/HandlerRegistry";
import { StepInterpreter }  from "../../src/execution/StepInterpreter";
import { ExecutionContext }  from "../../src/execution/ExecutionContext";
import { AssertionError }   from "../../src/errors";
import { loadConfig, resetConfig } from "../../src/config/ConfigLoader";
import * as path from "path";

// ── helpers ───────────────────────────────────────────────────────────────────

function stubJudgeLlm(score: number, reason = "ok") {
  return new MockLLMProvider(`{"score":${score},"reason":"${reason}"}`);
}

function stubTargetLlm(response: string) {
  return new MockLLMProvider(response);
}

function makeCtx(vars: Record<string, string> = {}): ExecutionContext {
  const ctx = new ExecutionContext({}, null);
  for (const [k, v] of Object.entries(vars)) ctx.set(k, v);
  return ctx;
}

const noAdapter = {} as never;

// ── judgeUtils unit tests ─────────────────────────────────────────────────────

describe("judgeUtils — parsePassIf + applyOp", () => {
  const { parsePassIf, applyOp } = require("../../src/handlers/judgeUtils");

  test.each([
    ["score >= 0.7", ">=", 0.7],
    ["score > .5",   ">",  0.5],
    ["score <= 1.0", "<=", 1.0],
    ["SCORE < 0.3",  "<",  0.3],
    [" score >= 0.9 ", ">=", 0.9],
  ])("parsePassIf('%s') → op=%s threshold=%s", (expr, op, threshold) => {
    expect(parsePassIf(expr)).toEqual({ op, threshold });
  });

  test("parsePassIf throws on invalid expression", () => {
    expect(() => parsePassIf("score = 0.5")).toThrow(AssertionError);
    expect(() => parsePassIf("0.5")).toThrow(AssertionError);
  });

  test.each([
    [">=", 0.8, 0.7, true],
    [">=", 0.6, 0.7, false],
    [">",  0.8, 0.7, true],
    [">",  0.7, 0.7, false],
    ["<=", 0.6, 0.7, true],
    ["<",  0.6, 0.7, true],
    ["<",  0.7, 0.7, false],
  ])("applyOp(%s, %s, %s) → %s", (op, score, threshold, expected) => {
    expect(applyOp(op, score, threshold)).toBe(expected);
  });
});

// ── scoreByCriteria ───────────────────────────────────────────────────────────

describe("judgeUtils — scoreByCriteria", () => {
  const { scoreByCriteria } = require("../../src/handlers/judgeUtils");

  test("parses valid LLM JSON response", async () => {
    const llm    = stubJudgeLlm(0.85, "Looks correct");
    const result = await scoreByCriteria(llm, "Paris", "Name the capital of France");
    expect(result.score).toBeCloseTo(0.85, 2);
    expect(result.reason).toBe("Looks correct");
  });

  test("throws AssertionError on invalid JSON from LLM", async () => {
    const llm = new MockLLMProvider("not json at all");
    await expect(scoreByCriteria(llm, "v", "c")).rejects.toThrow(AssertionError);
  });

  test("throws on missing score field", async () => {
    const llm = new MockLLMProvider('{"reason":"ok"}');
    await expect(scoreByCriteria(llm, "v", "c")).rejects.toThrow(AssertionError);
  });

  test("throws on score out of range", async () => {
    const llm = new MockLLMProvider('{"score":1.5,"reason":"too high"}');
    await expect(scoreByCriteria(llm, "v", "c")).rejects.toThrow(AssertionError);
  });
});

// ── LLMEvalHandler ────────────────────────────────────────────────────────────

describe("LLMEvalHandler — no assert_quality", () => {
  test("stores raw response when no assert_quality", async () => {
    const target = stubTargetLlm("Bonjour");
    const judge  = stubJudgeLlm(0.9);
    const handler = new LLMEvalHandler(judge);

    // Override resolveTarget by using inline provider resolved to target stub
    // We test via full handler with mock provider
    const ctx = makeCtx();
    const step = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "Translate hello to French",
      store_as: "result",
    };

    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("result");
    expect(typeof stored).toBe("object");
  });

  test("does not throw when no assert_quality even with low score", async () => {
    const handler = new LLMEvalHandler(stubJudgeLlm(0.1));
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "test" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });
});

describe("LLMEvalHandler — with assert_quality", () => {
  test("passes when score meets pass_if threshold", async () => {
    const judge   = stubJudgeLlm(0.9, "excellent");
    const handler = new LLMEvalHandler(judge);
    const step    = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "Translate hello to French",
      assert_quality: { criteria: "Is a correct French translation", pass_if: "score >= 0.8" },
      store_as: "res",
    };
    const ctx = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.score).toBeCloseTo(0.9, 2);
    expect(stored.verdict).toBe("pass");
    expect(stored.response).toBeDefined();
  });

  test("throws AssertionError when score fails pass_if", async () => {
    const judge   = stubJudgeLlm(0.4, "poor quality");
    const handler = new LLMEvalHandler(judge);
    const step    = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "Translate hello to French",
      assert_quality: { criteria: "Is correct", pass_if: "score >= 0.8" },
    };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("stores verdict=fail before throwing so result is available", async () => {
    const judge   = stubJudgeLlm(0.3, "bad");
    const handler = new LLMEvalHandler(judge);
    const step    = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "test",
      assert_quality: { criteria: "c", pass_if: "score >= 0.8" },
      store_as: "res",
    };
    const ctx = makeCtx();
    await expect(handler.execute(step, noAdapter, ctx)).rejects.toThrow();
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.verdict).toBe("fail");
  });

  test("system prompt defaults when omitted", async () => {
    const judge   = stubJudgeLlm(1.0);
    const handler = new LLMEvalHandler(judge);
    const step    = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "hello",
      assert_quality: { criteria: "c", pass_if: "score >= 0.5" },
    };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });
});

describe("LLMEvalHandler — target resolution", () => {
  beforeEach(() => {
    resetConfig();
    process.env.NODE_ENV = "test";
  });
  afterEach(() => resetConfig());

  test("throws AssertionError for unknown named target", async () => {
    loadConfig("dev");
    const handler = new LLMEvalHandler(stubJudgeLlm(0.9));
    const step    = { action: "llm_eval" as const, target: "nonexistent", prompt: "test" };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(/unknown target/i);
  });

  test("falls back to mock when neither target nor provider specified", async () => {
    const handler = new LLMEvalHandler(stubJudgeLlm(0.9));
    const step    = { action: "llm_eval" as const, prompt: "hello" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });
});

// ── StepInterpreter integration ───────────────────────────────────────────────

describe("StepInterpreter — llm_eval registered", () => {
  test("llm_eval step is dispatched by the interpreter", async () => {
    const interpreter = new StepInterpreter();
    const step = {
      action:   "llm_eval" as const,
      provider: "mock",
      prompt:   "hello",
      assert_quality: { criteria: "response is non-empty", pass_if: "score >= 0.5" },
    };
    const ctx = new ExecutionContext({}, null);
    await expect(
      interpreter.execute(step, {} as never, ctx)
    ).resolves.not.toThrow();
  });
});

// ── DslParser integration ─────────────────────────────────────────────────────

describe("DslParser — llm_eval parsing", () => {
  const { parseTestDefinition } = require("../../src/dsl/DslParser");

  test("parses minimal llm_eval step", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        provider: mock
        prompt: "Translate hello"
`);
    expect(def.steps[0].action).toBe("llm_eval");
    expect((def.steps[0] as { prompt: string }).prompt).toBe("Translate hello");
  });

  test("parses full llm_eval step with assert_quality", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        target: fast
        system: "Be helpful"
        prompt: "Translate hello to French"
        max_tokens: 50
        assert_quality:
          criteria: "Is correct French"
          pass_if: ">= 0.8"
        store_as: result
`);
    const step = def.steps[0] as Record<string, unknown>;
    expect(step.action).toBe("llm_eval");
    expect(step.target).toBe("fast");
    expect(step.max_tokens).toBe(50);
    expect((step.assert_quality as Record<string, string>).pass_if).toBe(">= 0.8");
    expect(step.store_as).toBe("result");
  });

  test("throws on missing prompt", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        provider: mock
`)).toThrow(/prompt/);
  });
});
