/**
 * GEN-04: llm_consistency — N sequential runs, pairwise cosine variance
 */

import { ConsistencyHandler } from "../../src/handlers/ConsistencyHandler";
import { VarianceComputer }   from "../../src/ai-testing/VarianceComputer";
import { StepInterpreter }    from "../../src/execution/StepInterpreter";
import { ExecutionContext }    from "../../src/execution/ExecutionContext";
import { MockLLMProvider }    from "../../src/llm/MockLLMProvider";
import { AssertionError }     from "../../src/errors";
import { IEmbedder }          from "../../src/knowledge/Embedder";
import { loadConfig, resetConfig } from "../../src/config/ConfigLoader";

// ── test helpers ──────────────────────────────────────────────────────────────

/** Embedder that returns the same unit vector for every input → variance = 0 */
function uniformEmbedder(): IEmbedder {
  return { async embed() { return [1, 0, 0, 0]; } };
}

/** Embedder that returns a different orthogonal unit vector on each call → max distance = 1 */
function divergingEmbedder(): IEmbedder {
  const bases = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  let i = 0;
  return { async embed() { return bases[i++ % bases.length]; } };
}

/** Fixed-response LLM (same string every call) */
function fixedLlm(resp: string) { return new MockLLMProvider(resp); }

function makeCtx(): ExecutionContext { return new ExecutionContext({}, null); }

const noAdapter = {} as never;

// ── VarianceComputer unit tests ────────────────────────────────────────────────

describe("VarianceComputer — compute", () => {
  test("returns 0 for fewer than 2 responses", async () => {
    const vc = new VarianceComputer(uniformEmbedder());
    expect(await vc.compute([])).toBe(0);
    expect(await vc.compute(["only one"])).toBe(0);
  });

  test("identical embeddings → variance 0", async () => {
    const vc = new VarianceComputer(uniformEmbedder());
    expect(await vc.compute(["a", "b", "c"])).toBe(0);
  });

  test("orthogonal embeddings → max distance = 1", async () => {
    const vc = new VarianceComputer(divergingEmbedder());
    const v  = await vc.compute(["r1", "r2"]);
    expect(v).toBeCloseTo(1, 5);
  });

  test("max metric returns worst-case pair", async () => {
    // 3 embeddings: [1,0,0,0], [0,1,0,0], [0,0,1,0] — all orthogonal → max dist = 1
    const vc = new VarianceComputer(divergingEmbedder());
    const v  = await vc.compute(["r1", "r2", "r3"], "max");
    expect(v).toBeCloseTo(1, 5);
  });

  test("mean metric averages pairwise distances", async () => {
    // Same orthogonal setup — mean of three 1.0 distances = 1.0
    const vc = new VarianceComputer(divergingEmbedder());
    const v  = await vc.compute(["r1", "r2", "r3"], "mean");
    expect(v).toBeCloseTo(1, 5);
  });

  test("parallel embeddings (same direction) → distance 0", async () => {
    const vc = new VarianceComputer({ async embed() { return [0.6, 0.8, 0]; } });
    expect(await vc.compute(["x", "y"])).toBeCloseTo(0, 5);
  });
});

// ── ConsistencyHandler — no assert_variance ────────────────────────────────────

describe("ConsistencyHandler — no assert_variance", () => {
  test("stores responses, variance, metric when store_as set", async () => {
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = {
      action:   "llm_consistency" as const,
      provider: "mock",
      prompt:   "hello",
      runs:     2,
      store_as: "res",
    };
    const ctx = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(Array.isArray(stored.responses)).toBe(true);
    expect((stored.responses as string[]).length).toBe(2);
    expect(typeof stored.variance).toBe("number");
    expect(stored.metric).toBe("max");
    expect(stored.verdict).toBeUndefined();
  });

  test("default runs is 3", async () => {
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = {
      action:   "llm_consistency" as const,
      provider: "mock",
      prompt:   "hello",
      store_as: "res",
    };
    const ctx = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect((stored.responses as string[]).length).toBe(3);
  });

  test("does not throw even with high variance embedder when no assert_variance", async () => {
    const handler = new ConsistencyHandler(divergingEmbedder());
    const step = { action: "llm_consistency" as const, provider: "mock", prompt: "hi" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });
});

// ── ConsistencyHandler — with assert_variance ──────────────────────────────────

describe("ConsistencyHandler — with assert_variance", () => {
  test("passes when variance <= max (uniform embedder → 0)", async () => {
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hello",
      runs:            3,
      assert_variance: { max: 0.3 },
      store_as:        "res",
    };
    const ctx = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.verdict).toBe("pass");
    expect(stored.variance).toBeCloseTo(0, 5);
  });

  test("throws AssertionError when variance > max", async () => {
    const handler = new ConsistencyHandler(divergingEmbedder());
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hello",
      runs:            2,
      assert_variance: { max: 0.1 },
    };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("throws error message includes metric and distance", async () => {
    const handler = new ConsistencyHandler(divergingEmbedder());
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hello",
      runs:            2,
      assert_variance: { max: 0.1, metric: "max" as const },
    };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/max pairwise distance/);
  });

  test("stores verdict=fail before throwing", async () => {
    const handler = new ConsistencyHandler(divergingEmbedder());
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hello",
      runs:            2,
      assert_variance: { max: 0.1 },
      store_as:        "res",
    };
    const ctx = makeCtx();
    await expect(handler.execute(step, noAdapter, ctx)).rejects.toThrow();
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.verdict).toBe("fail");
  });

  test("uses mean metric when specified", async () => {
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hi",
      runs:            3,
      assert_variance: { max: 0.5, metric: "mean" as const },
      store_as:        "res",
    };
    const ctx = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.metric).toBe("mean");
    expect(stored.verdict).toBe("pass");
  });
});

// ── ConsistencyHandler — target resolution ─────────────────────────────────────

describe("ConsistencyHandler — target resolution", () => {
  beforeEach(() => { resetConfig(); process.env.NODE_ENV = "test"; });
  afterEach(() => resetConfig());

  test("throws AssertionError for unknown named target", async () => {
    loadConfig("dev");
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = { action: "llm_consistency" as const, target: "nonexistent", prompt: "hi" };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(/unknown target/i);
  });

  test("falls back to mock when no target or provider", async () => {
    const handler = new ConsistencyHandler(uniformEmbedder());
    const step = { action: "llm_consistency" as const, prompt: "hi", runs: 2 };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });
});

// ── StepInterpreter integration ────────────────────────────────────────────────

describe("StepInterpreter — llm_consistency registered", () => {
  test("dispatches llm_consistency step", async () => {
    const { StubEmbedder } = require("../../src/knowledge/Embedder");
    const interpreter = new StepInterpreter({ embedder: new StubEmbedder() });
    const step = {
      action:          "llm_consistency" as const,
      provider:        "mock",
      prompt:          "hello",
      runs:            2,
      assert_variance: { max: 0.5 },
    };
    const ctx = new ExecutionContext({}, null);
    await expect(interpreter.execute(step, {} as never, ctx)).resolves.not.toThrow();
  });
});

// ── DslParser integration ──────────────────────────────────────────────────────

describe("DslParser — llm_consistency parsing", () => {
  const { parseTestDefinition } = require("../../src/dsl/DslParser");

  test("parses minimal llm_consistency step", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_consistency:
        provider: mock
        prompt: "Summarize this"
`);
    expect(def.steps[0].action).toBe("llm_consistency");
    expect((def.steps[0] as { prompt: string }).prompt).toBe("Summarize this");
  });

  test("parses full step with assert_variance", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_consistency:
        target: fast
        prompt: "Explain gravity"
        runs: 5
        assert_variance:
          max: 0.3
          metric: mean
        store_as: result
`);
    const step = def.steps[0] as Record<string, unknown>;
    expect(step.action).toBe("llm_consistency");
    expect(step.target).toBe("fast");
    expect(step.runs).toBe(5);
    expect((step.assert_variance as Record<string, unknown>).max).toBe(0.3);
    expect((step.assert_variance as Record<string, unknown>).metric).toBe("mean");
    expect(step.store_as).toBe("result");
  });

  test("throws on missing prompt", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - llm_consistency:
        provider: mock
`)).toThrow(/prompt/);
  });

  test("throws on runs < 1", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - llm_consistency:
        prompt: "hi"
        runs: 0
`)).toThrow(/runs/);
  });

  test("throws on runs > 20", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - llm_consistency:
        prompt: "hi"
        runs: 21
`)).toThrow(/runs/);
  });
});
