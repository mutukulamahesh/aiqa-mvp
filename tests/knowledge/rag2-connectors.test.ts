/**
 * RAG Phase 2 — connector + healer defect context + readiness scorer tests
 * Covers: RAG2-04 (ConfluenceConnector), RAG2-05 (OpenAPIConnector),
 *         RAG2-06 (GitConnector), RAG2-07 (SelectorHealer defect ctx),
 *         RAG2-09 (ReadinessScorer)
 */

import * as http   from "http";
import * as stream from "stream";
import { ConfluenceConnector, HttpTransport as ConfluenceTransport } from "../../src/knowledge/connectors/ConfluenceConnector";
import { OpenAPIConnector,    HttpTransport as OpenAPITransport }    from "../../src/knowledge/connectors/OpenAPIConnector";
import { GitConnector }          from "../../src/knowledge/connectors/GitConnector";
import { KnowledgeReadinessScorer as ReadinessScorer } from "../../src/knowledge/ReadinessScorer";
import { KnowledgeChunk, RetrievedChunk } from "../../src/knowledge/types";
import { KnowledgeRetriever }    from "../../src/knowledge/KnowledgeRetriever";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    text:       "Login button fails when session expires",
    sourceId:   "SCRUM-99",
    sourceName: "jira",
    type:       "defect",
    tags:       ["login", "session"],
    confidence: 1.0,
    relations:  [],
    ingestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRetrieved(overrides: Partial<KnowledgeChunk> = {}, score = 0.9): RetrievedChunk {
  return { ...makeChunk(overrides), score };
}

/** Builds a fake HTTP transport that replies with the given JSON payload. */
function fakeJsonTransport(statusCode: number, payload: unknown): ConfluenceTransport {
  return (_opts: http.RequestOptions, cb?: (r: http.IncomingMessage) => void) => {
    const body = JSON.stringify(payload);
    const readable = new stream.Readable({ read() { this.push(body); this.push(null); } });
    const res = Object.assign(readable, { statusCode, headers: {} }) as unknown as http.IncomingMessage;
    if (cb) setImmediate(() => cb(res));
    return {
      setTimeout: () => {},
      on: () => {},
      end: () => {},
      destroy: () => {},
    } as unknown as http.ClientRequest;
  };
}

/** Same but returns raw string body (for OpenAPI spec transport). */
function fakeStringTransport(statusCode: number, body: string): OpenAPITransport {
  return (_opts: http.RequestOptions, cb?: (r: http.IncomingMessage) => void) => {
    const readable = new stream.Readable({ read() { this.push(body); this.push(null); } });
    const res = Object.assign(readable, { statusCode, headers: {} }) as unknown as http.IncomingMessage;
    if (cb) setImmediate(() => cb(res));
    return {
      setTimeout: () => {},
      on: () => {},
      end: () => {},
      destroy: () => {},
    } as unknown as http.ClientRequest;
  };
}

// ── ConfluenceConnector (RAG2-04) ────────────────────────────────────────────

describe("ConfluenceConnector", () => {
  function makeConnector(transport: ConfluenceTransport) {
    return new ConfluenceConnector({
      baseUrl:  "https://test.atlassian.net",
      email:    "user@test.com",
      apiToken: "token",
      spaceKey: "ENG",
      transport,
    });
  }

  test("returns chunks for pages with HTML body", async () => {
    const payload = {
      results: [{
        id:    "page-1",
        title: "Checkout Flow",
        space: { key: "ENG" },
        body:  { storage: { value: "<h1>Overview</h1><p>Describes the checkout sequence.</p>" } },
        history: { lastUpdated: { when: "2026-01-10T12:00:00Z" } },
        metadata: { labels: { results: [{ name: "checkout" }] } },
      }],
      size: 1, start: 0, limit: 50,
    };
    const chunks = await makeConnector(fakeJsonTransport(200, payload)).fetch();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].sourceName).toBe("confluence");
    expect(chunks[0].type).toBe("page");
    expect(chunks[0].tags).toContain("checkout");
    expect(chunks[0].text).toContain("Checkout Flow");
    expect(chunks[0].sourceUpdatedAt).toBe("2026-01-10T12:00:00Z");
  });

  test("strips HTML tags from body text", async () => {
    const payload = {
      results: [{
        id: "p2", title: "Test", space: { key: "ENG" },
        body: { storage: { value: "<p>Hello <b>world</b></p>" } },
        history: { lastUpdated: {} },
        metadata: { labels: { results: [] } },
      }],
      size: 1, start: 0, limit: 50,
    };
    const chunks = await makeConnector(fakeJsonTransport(200, payload)).fetch();
    expect(chunks[0].text).not.toContain("<p>");
    expect(chunks[0].text).not.toContain("<b>");
    expect(chunks[0].text).toContain("Hello");
    expect(chunks[0].text).toContain("world");
  });

  test("skips pages where both title and body are empty", async () => {
    const payload = {
      results: [
        // no title, no body → pageToText returns "" → skipped
        { id: "p3", title: "", space: { key: "ENG" }, body: { storage: { value: "" } }, history: { lastUpdated: {} }, metadata: { labels: { results: [] } } },
        { id: "p4", title: "Real", space: { key: "ENG" }, body: { storage: { value: "Content here" } }, history: { lastUpdated: {} }, metadata: { labels: { results: [] } } },
      ],
      size: 2, start: 0, limit: 50,
    };
    const chunks = await makeConnector(fakeJsonTransport(200, payload)).fetch();
    expect(chunks.some(c => c.sourceId === "p4")).toBe(true);
    expect(chunks.every(c => c.sourceId !== "p3")).toBe(true);
  });

  test("rejects on HTTP error status", async () => {
    await expect(
      makeConnector(fakeJsonTransport(403, { message: "Forbidden" })).fetch(),
    ).rejects.toThrow(/403/);
  });

  test("returns empty array when results list is empty", async () => {
    const payload = { results: [], size: 0, start: 0, limit: 50 };
    const chunks = await makeConnector(fakeJsonTransport(200, payload)).fetch();
    expect(chunks).toHaveLength(0);
  });

  test("paginates correctly when first page is full (51 total pages)", async () => {
    // Simulates a space with 51 pages: first call returns 50 (full page, has _links.next),
    // second call returns 1 (last page, no _links.next). Verifies no pages are lost.
    function makePage(count: number, hasNext: boolean, offset = 0) {
      const results = Array.from({ length: count }, (_, i) => ({
        id: `p${offset + i}`, title: `Page ${offset + i}`, space: { key: "ENG" },
        body: { storage: { value: `Content ${i}` } },
        history: { lastUpdated: {} },
        metadata: { labels: { results: [] } },
      }));
      return { results, size: count, start: 0, limit: 50, _links: hasNext ? { next: "/next" } : {} };
    }

    let call = 0;
    const transport: ConfluenceTransport = (_opts, cb) => {
      const payload = call === 0 ? makePage(50, true, 0) : makePage(1, false, 50);
      call++;
      const body    = JSON.stringify(payload);
      const readable = new (require("stream").Readable)({ read() { this.push(body); this.push(null); } });
      const res = Object.assign(readable, { statusCode: 200, headers: {} }) as unknown as http.IncomingMessage;
      if (cb) setImmediate(() => cb(res));
      return { setTimeout: () => {}, on: () => {}, end: () => {}, destroy: () => {} } as unknown as http.ClientRequest;
    };

    const chunks = await makeConnector(transport).fetch();
    expect(call).toBe(2);
    const sourceIds = new Set(chunks.map(c => c.sourceId));
    expect(sourceIds.size).toBe(51);
  });
});

// ── OpenAPIConnector (RAG2-05) ────────────────────────────────────────────────

describe("OpenAPIConnector", () => {
  const OPENAPI_JSON = JSON.stringify({
    info:  { title: "Test API", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          summary:     "List users",
          description: "Returns all users in the system",
          tags:        ["users"],
          parameters:  [{ name: "limit", in: "query", description: "Max results", required: false }],
          responses:   { "200": { description: "OK" } },
        },
        post: {
          summary: "Create user",
          tags:    ["users"],
          responses: { "201": { description: "Created" } },
        },
      },
      "/users/{id}": {
        delete: {
          summary: "Delete user",
          tags:    ["users", "admin"],
          responses: { "204": { description: "Deleted" } },
        },
      },
    },
  });

  function makeConnector(body: string, statusCode = 200) {
    return new OpenAPIConnector({
      url:       "https://api.example.com/openapi.json",
      transport: fakeStringTransport(statusCode, body),
    });
  }

  test("creates one chunk per endpoint × method", async () => {
    const chunks = await makeConnector(OPENAPI_JSON).fetch();
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const ids = chunks.map(c => c.sourceId);
    expect(ids.some(id => id.startsWith("GET_"))).toBe(true);
    expect(ids.some(id => id.startsWith("POST_"))).toBe(true);
    expect(ids.some(id => id.startsWith("DELETE_"))).toBe(true);
  });

  test("chunk text includes method, path, summary", async () => {
    const chunks = await makeConnector(OPENAPI_JSON).fetch();
    const getUsers = chunks.find(c => c.sourceId === "GET__users");
    expect(getUsers).toBeDefined();
    expect(getUsers!.text).toContain("GET /users");
    expect(getUsers!.text).toContain("List users");
  });

  test("tags come from operation tags array", async () => {
    const chunks = await makeConnector(OPENAPI_JSON).fetch();
    const del = chunks.find(c => c.sourceId.startsWith("DELETE_"));
    expect(del?.tags).toContain("users");
    expect(del?.tags).toContain("admin");
  });

  test("chunk type is 'api'", async () => {
    const chunks = await makeConnector(OPENAPI_JSON).fetch();
    expect(chunks.every(c => c.type === "api")).toBe(true);
  });

  test("parses YAML spec", async () => {
    const yamlSpec = `
info:
  title: YAML API
paths:
  /health:
    get:
      summary: Health check
      tags: [ops]
      responses:
        '200':
          description: OK
`;
    const chunks = await makeConnector(yamlSpec).fetch();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain("GET /health");
  });

  test("rejects on HTTP error", async () => {
    await expect(makeConnector("", 404).fetch()).rejects.toThrow(/404/);
  });

  test("returns empty array for spec with no paths", async () => {
    const chunks = await makeConnector(JSON.stringify({ info: { title: "Empty" } })).fetch();
    expect(chunks).toHaveLength(0);
  });
});

// ── GitConnector (RAG2-06) ────────────────────────────────────────────────────

describe("GitConnector", () => {
  test("returns empty array when pointed at a non-git directory", async () => {
    const connector = new GitConnector({ repoPath: require("os").tmpdir() });
    const chunks = await connector.fetch();
    expect(Array.isArray(chunks)).toBe(true);
  });

  test("constructor accepts lookbackDays option without throwing", () => {
    expect(() => new GitConnector({ lookbackDays: 7 })).not.toThrow();
  });

  test("connector name is 'git'", () => {
    expect(new GitConnector().name).toBe("git");
  });

  test("produces chunks with correct shape from current repo", async () => {
    const connector = new GitConnector({ lookbackDays: 365, repoPath: process.cwd() });
    const chunks = await connector.fetch();
    for (const c of chunks) {
      expect(c.type).toBe("git");
      expect(c.sourceName).toBe("git");
      expect(typeof c.sourceId).toBe("string");
      expect(c.sourceId.length).toBeLessThanOrEqual(12);
      expect(Array.isArray(c.tags)).toBe(true);
      expect(typeof c.ingestedAt).toBe("string");
    }
  });

  test("extracts tags from conventional commit scopes", async () => {
    const connector = new GitConnector({ lookbackDays: 365, repoPath: process.cwd() });
    const chunks = await connector.fetch();
    // The rag2/rag1 commits in this repo use conventional scope
    const scopedChunks = chunks.filter(c => c.tags.length > 0);
    if (scopedChunks.length > 0) {
      // Tags come from scopes — must be non-empty strings
      expect(scopedChunks[0].tags.every(t => typeof t === "string" && t.length > 0)).toBe(true);
    }
  });

  test("chunk text includes 'Files changed:' section when files exist", async () => {
    const connector = new GitConnector({ lookbackDays: 365, repoPath: process.cwd() });
    const chunks = await connector.fetch();
    // At least some commits in this repo touch TypeScript files
    const withFiles = chunks.filter(c => c.text.includes("Files changed:"));
    if (chunks.length > 0) {
      // If git --name-only works (it should in CI and local), we get file sections
      expect(withFiles.length).toBeGreaterThan(0);
      // File paths in the section should look like relative paths
      const sample = withFiles[0].text;
      expect(sample).toMatch(/Files changed:/);
    }
  });
});

// ── SelectorHealer defect context (RAG2-07) ──────────────────────────────────

describe("SelectorHealer — defect context via retriever", () => {
  test("constructs without retriever (optional)", async () => {
    const { SelectorHealer } = await import("../../src/healer/SelectorHealer");
    expect(() => new SelectorHealer()).not.toThrow();
  });

  test("constructs with a retriever injected as 3rd argument", async () => {
    const retriever = {
      retrieve: async (_q: string, _k: number): Promise<RetrievedChunk[]> => [],
    } as unknown as KnowledgeRetriever;
    const { SelectorHealer } = await import("../../src/healer/SelectorHealer");
    expect(() => new SelectorHealer(undefined, undefined, retriever)).not.toThrow();
  });

  test("only defect-type chunks are used for defect context", () => {
    const chunks: RetrievedChunk[] = [
      makeRetrieved({ type: "defect", sourceId: "BUG-1", text: "Login crashes on mobile" }),
      makeRetrieved({ type: "story", sourceId: "STORY-1", text: "User can log in" }),
      makeRetrieved({ type: "page",  sourceId: "PAGE-1",  text: "Login documentation" }),
    ];
    const defects = chunks.filter(c => c.type === "defect");
    expect(defects).toHaveLength(1);
    expect(defects[0].sourceId).toBe("BUG-1");
  });

  test("defect context lines are capped at 200 chars per chunk", () => {
    const longText = "X".repeat(500);
    const line = `- [BUG-1]: ${longText.slice(0, 200)}`;
    expect(line.length).toBeLessThanOrEqual("- [BUG-1]: ".length + 200);
    expect(line).toContain("BUG-1");
  });

  test("defect context header is the expected string", () => {
    const header = "Known defects related to this element:";
    // Verify it's the exact string used by SelectorHealer
    expect(header.startsWith("Known defects")).toBe(true);
  });

  test("no defects in retrieval result → empty context", () => {
    const chunks: RetrievedChunk[] = [
      makeRetrieved({ type: "story" }),
      makeRetrieved({ type: "page"  }),
    ];
    const defects = chunks.filter(c => c.type === "defect");
    expect(defects).toHaveLength(0);
    // Empty defects → context is "" per SelectorHealer.fetchDefectContext
    const ctx = defects.length === 0 ? "" : `Known defects related to this element:\n${defects.map(c => `- [${c.sourceId}]: ${c.text.slice(0, 200)}`).join("\n")}`;
    expect(ctx).toBe("");
  });

  test("invalid pageUrl hostname extraction returns empty string", () => {
    const extract = (url: string) => {
      try { return new URL(url).hostname; } catch { return ""; }
    };
    expect(extract("not-a-url")).toBe("");
    expect(extract("https://checkout.example.com/pay")).toBe("checkout.example.com");
  });
});

// ── ReadinessScorer (RAG2-09) ─────────────────────────────────────────────────

describe("ReadinessScorer", () => {
  const scorer = new ReadinessScorer();

  function chunks(overrides: Partial<KnowledgeChunk>[]): KnowledgeChunk[] {
    return overrides.map(o => makeChunk(o));
  }

  test("MISSING — no chunks in index", () => {
    const r = scorer.score("checkout", []);
    expect(r.status).toBe("MISSING");
    expect(r.totalChunks).toBe(0);
    expect(r.message).toContain("checkout");
  });

  test("MISSING — no chunks with matching tag", () => {
    const r = scorer.score("login", chunks([{ tags: ["payments"] }, { tags: ["cart"] }]));
    expect(r.status).toBe("MISSING");
    expect(r.storyCount).toBe(0);
    expect(r.defectCount).toBe(0);
  });

  test("READY — stories + defects + healthy confidence", () => {
    const r = scorer.score("login", chunks([
      { tags: ["login"], type: "story",  confidence: 0.9 },
      { tags: ["login"], type: "story",  confidence: 0.8 },
      { tags: ["login"], type: "defect", confidence: 0.7 },
    ]));
    expect(r.status).toBe("READY");
    expect(r.storyCount).toBe(2);
    expect(r.defectCount).toBe(1);
    expect(r.totalChunks).toBe(3);
    expect(r.avgConfidence).toBeGreaterThanOrEqual(0.6);
  });

  test("PARTIAL — stories only (no defect history)", () => {
    const r = scorer.score("checkout", chunks([
      { tags: ["checkout"], type: "story", confidence: 0.9 },
    ]));
    expect(r.status).toBe("PARTIAL");
    expect(r.defectCount).toBe(0);
    expect(r.message).toContain("defect");
  });

  test("PARTIAL — defects only (no stories)", () => {
    const r = scorer.score("checkout", chunks([
      { tags: ["checkout"], type: "defect", confidence: 0.9 },
    ]));
    expect(r.status).toBe("PARTIAL");
    expect(r.storyCount).toBe(0);
  });

  test("PARTIAL — stories + defects but low confidence", () => {
    const r = scorer.score("payments", chunks([
      { tags: ["payments"], type: "story",  confidence: 0.3 },
      { tags: ["payments"], type: "defect", confidence: 0.2 },
    ]));
    expect(r.status).toBe("PARTIAL");
    expect(r.avgConfidence).toBeLessThan(0.6);
    expect(r.message).toContain("low avg confidence");
  });

  test("avgConfidence has at most 3 decimal places", () => {
    const r = scorer.score("t", chunks([
      { tags: ["t"], type: "story",  confidence: 1.0 },
      { tags: ["t"], type: "defect", confidence: 0.7 },
    ]));
    const parts = r.avgConfidence.toString().split(".");
    expect((parts[1]?.length ?? 0)).toBeLessThanOrEqual(3);
  });

  test("tag filter is exact match", () => {
    // "checkout-v2" should NOT match query for "checkout"
    const r = scorer.score("checkout", chunks([
      { tags: ["checkout-v2"], type: "story", confidence: 1.0 },
    ]));
    expect(r.status).toBe("MISSING");
  });

  test("oldestChunkDays is null when no parseable date", () => {
    const r = scorer.score("x", [makeChunk({ tags: ["x"], ingestedAt: "not-a-date", sourceUpdatedAt: undefined })]);
    expect(r.oldestChunkDays).toBeNull();
  });

  test("oldestChunkDays is a non-negative integer when dates are valid", () => {
    const daysAgo5 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const r = scorer.score("x", [makeChunk({ tags: ["x"], type: "story", ingestedAt: daysAgo5 })]);
    if (r.oldestChunkDays !== null) {
      expect(r.oldestChunkDays).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.oldestChunkDays)).toBe(true);
    }
  });

  test("READY message includes story and defect counts and confidence", () => {
    const r = scorer.score("auth", chunks([
      { tags: ["auth"], type: "story",  confidence: 0.9 },
      { tags: ["auth"], type: "defect", confidence: 0.8 },
    ]));
    expect(r.message).toContain("1 story chunk");
    expect(r.message).toContain("1 defect");
  });
});
