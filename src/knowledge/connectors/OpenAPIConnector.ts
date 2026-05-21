import * as https  from "https";
import * as http   from "http";
import * as yaml   from "js-yaml";
import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";
import { NaiveChunker } from "../chunkers/NaiveChunker";

export type HttpTransport = (
  options: http.RequestOptions,
  callback?: (res: http.IncomingMessage) => void,
) => http.ClientRequest;

interface OpenAPISpec {
  info?:  { title?: string; description?: string; version?: string };
  paths?: Record<string, Record<string, OpenAPIOperation>>;
}

interface OpenAPIOperation {
  summary?:     string;
  description?: string;
  tags?:        string[];
  parameters?:  Array<{ name: string; in: string; description?: string; required?: boolean }>;
  responses?:   Record<string, { description?: string }>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

const chunker = new NaiveChunker();

export class OpenAPIConnector implements KnowledgeConnector {
  readonly name = "openapi";

  private readonly url:       string;
  private readonly transport: HttpTransport;

  constructor(opts: { url: string; transport?: HttpTransport }) {
    this.url       = opts.url;
    this.transport = opts.transport ?? ((o, cb) => https.request(o, cb));
  }

  async fetch(): Promise<KnowledgeChunk[]> {
    const raw  = await this.fetchSpec();
    const spec = this.parseSpec(raw);
    return this.specToChunks(spec);
  }

  private specToChunks(spec: OpenAPISpec): KnowledgeChunk[] {
    const chunks: KnowledgeChunk[] = [];
    const paths = spec.paths ?? {};

    for (const [path, pathItem] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        const op = pathItem[method] as OpenAPIOperation | undefined;
        if (!op) continue;

        const lines: string[] = [
          `${method.toUpperCase()} ${path}`,
          op.summary     ? `Summary: ${op.summary}`     : "",
          op.description ? `Description: ${op.description.slice(0, 400)}` : "",
        ];

        if (op.parameters?.length) {
          const params = op.parameters
            .map(p => `  ${p.name} (${p.in}${p.required ? ", required" : ""}): ${p.description ?? ""}`)
            .join("\n");
          lines.push(`Parameters:\n${params}`);
        }

        if (op.responses) {
          const resp = Object.entries(op.responses)
            .map(([code, r]) => `  ${code}: ${r.description ?? ""}`)
            .join("\n");
          lines.push(`Responses:\n${resp}`);
        }

        const text = lines.filter(Boolean).join("\n").trim();
        if (!text) continue;

        // sourceId: stable identifier — method + path, sanitised
        const sourceId = `${method.toUpperCase()}_${path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

        chunks.push(...chunker.chunk(text, {
          sourceId,
          sourceName: this.name,
          type:       "api",
          tags:       op.tags ?? [],
        }));
      }
    }

    return chunks;
  }

  private parseSpec(raw: string): OpenAPISpec {
    // Try JSON first, fall back to YAML
    try { return JSON.parse(raw) as OpenAPISpec; } catch { /* try yaml */ }
    return yaml.load(raw) as OpenAPISpec ?? {};
  }

  private fetchSpec(): Promise<string> {
    return new Promise((resolve, reject) => {
      const url  = new URL(this.url);
      const opts = {
        hostname: url.hostname,
        port:     url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method:   "GET",
        headers:  { "Accept": "application/json, application/yaml, text/yaml, */*" },
      };
      const transport = url.protocol === "https:" ? this.transport : ((o: http.RequestOptions, cb?: (r: http.IncomingMessage) => void) => http.request(o, cb));
      const req = transport(opts, res => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`OpenAPI fetch ${this.url} → HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(parts).toString("utf-8"));
        });
      });
      req.setTimeout?.(30_000, () => req.destroy?.(new Error("OpenAPI fetch timed out")));
      req.on("error", reject);
      req.end();
    });
  }
}
