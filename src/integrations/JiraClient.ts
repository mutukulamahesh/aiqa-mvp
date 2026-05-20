import * as https  from "https";
import * as http   from "http";
import * as fs     from "fs";
import * as path   from "path";
import * as crypto from "crypto";

// ── Transport type (injectable for testing) ───────────────────────────────────

export type HttpTransport = (
  options: http.RequestOptions,
  callback?: (res: http.IncomingMessage) => void,
) => http.ClientRequest;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JiraIssueFields {
  summary:     string;
  description?: object;
  issuetype:   { name: string };
  project:     { key: string };
  priority?:   { name: string };
  labels?:     string[];
}

export interface JiraIssue {
  id:   string;
  key:  string;
  fields: {
    summary:             string;
    status:              { name: string };
    priority:            { name: string };
    issuetype:           { name: string };
    labels?:             string[];
    fixVersions?:        Array<{ name: string }>;
    updated?:            string;   // ISO date — last modified timestamp from Jira
    description?:        unknown;
    customfield_10016?:  unknown;  // Acceptance Criteria — common Jira custom field
  };
}

export interface JiraTransition {
  id:   string;
  name: string;
}

export interface JiraSearchResult {
  issues:     JiraIssue[];
  total:      number;
  maxResults: number;
}

export interface XrayTestExecution {
  testExecutionKey: string;
  tests: Array<{
    testKey:  string;
    status:   "PASS" | "FAIL" | "TODO";
    comment?: string;
  }>;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class JiraClient {
  private readonly auth:      string;
  private readonly base:      string;
  private readonly transport: HttpTransport;

  constructor(
    baseUrl:    string,
    email:      string,
    apiToken:   string,
    transport?: HttpTransport,
  ) {
    this.base      = baseUrl.replace(/\/$/, "");
    this.auth      = Buffer.from(`${email}:${apiToken}`).toString("base64");
    this.transport = transport ?? ((opts, cb) => https.request(opts, cb));
  }

  async getProject(key: string): Promise<{ key: string; name: string }> {
    return this.request<{ key: string; name: string }>("GET", `/rest/api/3/project/${encodeURIComponent(key)}`);
  }

  async searchIssues(
    jql: string,
    fields: string[] = ["summary", "status", "priority", "issuetype", "description"],
  ): Promise<JiraSearchResult> {
    const qs = `jql=${encodeURIComponent(jql)}&fields=${fields.join(",")}&maxResults=50`;
    return this.request<JiraSearchResult>("GET", `/rest/api/3/search?${qs}`);
  }

  // Paginates through all results — use this instead of searchIssues when the
  // result set may exceed 50 items (e.g. bulk knowledge ingestion).
  async searchAllIssues(
    jql: string,
    fields: string[] = ["summary", "status", "priority", "issuetype", "description"],
  ): Promise<JiraSearchResult> {
    const PAGE_SIZE = 50;
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    let total   = Infinity;

    while (startAt < total) {
      const qs   = `jql=${encodeURIComponent(jql)}&fields=${fields.join(",")}&maxResults=${PAGE_SIZE}&startAt=${startAt}`;
      const page = await this.request<JiraSearchResult>("GET", `/rest/api/3/search?${qs}`);
      allIssues.push(...page.issues);
      total    = page.total;
      startAt += page.issues.length;
      if (page.issues.length === 0) break; // safety guard
    }

    return { issues: allIssues, total: allIssues.length, maxResults: PAGE_SIZE };
  }

  async createIssue(fields: JiraIssueFields): Promise<{ id: string; key: string }> {
    return this.request<{ id: string; key: string }>("POST", "/rest/api/3/issue", { fields });
  }

  async addComment(issueKey: string, text: string): Promise<void> {
    const body = {
      body: {
        type: "doc", version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    };
    await this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, body);
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const data = await this.request<{ transitions: JiraTransition[] }>(
      "GET", `/rest/api/3/issue/${issueKey}/transitions`,
    );
    return data.transitions;
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: transitionId },
    });
  }

  /** Xray Cloud — import test execution results (requires Xray app installed). */
  async importXrayResults(execution: XrayTestExecution): Promise<void> {
    await this.request("POST", "/rest/raven/1.0/import/execution", execution);
  }

  /**
   * Attach a local file to a Jira issue.
   * Jira requires X-Atlassian-Token: no-check to prevent CSRF on the attachment endpoint.
   */
  async attachFile(issueKey: string, filePath: string): Promise<void> {
    // M-2: Enforce a 50 MB size cap before loading into memory, consistent with
    // the screenshots API route. Prevents unexpectedly large files from OOM-ing the process.
    const MAX_BYTES = 50 * 1024 * 1024;
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BYTES) {
      throw new Error(
        `attachFile: ${filePath} is ${stat.size} bytes — exceeds 50 MB limit. Skipping attachment.`,
      );
    }

    const fileContent = fs.readFileSync(filePath);
    // L-1: Strip double-quotes and CRLF sequences so they can't malform the Content-Disposition header.
    const filename    = path.basename(filePath).replace(/["\r\n]/g, "_");
    // L-2: Use cryptographically random boundary (RFC 2046 recommendation).
    const boundary    = `----AIQABoundary${crypto.randomBytes(16).toString("hex")}`;

    const prefix  = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    );
    const suffix  = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([prefix, fileContent, suffix]);

    return new Promise((resolve, reject) => {
      const url  = new URL(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, this.base);
      const opts = {
        hostname: url.hostname,
        port:     url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname,
        method:   "POST",
        headers: {
          "Authorization":     `Basic ${this.auth}`,
          "X-Atlassian-Token": "no-check",
          "Content-Type":      `multipart/form-data; boundary=${boundary}`,
          "Content-Length":    payload.length,
        },
      };

      const req = this.transport(opts, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            const text = Buffer.concat(chunks).toString("utf-8").slice(0, 300);
            reject(new Error(`Jira attachFile ${issueKey} → HTTP ${res.statusCode}: ${text}`));
            return;
          }
          resolve();
        });
      });

      // M-1: Apply the same 30 s request timeout used by request() so a stalled
      // attachment upload doesn't hang pushResults silently.
      req.setTimeout?.(30_000, () => req.destroy?.(new Error("Jira attachFile timed out after 30 s")));
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url     = new URL(path, this.base);
      const payload = body !== undefined ? JSON.stringify(body) : undefined;

      const options = {
        hostname: url.hostname,
        port:     url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method,
        headers: {
          "Authorization": `Basic ${this.auth}`,
          "Accept":        "application/json",
          "Content-Type":  "application/json",
          ...(payload !== undefined ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      };

      const req = this.transport(options, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            let detail = text.slice(0, 500);
            try { detail = JSON.stringify(JSON.parse(text), null, 2).slice(0, 500); } catch { /* raw */ }
            reject(new Error(`Jira ${method} ${path} → HTTP ${res.statusCode}: ${detail}`));
            return;
          }
          if (!text.trim()) { resolve(undefined as T); return; }
          try   { resolve(JSON.parse(text) as T); }
          catch { reject(new Error(`Jira response not JSON: ${text.slice(0, 200)}`)); }
        });
      });

      req.setTimeout?.(30_000, () => req.destroy?.(new Error("Jira request timed out after 30 s")));
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}
