import { JiraClient, JiraIssue, HttpTransport } from "../../integrations/JiraClient";
import { jqlString } from "../../integrations/JiraAdapter";
import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";
import { Chunker } from "../chunkers/Chunker";
import { NaiveChunker } from "../chunkers/NaiveChunker";

const JIRA_SEVERITY: Record<string, KnowledgeChunk["severity"]> = {
  Highest: "critical",
  Critical: "critical",
  High:    "high",
  Medium:  "medium",
  Low:     "low",
  Lowest:  "low",
};

export class JiraConnector implements KnowledgeConnector {
  readonly name = "jira";

  private client:     JiraClient;
  private projectKey: string;
  private acField:    string;
  private chunker:    Chunker;

  constructor(opts: {
    baseUrl:    string;
    email:      string;
    apiToken:   string;
    projectKey: string;
    acField?:   string;   // Jira custom field ID for Acceptance Criteria (default: customfield_10016)
    chunker?:   Chunker;  // injectable — defaults to NaiveChunker; pass ACChunker when chunker: "ac-aware"
    transport?: HttpTransport;
  }) {
    this.client     = new JiraClient(opts.baseUrl, opts.email, opts.apiToken, opts.transport);
    this.projectKey = opts.projectKey;
    this.acField    = opts.acField ?? "customfield_10016";
    this.chunker    = opts.chunker ?? new NaiveChunker();
  }

  async fetch(): Promise<KnowledgeChunk[]> {
    const chunks: KnowledgeChunk[] = [];

    const fields = ["summary", "description", "issuetype", "priority", "labels", "fixVersions", "updated", this.acField];

    // Fetch stories + tasks — paginated so large backlogs are fully ingested
    const storiesResult = await this.client.searchAllIssues(
      `project = ${jqlString(this.projectKey)} AND issuetype in (Story, Task) ORDER BY priority DESC`,
      fields,
    );
    for (const issue of storiesResult.issues) {
      chunks.push(...this.issueToChunks(issue, "story"));
    }

    // Fetch defects — paginated
    const defectsResult = await this.client.searchAllIssues(
      `project = ${jqlString(this.projectKey)} AND issuetype = Bug ORDER BY priority DESC`,
      fields,
    );
    for (const issue of defectsResult.issues) {
      chunks.push(...this.issueToChunks(issue, "defect"));
    }

    return chunks;
  }

  private issueToChunks(issue: JiraIssue, type: "story" | "defect"): KnowledgeChunk[] {
    const fields   = issue.fields;
    const summary  = fields.summary ?? "";
    const priority = fields.priority?.name ?? "Medium";
    const labels   = fields.labels ?? [];
    const fixVer   = fields.fixVersions?.[0]?.name;

    const parts: string[] = [`[${issue.key}] ${summary}`];

    // ADF description
    const desc = fields.description;
    if (desc) parts.push(this.extractText(desc));

    // Acceptance criteria — field ID is configurable (default: customfield_10016)
    const ac = (fields as Record<string, unknown>)[this.acField];
    if (ac) parts.push(this.extractText(ac));

    const text = parts.filter(Boolean).join("\n\n").trim();
    if (!text) return [];

    return this.chunker.chunk(text, {
      sourceId:        issue.key,
      sourceName:      this.name,
      type,
      tags:            labels,
      severity:        JIRA_SEVERITY[priority],
      version:         fixVer,
      sourceUpdatedAt: fields.updated,
    });
  }

  // Recursively extract plain text from ADF or plain string
  private extractText(node: unknown): string {
    if (typeof node === "string") return node;
    if (typeof node !== "object" || node === null) return "";
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") return n.text;
    const content = n.content as unknown[] | undefined;
    if (Array.isArray(content)) {
      return content.map(c => this.extractText(c)).filter(Boolean).join(" ");
    }
    return "";
  }
}
