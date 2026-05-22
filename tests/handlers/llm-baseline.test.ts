/**
 * GEN-02: llm_eval baseline regression — BaselineStore + drift detection
 */

import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { LLMEvalHandler } from "../../src/handlers/LLMEvalHandler";
import { MockLLMProvider } from "../../src/llm/MockLLMProvider";
import { BaselineStore, BaselineEntry } from "../../src/ai-testing/BaselineStore";
import { AssertionError }  from "../../src/errors";
import { ExecutionContext } from "../../src/execution/ExecutionContext";
import { IEmbedder }        from "../../src/knowledge/Embedder";
import { parseTestDefinition } from "../../src/dsl/DslParser";

// ── test helpers ──────────────────────────────────────────────────────────────

function makeCtx(): ExecutionContext { return new ExecutionContext({}, null); }

const noAdapter  = {} as never;
const judgeStub  = new MockLLMProvider('{"score":0.9,"reason":"ok"}');

/** Embedder that always returns the same unit vector → distance = 0 */
function uniformEmbedder(): IEmbedder {
  return { async embed() { return [1, 0, 0, 0]; } };
}

/** Embedder that returns [1,0,0,0] regardless of text */
const fixedEmbedder = uniformEmbedder;

/** Fake BaselineStore backed by an in-memory map */
function fakeStore(opts: {
  baseline?: number[];
  record?:   boolean;
} = {}): BaselineStore & { written?: BaselineEntry } {
  let written: BaselineEntry | undefined;
  const store = {
    get recordMode() { return opts.record ?? false; },
    async read(_key: string): Promise<BaselineEntry | null> {
      if (!opts.baseline) return null;
      return { embedding: opts.baseline, response: "prev", recordedAt: "2026-01-01T00:00:00.000Z" };
    },
    async write(_key: string, entry: BaselineEntry) { written = entry; },
    get written() { return written; },
  } as unknown as BaselineStore & { written?: BaselineEntry };
  return store;
}

// ── BaselineStore — file I/O ──────────────────────────────────────────────────

describe("BaselineStore — file I/O", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiqa-baseline-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test("read returns null for missing file", async () => {
    const store = new BaselineStore(tmpDir);
    expect(await store.read("nonexistent")).toBeNull();
  });

  test("write then read round-trips correctly", async () => {
    const store = new BaselineStore(tmpDir);
    const entry: BaselineEntry = { embedding: [1, 0, 0], response: "hello", recordedAt: "2026-01-01T00:00:00.000Z" };
    await store.write("my-key", entry);
    expect(await store.read("my-key")).toEqual(entry);
  });

  test("write creates nested directories", async () => {
    const store = new BaselineStore(path.join(tmpDir, "deep", "nested"));
    await store.write("k", { embedding: [1], response: "r", recordedAt: "2026-01-01T00:00:00.000Z" });
    expect(await store.read("k")).not.toBeNull();
  });

  test("recordMode reads AIQA_BASELINE_RECORD env var", () => {
    const store = new BaselineStore(tmpDir);
    delete process.env.AIQA_BASELINE_RECORD;
    expect(store.recordMode).toBe(false);
    process.env.AIQA_BASELINE_RECORD = "true";
    expect(store.recordMode).toBe(true);
    delete process.env.AIQA_BASELINE_RECORD;
  });

  test("M1: throws on path traversal in key", () => {
    const store = new BaselineStore(tmpDir);
    expect(() => store["filePath"]("../../.env")).toThrow(/path traversal/);
  });

  test("L1: throws descriptive error on corrupt baseline file", async () => {
    const store = new BaselineStore(tmpDir);
    const file  = path.join(tmpDir, "bad.json");
    await fs.promises.writeFile(file, "{ not valid json", "utf-8");
    await expect(store.read("bad")).rejects.toThrow(/corrupt baseline/);
  });
});

// ── LLMEvalHandler — record mode ──────────────────────────────────────────────

describe("LLMEvalHandler — baseline record mode", () => {
  test("writes baseline when recordMode=true", async () => {
    const store   = fakeStore({ record: true });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1" };
    await handler.execute(step, noAdapter, makeCtx());
    expect(store.written).toBeDefined();
    expect(store.written!.response).toBeDefined();
    expect(Array.isArray(store.written!.embedding)).toBe(true);
  });

  test("does not assert in record mode — never throws", async () => {
    const store   = fakeStore({ record: true });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("sets baseline_recorded=true in store_as on record", async () => {
    const store   = fakeStore({ record: true });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1", store_as: "res" };
    const ctx     = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.baseline_recorded).toBe(true);
    expect(stored.response).toBeDefined();
  });

  test("record mode writes baseline even when assert_quality would fail", async () => {
    // judgeStub returns score=0.9 by default — use a stub that returns 0.1 to force failure
    const failingJudge = new MockLLMProvider('{"score":0.1,"reason":"poor"}');
    const store   = fakeStore({ record: true });
    const handler = new LLMEvalHandler(failingJudge, undefined, {}, fixedEmbedder(), store);
    const step    = {
      action: "llm_eval" as const, provider: "mock", prompt: "hi",
      baseline_key: "k1",
      assert_quality: { criteria: "good response", pass_if: "score >= 0.8" },
    };
    // Must not throw — record mode captures unconditionally before quality runs
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
    expect(store.written).toBeDefined();
  });
});

// ── LLMEvalHandler — compare mode ─────────────────────────────────────────────

describe("LLMEvalHandler — baseline compare mode", () => {
  test("passes when drift is 0 (identical embeddings)", async () => {
    // baseline stored as [1,0,0,0]; current response also embeds to [1,0,0,0]
    const store   = fakeStore({ baseline: [1, 0, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("throws AssertionError when drift exceeds max_drift", async () => {
    // baseline [0,1,0,0], current [1,0,0,0] → cosine dist = 1.0 > 0.2
    const store   = fakeStore({ baseline: [0, 1, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1", max_drift: 0.2 };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("error message includes drift value and baseline key", async () => {
    const store   = fakeStore({ baseline: [0, 1, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "my-key" };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/my-key/);
  });

  test("stores baseline_distance and baseline_verdict before throwing", async () => {
    const store   = fakeStore({ baseline: [0, 1, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1", store_as: "res" };
    const ctx     = makeCtx();
    await expect(handler.execute(step, noAdapter, ctx)).rejects.toThrow();
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.baseline_verdict).toBe("fail");
    expect(typeof stored.baseline_distance).toBe("number");
  });

  test("default max_drift is 0.2 — passes when drift=0", async () => {
    const store   = fakeStore({ baseline: [1, 0, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    // no max_drift in step — defaults to 0.2
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("throws when no baseline file exists yet", async () => {
    const store   = fakeStore(); // baseline: undefined → read returns null
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "missing" };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/AIQA_BASELINE_RECORD/);
  });

  test("throws AssertionError when embedder absent and baseline_key set", async () => {
    const handler = new LLMEvalHandler(judgeStub);  // no embedder
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1" };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/embedder/);
  });

  test("baseline_verdict=pass is stored on success", async () => {
    const store   = fakeStore({ baseline: [1, 0, 0, 0] });
    const handler = new LLMEvalHandler(judgeStub, undefined, {}, fixedEmbedder(), store);
    const step    = { action: "llm_eval" as const, provider: "mock", prompt: "hi", baseline_key: "k1", store_as: "res" };
    const ctx     = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("res") as Record<string, unknown>;
    expect(stored.baseline_verdict).toBe("pass");
    expect(stored.baseline_distance).toBeCloseTo(0, 5);
  });
});

// ── DslParser — baseline fields ───────────────────────────────────────────────

describe("DslParser — llm_eval baseline fields", () => {
  test("parses baseline_key and max_drift", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        provider: mock
        prompt: "Explain login"
        baseline_key: login-baseline
        max_drift: 0.15
        store_as: result
`);
    const step = def.steps[0] as Record<string, unknown>;
    expect(step.baseline_key).toBe("login-baseline");
    expect(step.max_drift).toBe(0.15);
    expect(step.store_as).toBe("result");
  });

  test("throws on max_drift out of range", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        provider: mock
        prompt: "hi"
        max_drift: 1.5
`)).toThrow(/max_drift/);
  });

  test("llm_eval without baseline_key still parses normally", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - llm_eval:
        provider: mock
        prompt: "hello"
`);
    expect(def.steps[0].action).toBe("llm_eval");
    expect((def.steps[0] as Record<string, unknown>).baseline_key).toBeUndefined();
  });
});
