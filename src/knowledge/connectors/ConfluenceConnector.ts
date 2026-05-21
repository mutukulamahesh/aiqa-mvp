import * as https  from "https";
import * as http   from "http";
import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";
import { Chunker } from "../chunkers/Chunker";
import { NaiveChunker } from "../chunkers/NaiveChunker";

export type HttpTransport = (
  options: http.RequestOptions,
  callback?: (res: http.IncomingMessage) => void,
) => http.ClientRequest;

interface ConfluencePage {
  id:     string;
  title:  string;
  space:  { key: string };
  body?:  { storage?: { value?: string } };
  history?: { lastUpdated?: { when?: string } };
  metadata?: { labels?: { results?: Array<{ name: string }> } };
}

interface ConfluenceSearchResult {
  results: ConfluencePage[];
  size:    number;
  start:   number;
  limit:   number;
  _links?: { next?: string };
}

// Strip HTML/XML tags and collapse whitespace
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export class ConfluenceConnector implements KnowledgeConnector {
  readonly name = "confluence";

  private readonly base:      string;
  private readonly auth:      string;
  private readonly spaceKey:  string;
  private readonly chunker:   Chunker;
  private readonly transport: HttpTransport;

  constructor(opts: {
    baseUrl:    string;
    email:      string;
    apiToken:   string;
    spaceKey:   string;
    chunker?:   Chunker;
    transport?: HttpTransport;
  }) {
    this.base      = opts.baseUrl.replace(/\/$/, "");
    this.auth      = Buffer.from(`${opts.email}:${opts.apiToken}`).toString("base64");
    this.spaceKey  = opts.spaceKey;
    this.chunker   = opts.chunker ?? new NaiveChunker();
    this.transport = opts.transport ?? ((o, cb) => https.request(o, cb));
  }

  async fetch(): Promise<KnowledgeChunk[]> {
    const chunks: KnowledgeChunk[] = [];
    const PAGE_SIZE = 50;
    let start = 0;
    let total = Infinity;

    while (start < total) {
      const qs = new URLSearchParams({
        spaceKey: this.spaceKey,
        type:     "page",
        expand:   "body.storage,history.lastUpdated,metadata.labels",
        limit:    String(PAGE_SIZE),
        start:    String(start),
      });
      const page = await this.request<ConfluenceSearchResult>(
        `/wiki/rest/api/content?${qs}`,
      );

      for (const p of page.results) {
        const text = this.pageToText(p);
        if (!text) continue;
        const labels = p.metadata?.labels?.results?.map(l => l.name) ?? [];
        chunks.push(...this.chunker.chunk(text, {
          sourceId:        p.id,
          sourceName:      this.name,
          type:            "page",
          tags:            labels,
          sourceUpdatedAt: p.history?.lastUpdated?.when,
        }));
      }

      total  = page.size < PAGE_SIZE ? start + page.results.length : total === Infinity ? page.size : total;
      start += page.results.length;
      if (page.results.length === 0) break;
    }

    return chunks;
  }

  private pageToText(p: ConfluencePage): string {
    const title   = p.title ?? "";
    const storage = p.body?.storage?.value ?? "";
    const body    = storage ? stripTags(storage) : "";
    return [title, body].filter(Boolean).join("\n\n").trim();
  }

  private request<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const url  = new URL(path, this.base);
      const opts = {
        hostname: url.hostname,
        port:     url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method:   "GET",
        headers: {
          "Authorization": `Basic ${this.auth}`,
          "Accept":        "application/json",
        },
      };
      const req = this.transport(opts, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Confluence GET ${path} → HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try   { resolve(JSON.parse(text) as T); }
          catch { reject(new Error(`Confluence response not JSON: ${text.slice(0, 200)}`)); }
        });
      });
      req.setTimeout?.(30_000, () => req.destroy?.(new Error("Confluence request timed out")));
      req.on("error", reject);
      req.end();
    });
  }
}
