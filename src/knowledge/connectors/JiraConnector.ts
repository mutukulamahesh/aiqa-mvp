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

// Keywords that signal a selector/visual defect the healer can act on.
// Intentionally narrow — generic terms (click, input, visible) also appear in functional bugs.
const UI_KEYWORDS = /selector|css|locator|xpath|aria-|data-testid|playwright|data-cy|z-index|overlay|z-order|stale.?element|element.?not.?found|no.?such.?element|style|layout|render|tooltip|modal|dropdown/i;
// Keywords that signal a regression (env / data / config introduced the failure)
const REGRESSION_KEYWORDS = /regression|broke|after.*deploy|after.*release|after.*upgrade|introduced in/i;

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

    const fields = ["summary", "description", "issuetype", "priority", "labels", "fixVersions", "updated", "issuelinks", this.acField];

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
      category:        type === "defect" ? this.inferDefectCategory(summary, labels) : undefined,
      tags:            labels,
      severity:        JIRA_SEVERITY[priority],
      version:         fixVer,
      sourceUpdatedAt: fields.updated,
      relations:       this.extractRelations(issue, type),
    });
  }

  // Builds relations[] from Jira issuelinks — story↔defect, blocks/is-blocked-by.
  private extractRelations(issue: JiraIssue, type: "story" | "defect"): { type: string; targetId: string }[] {
    const links = issue.fields.issuelinks;
    if (!Array.isArray(links)) return [];

    return links
      .map(link => {
        const linked = link.inwardIssue ?? link.outwardIssue;
        if (!linked?.key) return null;
        // Relationship type from the perspective of this issue
        const relType = type === "story" ? "relates_to_defect" : "relates_to_story";
        return { type: relType, targetId: linked.key };
      })
      .filter((r): r is { type: string; targetId: string } => r !== null);
  }

  // Infers defect category from summary text and labels.
  // ui     → selector/visual failures that healers can act on
  // regression → failures introduced by a recent change (don't heal — investigate)
  // functional → business logic failures (don't heal — real defect)
  private inferDefectCategory(summary: string, labels: string[]): KnowledgeChunk["category"] {
    const haystack = [summary, ...labels].join(" ");
    if (REGRESSION_KEYWORDS.test(haystack)) return "regression";
    if (UI_KEYWORDS.test(haystack))         return "ui";
    return "functional";
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

