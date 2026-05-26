import * as https from "https";
import * as http  from "http";
import * as vscode from "vscode";

export interface RunAccepted  { runId: string }
export interface RunSummary   { passed: number; failed: number; total: number }
export interface RunMeta {
  runId: string; type: string; status: string;
  summary?: RunSummary; completedAt?: string;
}

const TERMINAL = new Set(["passed", "failed", "error", "cancelled"]);

function cfg() { return vscode.workspace.getConfiguration("aiqa"); }

export class AiqaClient {
  private get baseUrl() { return cfg().get<string>("serverUrl", "http://localhost:7432").replace(/\/+$/, ""); }
  private get apiKey()  { return cfg().get<string>("apiKey", ""); }

  private request(method: string, path: string, body?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url   = new URL(this.baseUrl + path);
      const data  = body ? Buffer.from(JSON.stringify(body)) : undefined;
      const key   = this.apiKey;
      const opts  = {
        hostname: url.hostname,
        port:     url.port || (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method,
        headers: {
          "Content-Type":  "application/json",
          "Accept":        "application/json",
          ...(key ? { "Authorization": `Bearer ${key}` } : {}),
          ...(data ? { "Content-Length": data.length } : {}),
        },
      };
      const lib  = url.protocol === "https:" ? https : http;
      const req  = lib.request(opts, (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if ((res.statusCode ?? 0) >= 400) reject(new Error((parsed as {error?: string}).error ?? raw));
            else resolve(parsed);
          } catch { reject(new Error(raw)); }
        });
      });
      req.on("error", reject);
      req.setTimeout(30_000, () => { req.destroy(new Error("Request timeout")); });
      if (data) req.write(data);
      req.end();
    });
  }

  async runFile(filePath: string, headless: boolean): Promise<RunAccepted> {
    return this.request("POST", "/api/run", { file: filePath, headless, env: "dev" }) as Promise<RunAccepted>;
  }

  async runAll(dir: string, headless: boolean, workers = 1): Promise<RunAccepted> {
    return this.request("POST", "/api/run-all", { dir, headless, workers, env: "dev" }) as Promise<RunAccepted>;
  }

  async getRun(runId: string): Promise<RunMeta> {
    return this.request("GET", `/api/runs/${runId}`) as Promise<RunMeta>;
  }

  async health(): Promise<{ status: string }> {
    return this.request("GET", "/api/health") as Promise<{ status: string }>;
  }

  async waitForRun(
    runId: string,
    onProgress: (meta: RunMeta) => void,
    timeoutMs = 300_000,
  ): Promise<RunMeta> {
    const maxMs   = cfg().get<number>("maxPollIntervalMs", 10_000);
    const deadline = Date.now() + timeoutMs;
    let intervalMs = 2_000;
    while (Date.now() < deadline) {
      const meta = await this.getRun(runId);
      onProgress(meta);
      if (TERMINAL.has(meta.status)) return meta;
      const remaining = deadline - Date.now();
      await new Promise(r => setTimeout(r, Math.min(intervalMs, remaining, maxMs)));
      intervalMs = Math.min(intervalMs * 2, maxMs);
    }
    throw new Error(`Run ${runId} did not finish within ${timeoutMs / 1000}s`);
  }
}
