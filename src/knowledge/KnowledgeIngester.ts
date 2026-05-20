import * as fs   from "fs";
import * as path from "path";
import { KnowledgeConnector } from "./connectors/KnowledgeConnector";
import { KnowledgeStore } from "./KnowledgeStore";
import { KnowledgeChunk } from "./types";

export interface IngestMeta {
  lastIngestedAt: string;
  totalChunks:    number;
  sources:        { name: string; chunks: number }[];
}

export class KnowledgeIngester {
  private store:      KnowledgeStore;
  private metaPath:   string;
  private connectors: KnowledgeConnector[];

  constructor(opts: {
    store:      KnowledgeStore;
    metaPath:   string;
    connectors: KnowledgeConnector[];
  }) {
    this.store      = opts.store;
    this.metaPath   = opts.metaPath;
    this.connectors = opts.connectors;
  }

  async run(): Promise<IngestMeta> {
    // Clear existing index so ingest is always a full rebuild (no stale entries)
    await this.store.clear();

    const sourceSummaries: { name: string; chunks: number }[] = [];
    const seen = new Set<string>();

    for (const connector of this.connectors) {
      const raw = await connector.fetch();

      // Deduplicate by sourceId — same ticket ingested twice gets one chunk
      const deduped = raw.filter(c => {
        const key = `${c.sourceName}:${c.sourceId}:${c.text.slice(0, 40)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      await this.store.ingest(deduped);
      sourceSummaries.push({ name: connector.name, chunks: deduped.length });
    }

    const meta: IngestMeta = {
      lastIngestedAt: new Date().toISOString(),
      totalChunks:    sourceSummaries.reduce((s, x) => s + x.chunks, 0),
      sources:        sourceSummaries,
    };

    fs.mkdirSync(path.dirname(this.metaPath), { recursive: true });
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return meta;
  }

  readMeta(): IngestMeta | null {
    return KnowledgeIngester.readMetaFrom(this.metaPath);
  }

  static readMetaFrom(metaPath: string): IngestMeta | null {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as IngestMeta;
    } catch {
      return null;
    }
  }
}
