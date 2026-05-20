import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { StubEmbedder }             from "../../src/knowledge/Embedder";
import { VectorIndex }              from "../../src/knowledge/VectorIndex";
import { KnowledgeStore }           from "../../src/knowledge/KnowledgeStore";
import { KnowledgeRetriever }       from "../../src/knowledge/KnowledgeRetriever";
import { NaiveChunker }             from "../../src/knowledge/chunkers/NaiveChunker";
import { CosineSimilarityReranker } from "../../src/knowledge/rerankers/CosineSimilarityReranker";
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
