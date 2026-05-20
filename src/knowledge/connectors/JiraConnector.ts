import { JiraClient, HttpTransport } from "../../integrations/JiraClient";
import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";
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
  private chunker:    NaiveChunker;

  constructor(opts: {
    baseUrl:    string;
    email:      string;
    apiToken:   string;
    projectKey: string;
    transport?: HttpTransport;
  }) {
    this.client     = new JiraClient(opts.baseUrl, opts.email, opts.apiToken, opts.transport);
    this.projectKey = opts.projectKey;
    this.chunker    = new NaiveChunker();
  }

  async fetch(): Promise<KnowledgeChunk[]> {
    const chunks: KnowledgeChunk[] = [];

    const fields = ["summary", "description", "issuetype", "priority", "labels", "fixVersions", "customfield_10016"];

    // Fetch stories + tasks
    const storiesResult = await this.client.searchIssues(
      `project = "${this.projectKey}" AND issuetype in (Story, Task) ORDER BY priority DESC`,
      fields,
    );
    for (const issue of storiesResult.issues) {
      chunks.push(...this.issueToChunks(issue, "story"));
    }

    // Fetch defects
    const defectsResult = await this.client.searchIssues(
      `project = "${this.projectKey}" AND issuetype = Bug ORDER BY priority DESC`,
      fields,
    );
    for (const issue of defectsResult.issues) {
      chunks.push(...this.issueToChunks(issue, "defect"));
    }

    return chunks;
  }

  private issueToChunks(issue: { key: string; fields: Record<string, unknown> }, type: "story" | "defect"): KnowledgeChunk[] {
    const fields   = issue.fields as Record<string, unknown>;
    const summary  = (fields.summary as string | undefined) ?? "";
    const priority = ((fields.priority as { name?: string } | undefined)?.name) ?? "Medium";
    const labels   = (fields.labels as string[] | undefined) ?? [];
    const fixVer   = ((fields.fixVersions as Array<{ name: string }> | undefined)?.[0]?.name);

    const parts: string[] = [`[${issue.key}] ${summary}`];

    // ADF description
    const desc = fields.description;
    if (desc) parts.push(this.extractText(desc));

    // Acceptance criteria custom field
    const ac = fields.customfield_10016;
    if (ac) parts.push(this.extractText(ac));

    const text = parts.filter(Boolean).join("\n\n").trim();
    if (!text) return [];

    return this.chunker.chunk(text, {
      sourceId:   issue.key,
      sourceName: this.name,
      type,
      tags:       labels,
      severity:   JIRA_SEVERITY[priority],
      version:    fixVer,
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
