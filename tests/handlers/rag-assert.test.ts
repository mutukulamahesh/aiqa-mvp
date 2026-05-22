/**
 * GEN-05: RagAssertHandler — KnowledgeRetriever assertions
 */

import { RagAssertHandler } from "../../src/handlers/RagAssertHandler";
import { StepInterpreter }  from "../../src/execution/StepInterpreter";
import { ExecutionContext }  from "../../src/execution/ExecutionContext";
import { AssertionError }   from "../../src/errors";
import { KnowledgeRetriever } from "../../src/knowledge/KnowledgeRetriever";
import { RetrievedChunk }   from "../../src/knowledge/types";

// ── test helpers ──────────────────────────────────────────────────────────────

function makeChunk(sourceId: string, score: number): RetrievedChunk {
  return {
    sourceId,
    sourceName: "jira",
    text:       `Content for ${sourceId}`,
    type:       "story",
    tags:       [],
    confidence: 1.0,
    relations:  [],
    ingestedAt: new Date().toISOString(),
    score,
  };
}

function makeRetriever(chunks: RetrievedChunk[]): KnowledgeRetriever {
  return { retrieve: async () => chunks } as unknown as KnowledgeRetriever;
}

function makeCtx(): ExecutionContext { return new ExecutionContext({}, null); }

const noAdapter = {} as never;

// ── RagAssertHandler — no retriever ───────────────────────────────────────────

describe("RagAssertHandler — no retriever configured", () => {
  test("throws AssertionError when retriever is absent", async () => {
    const handler = new RagAssertHandler();
    const step    = { action: "rag_assert" as const, query: "login flow" };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(AssertionError);
  });

  test("error message mentions knowledge configuration", async () => {
    const handler = new RagAssertHandler();
    const step    = { action: "rag_assert" as const, query: "login flow" };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/knowledge retriever is not configured/);
  });
});

// ── RagAssertHandler — pass cases ─────────────────────────────────────────────

describe("RagAssertHandler — pass cases", () => {
  test("passes when at least 1 chunk returned (default min_chunks)", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.9)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("passes with default min_score=0: any score qualifies", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.01)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login" };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("passes when enough chunks meet min_score", async () => {
    const retriever = makeRetriever([
      makeChunk("SCRUM-1", 0.9),
      makeChunk("SCRUM-2", 0.8),
      makeChunk("SCRUM-3", 0.3),
    ]);
    const handler = new RagAssertHandler(retriever);
    const step    = { action: "rag_assert" as const, query: "login", min_score: 0.7, min_chunks: 2 };
    await expect(handler.execute(step, noAdapter, makeCtx())).resolves.not.toThrow();
  });

  test("stores only passing chunks in store_as", async () => {
    const retriever = makeRetriever([
      makeChunk("SCRUM-1", 0.9),
      makeChunk("SCRUM-2", 0.4),
    ]);
    const handler = new RagAssertHandler(retriever);
    const step    = { action: "rag_assert" as const, query: "login", min_score: 0.7, store_as: "chunks" };
    const ctx     = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("chunks") as RetrievedChunk[];
    expect(stored).toHaveLength(1);
    expect(stored[0].sourceId).toBe("SCRUM-1");
  });

  test("stores all chunks when min_score=0 (every chunk passes)", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.8), makeChunk("SCRUM-2", 0.6)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login", store_as: "chunks" };
    const ctx       = makeCtx();
    await handler.execute(step, noAdapter, ctx);
    const stored = ctx.get("chunks") as RetrievedChunk[];
    expect(stored).toHaveLength(2);
  });
});

// ── RagAssertHandler — fail cases ─────────────────────────────────────────────

describe("RagAssertHandler — fail cases", () => {
  test("throws AssertionError when no chunks returned", async () => {
    const retriever = makeRetriever([]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "unknown topic" };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("throws when chunks exist but none meet min_score", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.4), makeChunk("SCRUM-2", 0.3)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login", min_score: 0.7 };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("throws when fewer chunks than min_chunks pass", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.9), makeChunk("SCRUM-2", 0.4)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login", min_score: 0.7, min_chunks: 2 };
    await expect(handler.execute(step, noAdapter, makeCtx())).rejects.toThrow(AssertionError);
  });

  test("error message includes counts and threshold", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.4)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login", min_score: 0.7, min_chunks: 2 };
    await expect(handler.execute(step, noAdapter, makeCtx()))
      .rejects.toThrow(/0 chunk\(s\).*0\.7.*need 2/);
  });

  test("stores failing chunks before throwing", async () => {
    const retriever = makeRetriever([makeChunk("SCRUM-1", 0.4)]);
    const handler   = new RagAssertHandler(retriever);
    const step      = { action: "rag_assert" as const, query: "login", min_score: 0.7, store_as: "chunks" };
    const ctx       = makeCtx();
    await expect(handler.execute(step, noAdapter, ctx)).rejects.toThrow();
    const stored = ctx.get("chunks") as RetrievedChunk[];
    expect(stored).toHaveLength(0);
  });
});

// ── RagAssertHandler — topK behaviour ─────────────────────────────────────────

describe("RagAssertHandler — topK", () => {
  test("requests at least 5 chunks even when min_chunks=1", async () => {
    let capturedTopK = 0;
    const retriever = {
      retrieve: async (_q: string, topK: number) => { capturedTopK = topK; return [makeChunk("A", 0.9)]; }
    } as unknown as KnowledgeRetriever;
    const handler = new RagAssertHandler(retriever);
    await handler.execute({ action: "rag_assert" as const, query: "q", min_chunks: 1 }, noAdapter, makeCtx());
    expect(capturedTopK).toBe(5);
  });

  test("requests topK = min_chunks when min_chunks > 5", async () => {
    let capturedTopK = 0;
    const retriever = {
      retrieve: async (_q: string, topK: number) => {
        capturedTopK = topK;
        return Array.from({ length: topK }, (_, i) => makeChunk(`C-${i}`, 0.9));
      }
    } as unknown as KnowledgeRetriever;
    const handler = new RagAssertHandler(retriever);
    await handler.execute({ action: "rag_assert" as const, query: "q", min_chunks: 8 }, noAdapter, makeCtx());
    expect(capturedTopK).toBe(8);
  });
});

// ── StepInterpreter integration ───────────────────────────────────────────────

describe("StepInterpreter — rag_assert registered", () => {
  test("throws AssertionError when no retriever (default interpreter)", async () => {
    const interpreter = new StepInterpreter();
    const step = { action: "rag_assert" as const, query: "login flow" };
    await expect(interpreter.execute(step, {} as never, new ExecutionContext({}, null)))
      .rejects.toThrow(AssertionError);
  });
});

// ── DslParser integration ──────────────────────────────────────────────────────

describe("DslParser — rag_assert parsing", () => {
  const { parseTestDefinition } = require("../../src/dsl/DslParser");

  test("parses minimal rag_assert step", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - rag_assert:
        query: "What is the login flow?"
`);
    expect(def.steps[0].action).toBe("rag_assert");
    expect((def.steps[0] as { query: string }).query).toBe("What is the login flow?");
  });

  test("parses full rag_assert step", () => {
    const def = parseTestDefinition(`
test:
  name: test
  steps:
    - rag_assert:
        query: "checkout acceptance criteria"
        min_score: 0.7
        min_chunks: 3
        store_as: results
`);
    const step = def.steps[0] as Record<string, unknown>;
    expect(step.action).toBe("rag_assert");
    expect(step.min_score).toBe(0.7);
    expect(step.min_chunks).toBe(3);
    expect(step.store_as).toBe("results");
  });

  test("throws on missing query", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - rag_assert:
        min_score: 0.5
`)).toThrow(/query/);
  });

  test("throws on invalid min_score", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - rag_assert:
        query: "login"
        min_score: 1.5
`)).toThrow(/min_score/);
  });

  test("throws on invalid min_chunks", () => {
    expect(() => parseTestDefinition(`
test:
  name: test
  steps:
    - rag_assert:
        query: "login"
        min_chunks: 0
`)).toThrow(/min_chunks/);
  });
});
