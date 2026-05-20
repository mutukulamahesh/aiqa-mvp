import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { StubEmbedder }             from "../../src/knowledge/Embedder";
import { VectorIndex }              from "../../src/knowledge/VectorIndex";
import { KnowledgeStore }           from "../../src/knowledge/KnowledgeStore";
import { KnowledgeRetriever }       from "../../src/knowledge/KnowledgeRetriever";
import { NaiveChunker }             from "../../src/knowledge/chunkers/NaiveChunker";
import { ACChunker }                from "../../src/knowledge/chunkers/ACChunker";
import { CosineSimilarityReranker } from "../../src/knowledge/rerankers/CosineSimilarityReranker";
import { HybridReranker }           from "../../src/knowledge/rerankers/HybridReranker";
import { HealthScorer }             from "../../src/knowledge/HealthScorer";
import { KnowledgeChunk }           from "../../src/knowledge/types";

function tmpDir() {
  const d = path.join(os.tmpdir(), `aiqa-rag-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    text:       "Coupon must be validated before loyalty points are applied",
    sourceId:   "SCRUM-12",
    sourceName: "jira",
    type:       "story",
    tags:       ["checkout", "coupon"],
    severity:   "high",
    confidence: 1.0,
    relations:  [],
    ingestedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── StubEmbedder ─────────────────────────────────────────────────────────────

describe("StubEmbedder", () => {
  const embedder = new StubEmbedder();

  test("returns a vector of length 384", async () => {
    const v = await embedder.embed("hello");
    expect(v).toHaveLength(384);
  });

  test("same text always produces the same vector (deterministic)", async () => {
    const v1 = await embedder.embed("checkout coupon");
    const v2 = await embedder.embed("checkout coupon");
    expect(v1).toEqual(v2);
  });

  test("different texts produce different vectors", async () => {
    const v1 = await embedder.embed("checkout coupon");
    const v2 = await embedder.embed("login authentication");
    expect(v1).not.toEqual(v2);
  });
});

// ── VectorIndex ───────────────────────────────────────────────────────────────

describe("VectorIndex", () => {
  test("add and search returns the inserted chunk", async () => {
    const dir   = tmpDir();
    const index = new VectorIndex(dir);
    const chunk = makeChunk();
    const vec   = await new StubEmbedder().embed(chunk.text);

    await index.add(chunk, vec);
    const results = await index.search(vec, 1);

    expect(results).toHaveLength(1);
    expect(results[0].sourceId).toBe("SCRUM-12");
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("search returns [] when index is empty", async () => {
    const dir    = tmpDir();
    const index  = new VectorIndex(dir);
    const emb    = new StubEmbedder();
    const vec    = await emb.embed("anything");
    const result = await index.search(vec, 5);
    expect(result).toEqual([]);
  });

  test("size() returns correct count after inserts", async () => {
    const dir  = tmpDir();
    const index = new VectorIndex(dir);
    const emb  = new StubEmbedder();

    await index.add(makeChunk({ sourceId: "S-1" }), await emb.embed("first"));
    await index.add(makeChunk({ sourceId: "S-2" }), await emb.embed("second"));
    expect(await index.size()).toBe(2);
  });

  test("clear() empties the index", async () => {
    const dir   = tmpDir();
    const index = new VectorIndex(dir);
    const emb   = new StubEmbedder();
    const vec   = await emb.embed("test");

    await index.add(makeChunk(), vec);
    await index.clear();
    expect(await index.size()).toBe(0);
  });

  test("topK is respected", async () => {
    const dir  = tmpDir();
    const index = new VectorIndex(dir);
    const emb  = new StubEmbedder();

    for (let i = 0; i < 5; i++) {
      await index.add(makeChunk({ sourceId: `S-${i}` }), await emb.embed(`chunk ${i}`));
    }
    const results = await index.search(await emb.embed("chunk 0"), 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ── KnowledgeStore ────────────────────────────────────────────────────────────

describe("KnowledgeStore", () => {
  test("ingest then retrieve returns relevant chunks", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });

    await store.ingest([
      makeChunk({ sourceId: "S-1", text: "checkout coupon validation" }),
      makeChunk({ sourceId: "S-2", text: "user login authentication flow" }),
    ]);

    const results = await store.retrieve("checkout coupon", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceId).toBeDefined();
  });

  test("retrieve returns [] on empty store", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    const results = await store.retrieve("anything", 5);
    expect(results).toEqual([]);
  });

  test("clear() removes all chunks", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk()]);
    await store.clear();
    expect(await store.size()).toBe(0);
  });

  test("feedback() stub resolves without throwing", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await expect(store.feedback("SCRUM-12", "fail")).resolves.toBeUndefined();
    await expect(store.feedback("SCRUM-12", "pass")).resolves.toBeUndefined();
    await expect(store.feedback("SCRUM-12", "flaky")).resolves.toBeUndefined();
  });
});

// ── NaiveChunker ─────────────────────────────────────────────────────────────

describe("NaiveChunker", () => {
  const chunker = new NaiveChunker();
  const meta = { sourceId: "S-1", sourceName: "jira", type: "story" as const, tags: [] };

  test("short text produces one chunk", () => {
    const chunks = chunker.chunk("Short text under 600 chars", meta);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceId).toBe("S-1");
    expect(chunks[0].confidence).toBe(1.0);
    expect(chunks[0].relations).toEqual([]);
  });

  test("text longer than 600 chars is split into multiple chunks", () => {
    const long   = "a".repeat(5000);
    const chunks = chunker.chunk(long, meta);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  test("empty text returns no chunks", () => {
    expect(chunker.chunk("", meta)).toHaveLength(0);
    expect(chunker.chunk("   ", meta)).toHaveLength(0);
  });

  test("chunk inherits severity and version from metadata", () => {
    const chunks = chunker.chunk("text", { ...meta, severity: "critical", version: "2.4.1" });
    expect(chunks[0].severity).toBe("critical");
    expect(chunks[0].version).toBe("2.4.1");
  });
});

// ── CosineSimilarityReranker ──────────────────────────────────────────────────

describe("CosineSimilarityReranker", () => {
  const reranker = new CosineSimilarityReranker();

  test("sorts candidates by score descending", () => {
    const candidates = [
      { ...makeChunk(), score: 0.5 },
      { ...makeChunk(), score: 0.9 },
      { ...makeChunk(), score: 0.7 },
    ];
    const result = reranker.rerank(candidates);
    expect(result[0].score).toBe(0.9);
    expect(result[1].score).toBe(0.7);
    expect(result[2].score).toBe(0.5);
  });

  test("does not mutate the original array", () => {
    const candidates = [
      { ...makeChunk(), score: 0.3 },
      { ...makeChunk(), score: 0.8 },
    ];
    reranker.rerank(candidates);
    expect(candidates[0].score).toBe(0.3);
  });
});

// ── KnowledgeRetriever ────────────────────────────────────────────────────────

describe("KnowledgeRetriever", () => {
  test("returns [] gracefully when store has no data", async () => {
    const store     = new KnowledgeStore({ indexPath: tmpDir(), embedder: new StubEmbedder() });
    const retriever = new KnowledgeRetriever(store);
    const results   = await retriever.retrieve("checkout");
    expect(results).toEqual([]);
  });

  test("returns results when index has data", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk()]);
    const retriever = new KnowledgeRetriever(store, 3);
    const results   = await retriever.retrieve("coupon checkout");
    expect(results.length).toBeGreaterThan(0);
  });

  test("formatContext returns empty string for no chunks", () => {
    expect(KnowledgeRetriever.formatContext([])).toBe("");
  });

  test("formatContext includes sourceId and text snippet", async () => {
    const chunk   = { ...makeChunk(), score: 0.85 };
    const context = KnowledgeRetriever.formatContext([chunk]);
    expect(context).toContain("SCRUM-12");
    expect(context).toContain("Organisational knowledge context:");
  });
});

// ── HealthScorer ──────────────────────────────────────────────────────────────

describe("HealthScorer", () => {
  const scorer = new HealthScorer();

  test("returns EMPTY when meta is null", () => {
    expect(scorer.score(null).status).toBe("EMPTY");
  });

  test("returns EMPTY when totalChunks is 0", () => {
    expect(scorer.score({ lastIngestedAt: new Date().toISOString(), totalChunks: 0, sources: [] }).status).toBe("EMPTY");
  });

  test("returns GOOD for recent index", () => {
    const meta = { lastIngestedAt: new Date().toISOString(), totalChunks: 100, sources: [{ name: "jira", chunks: 100 }] };
    expect(scorer.score(meta).status).toBe("GOOD");
  });

  test("returns WARN for index older than 14 days", () => {
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const meta = { lastIngestedAt: old, totalChunks: 50, sources: [] };
    expect(scorer.score(meta).status).toBe("WARN");
  });

  test("returns STALE for index older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const meta = { lastIngestedAt: old, totalChunks: 50, sources: [] };
    expect(scorer.score(meta).status).toBe("STALE");
  });

  test("ageDays is null for EMPTY status", () => {
    expect(scorer.score(null).ageDays).toBeNull();
  });

  test("returns STALE with null ageDays for corrupt lastIngestedAt", () => {
    const meta = { lastIngestedAt: "not-a-date", totalChunks: 50, sources: [] };
    const result = scorer.score(meta);
    expect(result.status).toBe("STALE");
    expect(result.ageDays).toBeNull();
  });
});

// ── HybridReranker ────────────────────────────────────────────────────────────

describe("HybridReranker", () => {
  const freshDate = new Date().toISOString();

  function makeRC(overrides: Partial<KnowledgeChunk> & { score: number }) {
    return { ...makeChunk(), ingestedAt: freshDate, ...overrides };
  }

  test("sorts candidates by hybrid score descending", () => {
    const reranker = new HybridReranker();
    const candidates = [
      makeRC({ score: 0.3 }),
      makeRC({ score: 0.9 }),
      makeRC({ score: 0.6 }),
    ];
    const result = reranker.rerank(candidates);
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[1].score).toBeGreaterThan(result[2].score);
  });

  test("does not mutate the original array", () => {
    const reranker = new HybridReranker();
    const candidates = [makeRC({ score: 0.3 }), makeRC({ score: 0.8 })];
    reranker.rerank(candidates);
    expect(candidates[0].score).toBe(0.3);
    expect(candidates[1].score).toBe(0.8);
  });

  test("critical severity scores higher than low severity for identical semantic score", () => {
    const reranker = new HybridReranker();
    const critical = makeRC({ score: 0.7, severity: "critical", ingestedAt: freshDate });
    const low      = makeRC({ score: 0.7, severity: "low",      ingestedAt: freshDate });
    const [first, second] = reranker.rerank([low, critical]);
    expect(first.severity).toBe("critical");
    expect(second.severity).toBe("low");
  });

  test("fresh chunk outscores stale chunk when semantic scores are equal", () => {
    const reranker = new HybridReranker();
    const fresh = makeRC({ score: 0.7, sourceUpdatedAt: freshDate });
    const stale = makeRC({ score: 0.7, sourceUpdatedAt: new Date(Date.now() - 91 * 86400_000).toISOString() });
    const [first] = reranker.rerank([stale, fresh]);
    expect(first.sourceUpdatedAt).toBe(freshDate);
  });

  test("invalid sourceUpdatedAt date contributes 0 to recency score", () => {
    const reranker = new HybridReranker();
    const bad = makeRC({ score: 0.8, sourceUpdatedAt: "not-a-date" });
    const result = reranker.rerank([bad]);
    // Should not throw and score should be within valid hybrid range
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(1);
  });

  test("sourceWeights boost higher-weighted source", () => {
    const reranker = new HybridReranker({ jira: 2.0, confluence: 0.5 });
    const jiraChunk = makeRC({ score: 0.5, sourceName: "jira",       ingestedAt: freshDate });
    const confChunk = makeRC({ score: 0.5, sourceName: "confluence", ingestedAt: freshDate });
    const [first] = reranker.rerank([confChunk, jiraChunk]);
    expect(first.sourceName).toBe("jira");
  });

  test("empty candidates returns empty array", () => {
    expect(new HybridReranker().rerank([])).toEqual([]);
  });
});

// ── ACChunker ─────────────────────────────────────────────────────────────────

describe("ACChunker", () => {
  const chunker = new ACChunker();
  const meta = { sourceId: "S-1", sourceName: "jira", type: "story" as const, tags: [] };

  test("text with AC bullets produces one chunk per bullet", () => {
    const text = "- Coupon is validated before loyalty points\n- Expired coupon shows error\n- Discount is capped at 50%";
    const chunks = chunker.chunk(text, meta);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toBe("Coupon is validated before loyalty points");
    expect(chunks[2].text).toBe("Discount is capped at 50%");
  });

  test("numbered bullets are detected and split", () => {
    const text = "1. User can log in\n2. Invalid password shows error";
    const chunks = chunker.chunk(text, meta);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe("User can log in");
  });

  test("falls back to NaiveChunker for plain prose", () => {
    const prose = "This is a plain paragraph with no bullet points at all.";
    const chunks = chunker.chunk(prose, meta);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(prose);
  });

  test("empty text produces no chunks", () => {
    expect(chunker.chunk("", meta)).toHaveLength(0);
    expect(chunker.chunk("   ", meta)).toHaveLength(0);
  });

  test("chunks inherit metadata fields", () => {
    const text = "- AC bullet one";
    const chunks = chunker.chunk(text, { ...meta, severity: "high", version: "2.0.0", sourceUpdatedAt: "2026-05-01T00:00:00Z" });
    expect(chunks[0].severity).toBe("high");
    expect(chunks[0].version).toBe("2.0.0");
    expect(chunks[0].sourceUpdatedAt).toBe("2026-05-01T00:00:00Z");
  });

  test("• and * bullets are detected", () => {
    const text = "• Accept Google Pay\n* Accept Apple Pay";
    const chunks = chunker.chunk(text, meta);
    expect(chunks).toHaveLength(2);
  });
});

// ── Feedback loop ─────────────────────────────────────────────────────────────

describe("KnowledgeStore.feedback", () => {
  test("pass outcome increases chunk confidence", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    const chunk = makeChunk({ sourceId: "FB-1", confidence: 0.8 });
    await store.ingest([chunk]);

    await store.feedback("FB-1", "pass");

    const results = await store.retrieve("coupon checkout", 5);
    const updated = results.find(r => r.sourceId === "FB-1");
    expect(updated).toBeDefined();
    expect(updated!.confidence).toBeCloseTo(0.85, 5);
  });

  test("fail outcome decreases chunk confidence", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk({ sourceId: "FB-2", confidence: 0.5 })]);

    await store.feedback("FB-2", "fail");

    const results = await store.retrieve("coupon checkout", 5);
    const updated = results.find(r => r.sourceId === "FB-2");
    expect(updated).toBeDefined();
    expect(updated!.confidence).toBeCloseTo(0.40, 5);
  });

  test("flaky outcome decreases chunk confidence by smaller delta", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk({ sourceId: "FB-3", confidence: 0.6 })]);

    await store.feedback("FB-3", "flaky");

    const results = await store.retrieve("coupon checkout", 5);
    const updated = results.find(r => r.sourceId === "FB-3");
    expect(updated).toBeDefined();
    expect(updated!.confidence).toBeCloseTo(0.57, 5);
  });

  test("confidence is clamped to [0, 1]", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk({ sourceId: "FB-4", confidence: 0.02 })]);

    await store.feedback("FB-4", "fail");  // delta = -0.10 → would go negative

    const results = await store.retrieve("coupon checkout", 5);
    const updated = results.find(r => r.sourceId === "FB-4");
    expect(updated).toBeDefined();
    expect(updated!.confidence).toBeGreaterThanOrEqual(0);
  });

  test("feedback on unknown sourceId does not throw", async () => {
    const dir   = tmpDir();
    const store = new KnowledgeStore({ indexPath: dir, embedder: new StubEmbedder() });
    await store.ingest([makeChunk()]);
    await expect(store.feedback("NONEXISTENT", "pass")).resolves.toBeUndefined();
  });
});
