import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { StubEmbedder }       from "../../src/knowledge/Embedder";
import { KnowledgeStore }     from "../../src/knowledge/KnowledgeStore";
import { KnowledgeIngester }  from "../../src/knowledge/KnowledgeIngester";
import { KnowledgeConnector } from "../../src/knowledge/connectors/KnowledgeConnector";
import { JiraConnector }      from "../../src/knowledge/connectors/JiraConnector";
import { KnowledgeChunk }     from "../../src/knowledge/types";
import { HttpTransport }      from "../../src/integrations/JiraClient";
import * as http from "http";

function tmpDir() {
  const d = path.join(os.tmpdir(), `aiqa-rag-pipe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    text: "sample text", sourceId: "S-1", sourceName: "test",
    type: "story", tags: [], confidence: 1.0, relations: [],
    ingestedAt: new Date().toISOString(), ...overrides,
  };
}

// Stub connector for ingester tests
class StubConnector implements KnowledgeConnector {
  readonly name = "stub";
  constructor(private chunks: KnowledgeChunk[]) {}
  async fetch(): Promise<KnowledgeChunk[]> { return this.chunks; }
}

// ── KnowledgeIngester ─────────────────────────────────────────────────────────

describe("KnowledgeIngester", () => {
  test("run() ingests chunks and writes meta.json", async () => {
    const dir      = tmpDir();
    const metaPath = path.join(dir, "meta.json");
    const store    = new KnowledgeStore({ indexPath: path.join(dir, "index"), embedder: new StubEmbedder() });
    const ingester = new KnowledgeIngester({
      store,
      metaPath,
      connectors: [new StubConnector([makeChunk({ sourceId: "A-1" }), makeChunk({ sourceId: "A-2" })])],
    });

    const meta = await ingester.run();

    expect(meta.totalChunks).toBe(2);
    expect(meta.sources[0].name).toBe("stub");
    expect(meta.sources[0].chunks).toBe(2);
    expect(fs.existsSync(metaPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    expect(written.totalChunks).toBe(2);
  });

  test("run() deduplicates chunks with the same sourceId and text prefix", async () => {
    const dir      = tmpDir();
    const metaPath = path.join(dir, "meta.json");
    const store    = new KnowledgeStore({ indexPath: path.join(dir, "index"), embedder: new StubEmbedder() });

    const dup = makeChunk({ sourceId: "DUP-1", text: "exact same text" });
    const ingester = new KnowledgeIngester({
      store, metaPath,
      connectors: [new StubConnector([dup, dup])],
    });

    const meta = await ingester.run();
    expect(meta.totalChunks).toBe(1);
  });

  test("run() clears previous index on re-run (full rebuild)", async () => {
    const dir      = tmpDir();
    const metaPath = path.join(dir, "meta.json");
    const store    = new KnowledgeStore({ indexPath: path.join(dir, "index"), embedder: new StubEmbedder() });

    const ingester = new KnowledgeIngester({
      store, metaPath, connectors: [new StubConnector([makeChunk({ sourceId: "OLD-1" })])],
    });
    await ingester.run();

    // Second run with different data
    const ingester2 = new KnowledgeIngester({
      store, metaPath, connectors: [new StubConnector([makeChunk({ sourceId: "NEW-1" }), makeChunk({ sourceId: "NEW-2" })])],
    });
    const meta2 = await ingester2.run();
    expect(meta2.totalChunks).toBe(2);
  });

  test("readMeta() returns null when meta.json does not exist", () => {
    const dir      = tmpDir();
    const ingester = new KnowledgeIngester({ store: null as never, metaPath: path.join(dir, "nope.json"), connectors: [] });
    expect(ingester.readMeta()).toBeNull();
  });

  test("readMeta() returns parsed meta after ingest", async () => {
    const dir      = tmpDir();
    const metaPath = path.join(dir, "meta.json");
    const store    = new KnowledgeStore({ indexPath: path.join(dir, "index"), embedder: new StubEmbedder() });
    const ingester = new KnowledgeIngester({ store, metaPath, connectors: [new StubConnector([makeChunk()])] });
    await ingester.run();
    const meta = ingester.readMeta();
    expect(meta).not.toBeNull();
    expect(meta!.totalChunks).toBe(1);
  });

  test("run() with multiple connectors aggregates from all", async () => {
    const dir      = tmpDir();
    const metaPath = path.join(dir, "meta.json");
    const store    = new KnowledgeStore({ indexPath: path.join(dir, "index"), embedder: new StubEmbedder() });
    const ingester = new KnowledgeIngester({
      store, metaPath,
      connectors: [
        new StubConnector([makeChunk({ sourceId: "A-1" })]),
        new StubConnector([makeChunk({ sourceId: "B-1" }), makeChunk({ sourceId: "B-2" })]),
      ],
    });
    const meta = await ingester.run();
    expect(meta.totalChunks).toBe(3);
    expect(meta.sources).toHaveLength(2);
  });
});

// ── JiraConnector ─────────────────────────────────────────────────────────────

function makeTransport(body: object, status = 200): HttpTransport {
  return (_opts, cb) => {
    const payload = JSON.stringify(body);
    const res = Object.assign(
      new (require("stream").Readable)({
        read() {
          this.push(payload);
          this.push(null);
        },
      }),
      { statusCode: status, headers: {} },
    ) as unknown as http.IncomingMessage;
    cb?.(res);
    return { on: () => ({}), write: () => {}, end: () => {}, setTimeout: () => {} } as unknown as http.ClientRequest;
  };
}

const STORY_RESPONSE = {
  issues: [{
    id: "1", key: "SCRUM-10",
    fields: {
      summary: "User can apply coupon at checkout",
      issuetype: { name: "Story" },
      priority: { name: "High" },
      labels: ["checkout", "coupon"],
      fixVersions: [{ name: "2.4.0" }],
      description: {
        type: "doc", version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Coupon validation flow" }] }],
      },
      customfield_10016: "AC: Coupon is validated before loyalty points",
    },
  }],
  total: 1, maxResults: 50,
};

const DEFECT_RESPONSE = {
  issues: [{
    id: "2", key: "SCRUM-11",
    fields: {
      summary: "Loyalty discount applied twice when coupon also present",
      issuetype: { name: "Bug" },
      priority: { name: "Critical" },
      labels: ["checkout"],
      fixVersions: [],
      description: null,
      customfield_10016: null,
    },
  }],
  total: 1, maxResults: 50,
};

describe("JiraConnector", () => {
  function makeConnector(storyRes: object, defectRes: object) {
    let callIndex = 0;
    const transport = makeTransport(storyRes); // will be replaced per-call below
    // Alternate responses: first call = stories, second = defects
    const altTransport: HttpTransport = (opts, cb) => {
      const body = callIndex++ === 0 ? storyRes : defectRes;
      return makeTransport(body)(opts, cb);
    };
    return new JiraConnector({
      baseUrl: "https://test.atlassian.net",
      email: "test@test.com",
      apiToken: "token",
      projectKey: "SCRUM",
      transport: altTransport,
    });
  }

  test("fetch() returns chunks for stories and defects", async () => {
    const connector = makeConnector(STORY_RESPONSE, DEFECT_RESPONSE);
    const chunks    = await connector.fetch();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const sourceIds = chunks.map(c => c.sourceId);
    expect(sourceIds).toContain("SCRUM-10");
    expect(sourceIds).toContain("SCRUM-11");
  });

  test("story chunk has type='story'", async () => {
    const connector = makeConnector(STORY_RESPONSE, { issues: [], total: 0, maxResults: 50 });
    const chunks    = await connector.fetch();
    expect(chunks.some(c => c.type === "story")).toBe(true);
  });

  test("defect chunk has type='defect'", async () => {
    const connector = makeConnector({ issues: [], total: 0, maxResults: 50 }, DEFECT_RESPONSE);
    const chunks    = await connector.fetch();
    expect(chunks.some(c => c.type === "defect")).toBe(true);
  });

  test("chunk includes summary text", async () => {
    const connector = makeConnector(STORY_RESPONSE, { issues: [], total: 0, maxResults: 50 });
    const chunks    = await connector.fetch();
    expect(chunks[0].text).toContain("SCRUM-10");
    expect(chunks[0].text).toContain("coupon");
  });

  test("severity is mapped from Jira priority", async () => {
    const connector = makeConnector({ issues: [], total: 0, maxResults: 50 }, DEFECT_RESPONSE);
    const chunks    = await connector.fetch();
    const defect    = chunks.find(c => c.sourceId === "SCRUM-11");
    expect(defect?.severity).toBe("critical");
  });

  test("tags come from Jira labels", async () => {
    const connector = makeConnector(STORY_RESPONSE, { issues: [], total: 0, maxResults: 50 });
    const chunks    = await connector.fetch();
    expect(chunks[0].tags).toContain("checkout");
  });

  test("version from fixVersions", async () => {
    const connector = makeConnector(STORY_RESPONSE, { issues: [], total: 0, maxResults: 50 });
    const chunks    = await connector.fetch();
    expect(chunks[0].version).toBe("2.4.0");
  });

  test("connector name is 'jira'", () => {
    const connector = makeConnector({}, {});
    expect(connector.name).toBe("jira");
  });
});
