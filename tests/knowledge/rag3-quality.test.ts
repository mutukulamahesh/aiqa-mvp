/**
 * RAG Phase 3 — Quality & Trust
 * Covers: RAG3-01 (defect.category + healer filter),
 *         RAG3-02 (scoreBreakdown),
 *         RAG3-03 (retrieval budget),
 *         RAG3-04 (GraphEnricher + JiraConnector relations)
 */

import { JiraConnector } from "../../src/knowledge/connectors/JiraConnector";
import { HttpTransport as JiraTransport } from "../../src/integrations/JiraClient";
import { HybridReranker }           from "../../src/knowledge/rerankers/HybridReranker";
import { CosineSimilarityReranker } from "../../src/knowledge/rerankers/CosineSimilarityReranker";
import { KnowledgeRetriever }       from "../../src/knowledge/KnowledgeRetriever";
import { GraphEnricher }            from "../../src/knowledge/GraphEnricher";
import { NaiveChunker }             from "../../src/knowledge/chunkers/NaiveChunker";
import { ACChunker }                from "../../src/knowledge/chunkers/ACChunker";
import { KnowledgeChunk, RetrievedChunk, RetrievalBudget } from "../../src/knowledge/types";
import * as http from "http";
import * as stream from "stream";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    text:       "Login button fails when session expires",
    sourceId:   "SCRUM-1",
    sourceName: "jira",
    type:       "defect",
    tags:       [],
    confidence: 1.0,
    relations:  [],
    ingestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRetrieved(overrides: Partial<KnowledgeChunk> = {}, score = 0.8): RetrievedChunk {
  return { ...makeChunk(overrides), score };
}

/** Fake Jira HTTP transport returning a single page of issues. */
function fakeJiraTransport(issues: object[]): JiraTransport {
  const payload = { issues, total: issues.length };
  return (_opts: http.RequestOptions, cb?: (r: http.IncomingMessage) => void) => {
    const body    = JSON.stringify(payload);
    const readable = new stream.Readable({ read() { this.push(body); this.push(null); } });
    const res      = Object.assign(readable, { statusCode: 200, headers: {} }) as unknown as http.IncomingMessage;
    if (cb) setImmediate(() => cb(res));
    return { setTimeout: () => {}, on: () => {}, end: () => {}, destroy: () => {} } as unknown as http.ClientRequest;
  };
}

function makeJiraIssue(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary:     overrides.summary     ?? "Default summary",
      description: overrides.description ?? null,
      issuetype:   { name: overrides.issuetype ?? "Bug" },
      priority:    { name: overrides.priority  ?? "Medium" },
      labels:      overrides.labels      ?? [],
      fixVersions: overrides.fixVersions ?? [],
      updated:     overrides.updated     ?? "2026-01-01T00:00:00.000Z",
      issuelinks:  overrides.issuelinks  ?? [],
      ...overrides.extraFields as object ?? {},
    },
  };
}

// ── KnowledgeStore stub for retrieval tests ───────────────────────────────────

class StubStore {
  private chunks: KnowledgeChunk[];
  constructor(chunks: KnowledgeChunk[]) { this.chunks = chunks; }
  async retrieve(_query: string, topK: number): Promise<RetrievedChunk[]> {
    return this.chunks.slice(0, topK).map((c, i) => ({ ...c, score: 1 - i * 0.1 }));
  }
  async listAll(): Promise<KnowledgeChunk[]> { return this.chunks; }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG3-01: defect.category inference + chunker pass-through
// ─────────────────────────────────────────────────────────────────────────────

describe("RAG3-01: defect.category inference", () => {
  function makeConnector(issues: object[]) {
    return new JiraConnector({
      baseUrl: "https://test.atlassian.net",
      email:   "test@test.com",
      apiToken: "tok",
      projectKey: "SCRUM",
      transport: fakeJiraTransport(issues),
    });
  }

  test("infers ui from CSS/selector keywords in summary", async () => {
    const conn = makeConnector([
      makeJiraIssue("SCRUM-1", { summary: "Button click fails because selector is wrong" }),
    ]);
    const chunks = await conn.fetch();
    const defects = chunks.filter(c => c.type === "defect");
    expect(defects.length).toBeGreaterThan(0);
    expect(defects[0].category).toBe("ui");
  });

  test("infers regression from regression keywords in summary", async () => {
    const conn = makeConnector([
      makeJiraIssue("SCRUM-2", { summary: "Payment broken — regression after deploy" }),
    ]);
    const chunks = await conn.fetch();
    const defects = chunks.filter(c => c.type === "defect");
    expect(defects[0].category).toBe("regression");
  });

  test("regression takes precedence over ui when both match", async () => {
    const conn = makeConnector([
      makeJiraIssue("SCRUM-3", { summary: "Button selector broke after upgrade regression" }),
    ]);
    const chunks = await conn.fetch();
    expect(chunks.filter(c => c.type === "defect")[0].category).toBe("regression");
  });

  test("falls back to functional for generic defect", async () => {
    const conn = makeConnector([
      makeJiraIssue("SCRUM-4", { summary: "Order total calculation is wrong" }),
    ]);
    const chunks = await conn.fetch();
    expect(chunks.filter(c => c.type === "defect")[0].category).toBe("functional");
  });

  test("category inferred from labels when summary is neutral", async () => {
    const conn = makeConnector([
      makeJiraIssue("SCRUM-5", {
        summary: "Generic failure",
        labels:  ["css", "layout"],
      }),
    ]);
    const chunks = await conn.fetch();
    expect(chunks.filter(c => c.type === "defect")[0].category).toBe("ui");
  });

  test("stories never get category", async () => {
    const storyIssue = { ...makeJiraIssue("SCRUM-6", { summary: "As a user I can log in" }), fields: { ...makeJiraIssue("SCRUM-6").fields, issuetype: { name: "Story" } } };
    // Use a connector that fetches stories — reuse the shared helper
    const transport = fakeJiraTransport([storyIssue]);
    const conn = new JiraConnector({ baseUrl: "https://test.atlassian.net", email: "a@b.com", apiToken: "tok", projectKey: "SCRUM", transport });
    const chunks = await conn.fetch();
    const stories = chunks.filter(c => c.type === "story");
    expect(stories.every(s => s.category === undefined)).toBe(true);
  });

  test("NaiveChunker passes category through from metadata", () => {
    const chunker = new NaiveChunker();
    const chunks  = chunker.chunk("Some defect text", {
      sourceId: "X-1", sourceName: "jira", type: "defect",
      category: "ui", tags: [], relations: [],
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].category).toBe("ui");
  });

  test("ACChunker passes category through for bullet chunks", () => {
    const chunker = new ACChunker();
    const chunks  = chunker.chunk("- Login button must be visible\n- Click must navigate", {
      sourceId: "X-2", sourceName: "jira", type: "story",
      category: undefined, tags: [], relations: [],
    });
    // All bullet chunks should pass through undefined category
    expect(chunks.every(c => c.category === undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RAG3-02: scoreBreakdown attached by rerankers
// ─────────────────────────────────────────────────────────────────────────────

describe("RAG3-02: scoreBreakdown", () => {
  const weights = { strategy: "hybrid" as const, semanticWeight: 0.6, recencyWeight: 0.2, severityWeight: 0.1, sourceWeight: 0.1 };

  test("HybridReranker attaches scoreBreakdown to every chunk", () => {
    const reranker = new HybridReranker(weights, {});
    const input    = [makeRetrieved({ severity: "high", sourceName: "jira" }, 0.8)];
    const result   = reranker.rerank(input);
    expect(result[0].scoreBreakdown).toBeDefined();
    const bd = result[0].scoreBreakdown!;
    expect(bd.semantic).toBeGreaterThan(0);
    expect(typeof bd.recency).toBe("number");
    expect(typeof bd.severity).toBe("number");
    expect(typeof bd.sourceWeight).toBe("number");
    expect(bd.connectorId).toBe("jira");
  });

  test("HybridReranker breakdown scores are clamped to [0, 1]", () => {
    const reranker = new HybridReranker(weights, {});
    const input    = [makeRetrieved({ score: 99 } as Partial<KnowledgeChunk>, 99)];
    const result   = reranker.rerank(input);
    const bd       = result[0].scoreBreakdown!;
    expect(bd.semantic).toBeLessThanOrEqual(1);
    expect(result[0].score).toBeLessThanOrEqual(1);
  });

  test("CosineSimilarityReranker attaches scoreBreakdown", () => {
    const reranker = new CosineSimilarityReranker();
    const input    = [makeRetrieved({}, 0.7)];
    const result   = reranker.rerank(input);
    expect(result[0].scoreBreakdown).toBeDefined();
    const bd = result[0].scoreBreakdown!;
    expect(bd.semantic).toBeCloseTo(0.7, 2);
    expect(bd.recency).toBe(0);
    expect(bd.severity).toBe(0);
    expect(bd.sourceWeight).toBe(0);
  });

  test("scoreBreakdown connectorId matches sourceName", () => {
    const reranker = new CosineSimilarityReranker();
    const result   = reranker.rerank([makeRetrieved({ sourceName: "confluence" }, 0.5)]);
    expect(result[0].scoreBreakdown!.connectorId).toBe("confluence");
  });

  test("KnowledgeRetriever.formatContext includes scoreBreakdown", () => {
    const chunk = makeRetrieved({}, 0.75);
    chunk.scoreBreakdown = { semantic: 0.75, recency: 0.2, severity: 0.5, sourceWeight: 1.0, connectorId: "jira" };
    const ctx = KnowledgeRetriever.formatContext([chunk]);
    expect(ctx).toContain("sem=0.75");
    expect(ctx).toContain("rec=0.20");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RAG3-03: retrieval budget enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("RAG3-03: retrieval budget", () => {
  function makeStore(count: number, textLength = 100) {
    const chunks = Array.from({ length: count }, (_, i) =>
      makeChunk({ sourceId: `SRC-${i}`, text: "x".repeat(textLength) })
    );
    return new StubStore(chunks) as unknown as import("../../src/knowledge/KnowledgeStore").KnowledgeStore;
  }

  test("maxChunks hard cap limits results", async () => {
    const budget: RetrievalBudget = { maxChunks: 3, maxTokensApprox: 100000 };
    const retriever = new KnowledgeRetriever(makeStore(10), 10, budget);
    const results   = await retriever.retrieve("query");
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("topK is respected even without budget", async () => {
    const retriever = new KnowledgeRetriever(makeStore(10), 4);
    const results   = await retriever.retrieve("query");
    expect(results.length).toBeLessThanOrEqual(4);
  });

  test("maxTokensApprox trims lowest-score chunks", async () => {
    // Each chunk is 200 chars → ~50 tokens (4 chars/token for defect type)
    // Budget 100 tokens → max 2 chunks
    const budget: RetrievalBudget = { maxChunks: 20, maxTokensApprox: 100 };
    const retriever = new KnowledgeRetriever(makeStore(10, 200), 10, budget);
    const results   = await retriever.retrieve("query");
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("never trims below 1 chunk regardless of token budget", async () => {
    const budget: RetrievalBudget = { maxChunks: 20, maxTokensApprox: 1 };
    const retriever = new KnowledgeRetriever(makeStore(5, 5000), 5, budget);
    const results   = await retriever.retrieve("query");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("budget undefined — no trimming beyond topK", async () => {
    const retriever = new KnowledgeRetriever(makeStore(10), 7);
    const results   = await retriever.retrieve("query");
    expect(results.length).toBe(7);
  });

  test("retrieve(query, topK) override respected", async () => {
    const budget: RetrievalBudget = { maxChunks: 20, maxTokensApprox: 100000 };
    const retriever = new KnowledgeRetriever(makeStore(10), 10, budget);
    const results   = await retriever.retrieve("query", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RAG3-04: GraphEnricher + JiraConnector relations
// ─────────────────────────────────────────────────────────────────────────────

describe("RAG3-04: GraphEnricher", () => {
  function makeStoreWithChunks(chunks: KnowledgeChunk[]) {
    return new StubStore(chunks) as unknown as import("../../src/knowledge/KnowledgeStore").KnowledgeStore;
  }

  test("returns original chunks when no relations present", async () => {
    const chunks  = [makeChunk({ sourceId: "A-1", relations: [] })];
    const store   = makeStoreWithChunks(chunks);
    const enricher = new GraphEnricher(store);
    const result   = await enricher.enrich([{ ...chunks[0], score: 0.9 }]);
    expect(result.length).toBe(1);
    expect(result[0].sourceId).toBe("A-1");
  });

  test("follows one-hop relation and appends related chunk", async () => {
    const story  = makeChunk({ sourceId: "SCRUM-10", type: "story", relations: [{ type: "relates_to_defect", targetId: "SCRUM-11" }] });
    const defect = makeChunk({ sourceId: "SCRUM-11", type: "defect", relations: [] });
    const store  = makeStoreWithChunks([story, defect]);
    const enricher = new GraphEnricher(store);
    const result   = await enricher.enrich([{ ...story, score: 0.9 }]);
    expect(result.length).toBe(2);
    const expanded = result.find(c => c.sourceId === "SCRUM-11");
    expect(expanded).toBeDefined();
    expect(expanded!.score).toBeCloseTo(0.72, 2); // 0.9 * 0.8
  });

  test("graph-expanded chunks have lower score than originator", async () => {
    const a = makeChunk({ sourceId: "A", relations: [{ type: "r", targetId: "B" }] });
    const b = makeChunk({ sourceId: "B", relations: [] });
    const enricher = new GraphEnricher(makeStoreWithChunks([a, b]));
    const [orig, hop] = await enricher.enrich([{ ...a, score: 1.0 }]);
    expect(orig.score).toBeGreaterThan(hop.score);
  });

  test("deduplicates: directly retrieved chunk wins over graph-expanded copy", async () => {
    const a = makeChunk({ sourceId: "A", relations: [{ type: "r", targetId: "B" }] });
    const b = makeChunk({ sourceId: "B", relations: [] });
    const enricher = new GraphEnricher(makeStoreWithChunks([a, b]));
    // Both A and B directly retrieved
    const result = await enricher.enrich([
      { ...a, score: 0.9 },
      { ...b, score: 0.7 },
    ]);
    const bEntries = result.filter(c => c.sourceId === "B");
    expect(bEntries.length).toBe(1);
    expect(bEntries[0].score).toBe(0.7); // direct score preserved
  });

  test("relation to unknown sourceId is silently skipped", async () => {
    const a = makeChunk({ sourceId: "A", relations: [{ type: "r", targetId: "NONEXISTENT" }] });
    const enricher = new GraphEnricher(makeStoreWithChunks([a]));
    const result   = await enricher.enrich([{ ...a, score: 0.8 }]);
    expect(result.length).toBe(1); // no expansion
  });

  test("maxHops=0 disables graph expansion entirely", async () => {
    const a = makeChunk({ sourceId: "A", relations: [{ type: "r", targetId: "B" }] });
    const b = makeChunk({ sourceId: "B", relations: [] });
    const enricher = new GraphEnricher(makeStoreWithChunks([a, b]));
    const result   = await enricher.enrich([{ ...a, score: 0.9 }], 0);
    expect(result.length).toBe(1);
  });

  test("direct chunks preserve original order in output", async () => {
    const a = makeChunk({ sourceId: "A", relations: [] });
    const b = makeChunk({ sourceId: "B", relations: [] });
    const c = makeChunk({ sourceId: "C", relations: [] });
    const enricher = new GraphEnricher(makeStoreWithChunks([a, b, c]));
    const input    = [{ ...a, score: 0.9 }, { ...b, score: 0.7 }, { ...c, score: 0.5 }];
    const result   = await enricher.enrich(input);
    expect(result.map(r => r.sourceId)).toEqual(["A", "B", "C"]);
  });
});

describe("RAG3-04: JiraConnector relations from issuelinks", () => {
  function makeConnectorWithTransport(transport: JiraTransport) {
    return new JiraConnector({
      baseUrl: "https://test.atlassian.net",
      email: "a@b.com", apiToken: "tok",
      projectKey: "SCRUM", transport,
    });
  }

  test("populates relations from issuelinks on defect", async () => {
    const issue = makeJiraIssue("SCRUM-2", {
      summary: "Button broken",
      issuelinks: [{ inwardIssue: { key: "SCRUM-1" } }],
    });
    const conn   = makeConnectorWithTransport(fakeJiraTransport([issue]));
    const chunks = await conn.fetch();
    const defect = chunks.find(c => c.type === "defect");
    expect(defect).toBeDefined();
    expect(defect!.relations.length).toBeGreaterThan(0);
    expect(defect!.relations[0].targetId).toBe("SCRUM-1");
    expect(defect!.relations[0].type).toBe("relates_to_story");
  });

  test("uses outwardIssue when inwardIssue absent", async () => {
    const issue = makeJiraIssue("SCRUM-3", {
      summary: "Input label missing",
      issuelinks: [{ outwardIssue: { key: "SCRUM-10" } }],
    });
    const conn   = makeConnectorWithTransport(fakeJiraTransport([issue]));
    const chunks = await conn.fetch();
    const defect = chunks.find(c => c.type === "defect");
    expect(defect!.relations[0].targetId).toBe("SCRUM-10");
  });

  test("empty issuelinks yields empty relations", async () => {
    const issue = makeJiraIssue("SCRUM-4", { summary: "No relations defect", issuelinks: [] });
    const conn  = makeConnectorWithTransport(fakeJiraTransport([issue]));
    const chunks = await conn.fetch();
    expect(chunks.every(c => c.relations.length === 0)).toBe(true);
  });

  test("NaiveChunker passes relations through to all produced chunks", () => {
    const chunker = new NaiveChunker();
    const rels    = [{ type: "relates_to_defect", targetId: "SCRUM-99" }];
    const text    = "x".repeat(1200); // force 2 chunks
    const chunks  = chunker.chunk(text, {
      sourceId: "SCRUM-5", sourceName: "jira", type: "story", tags: [], relations: rels,
    });
    expect(chunks.length).toBe(2);
    expect(chunks[0].relations).toEqual(rels);
    expect(chunks[1].relations).toEqual(rels);
  });
});
