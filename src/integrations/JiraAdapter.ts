import * as crypto from "crypto";
import { JiraClient, JiraIssue } from "./JiraClient";
import { UserFlow, FlowStep } from "../agents/FlowMapper";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JiraStory {
  id:                  string;
  title:               string;
  description:         string;
  acceptanceCriteria:  string[];
  storyType:           "feature" | "bug" | "improvement";
  priority:            "high" | "medium" | "low";
}

export interface JiraConfig {
  baseUrl?:    string;   // e.g. "https://aiqajira.atlassian.net"
  email?:      string;
  apiToken?:   string;
  projectKey?: string;
  useMock?:    boolean;  // default true when credentials are absent
  throttleMs?: number;  // ms between API calls; default 100; set 0 to disable (e.g. in tests)
}

export interface PushResultItem {
  testName: string;
  passed:   boolean;
  error?:   string;
  /** Xray test issue key (e.g. AIQA-42) — populated if xraySyncEnabled */
  testKey?: string;
}

export interface FailureRecord {
  testName: string;
  error:    string;
}

export interface PushResultSummary {
  created:   string[];        // issue keys for newly created defects
  commented: string[];        // issue keys of existing issues that received a dedup comment
  skipped:   number;          // count of passed tests — no action taken
  failed:    FailureRecord[]; // items where the Jira API call failed (non-fatal)
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class JiraAdapter {
  private useMock: boolean;
  private readonly client: JiraClient | null;

  constructor(private readonly config: JiraConfig = {}) {
    const hasCredentials = !!(config.baseUrl && config.email && config.apiToken);

    // Warn when partial credentials are provided but the set is incomplete
    if (!hasCredentials && (config.baseUrl || config.email || config.apiToken)) {
      process.stderr.write(
        `[jira] incomplete credentials (need baseUrl + email + apiToken) — falling back to mock mode\n`,
      );
    }

    this.useMock = config.useMock ?? !hasCredentials;
    this.client  = this.useMock
      ? null
      : new JiraClient(config.baseUrl!, config.email!, config.apiToken!);
  }

  // ── Fetch stories ─────────────────────────────────────────────────────────

  async fetchStories(projectKey?: string): Promise<JiraStory[]> {
    const key = projectKey ?? this.config.projectKey ?? "DEMO";

    if (!this.client) {
      process.stderr.write(`[jira] mock mode — using built-in stories for "${key}"\n`);
      return this.mockStories(key);
    }

    const jql = `project = "${key}" AND issuetype in (Story, Task) ORDER BY priority DESC`;
    const result = await this.client.searchIssues(jql, [
      "summary", "description", "priority", "issuetype",
    ]);
    return result.issues.map(issue => this.parseIssue(issue));
  }

  // ── Convert stories → flows ───────────────────────────────────────────────

  async convertToFlows(stories: JiraStory[]): Promise<UserFlow[]> {
    return stories.map(story => this.storyToFlow(story));
  }

  // ── Push results → Jira defects ───────────────────────────────────────────

  async pushResults(results: PushResultItem[]): Promise<PushResultSummary> {
    const key = this.config.projectKey ?? "DEMO";

    if (!this.client) {
      process.stderr.write(`[jira] mock mode — defect push skipped\n`);
      return {
        created:   [],
        commented: [],
        skipped:   results.filter(r => r.passed).length,
        failed:    [],
      };
    }

    const created:   string[]        = [];
    const commented: string[]        = [];
    const failed:    FailureRecord[] = [];
    let   skipped = 0;
    const runId = new Date().toISOString();

    for (const r of results) {
      if (r.passed) { skipped++; continue; }

      const fp      = this.fingerprint(r.testName, r.error);
      const summary = `[AIQA] Test failed: ${r.testName}`;
      const labels  = ["aiqa", "aiqa-auto", fp, this.sanitizeLabel(r.testName)];

      try {
        await this.throttle();

        // Dedup: search for an existing open issue bearing the fingerprint label.
        // If the search itself fails, treat it as "no duplicate" and create a new issue.
        let existingKey: string | undefined;
        try {
          const jql     = `project = "${key}" AND labels = "${fp}" AND statusCategory != Done ORDER BY created DESC`;
          const existing = await this.client.searchIssues(jql, ["summary", "status"]);
          existingKey   = existing.issues[0]?.key;
        } catch {
          // search failure is non-fatal — fall through to create
        }

        if (existingKey) {
          // Duplicate found — add a comment instead of opening a second bug
          const commentText =
            `Test "${r.testName}" failed again in AIQA run ${runId}.` +
            (r.error ? `\n\nError:\n${r.error}` : "");
          await this.throttle();
          await this.client.addComment(existingKey, commentText);
          commented.push(existingKey);
          process.stderr.write(`[jira] updated existing defect ${existingKey} for "${r.testName}"\n`);
        } else {
          const bodyText =
            `Test "${r.testName}" failed in AIQA run ${runId}.` +
            (r.error ? `\n\nError:\n${r.error}` : "");
          const issue = await this.client.createIssue({
            project:     { key },
            issuetype:   { name: "Bug" },
            summary,
            priority:    { name: "High" },
            labels,
            description: this.toAdf(bodyText),
          });
          created.push(issue.key);
          process.stderr.write(`[jira] created defect ${issue.key} for "${r.testName}"\n`);
        }
      } catch (err) {
        // Per-item errors are non-fatal — log and continue so other issues are still processed
        const msg = (err as Error).message ?? String(err);
        process.stderr.write(`[jira] failed to create/sync issue for "${r.testName}": ${msg}\n`);
        failed.push({ testName: r.testName, error: msg });
      }
    }

    return { created, commented, skipped, failed };
  }

  // ── Xray result sync ──────────────────────────────────────────────────────

  async syncXrayResults(
    testExecutionKey: string,
    results: PushResultItem[],
  ): Promise<void> {
    if (!this.client) {
      process.stderr.write(`[jira] mock mode — Xray sync skipped\n`);
      return;
    }

    const tests = results
      .filter(r => r.testKey)
      .map(r => ({
        testKey: r.testKey!,
        status:  r.passed ? ("PASS" as const) : ("FAIL" as const),
        comment: r.error,
      }));

    if (tests.length === 0) {
      process.stderr.write(`[jira] Xray sync: no testKey fields set on results — skipping\n`);
      return;
    }

    await this.client.importXrayResults({ testExecutionKey, tests });
    process.stderr.write(`[jira] Xray sync: pushed ${tests.length} result(s) to ${testExecutionKey}\n`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Stable fingerprint: same test name + same error class → same label across runs. */
  private fingerprint(testName: string, error?: string): string {
    const errorClass = error?.match(/^[A-Za-z]+(?:Error|Exception)/)?.[0] ?? "";
    return "aiqa-fp-" + crypto.createHash("sha256")
      .update(`${testName}|${errorClass}`)
      .digest("hex")
      .slice(0, 12);
  }

  /** Jira-safe label derived from the test name (no spaces, max 50 chars). */
  private sanitizeLabel(name: string): string {
    return "aiqa-test-" + name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }

  /** Inserts a small delay between API calls to stay within Jira rate limits. */
  private throttle(): Promise<void> {
    const ms = this.config.throttleMs ?? 100;
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }

  private parseIssue(issue: JiraIssue): JiraStory {
    const rawPriority = (issue.fields.priority?.name ?? "Medium").toLowerCase();
    const rawType     = (issue.fields.issuetype?.name ?? "Story").toLowerCase();

    const priority: JiraStory["priority"] =
      rawPriority.includes("high") || rawPriority.includes("critical") ? "high"
      : rawPriority.includes("low") ? "low"
      : "medium";

    const storyType: JiraStory["storyType"] =
      rawType.includes("bug")         ? "bug"
      : rawType.includes("improve")   ? "improvement"
      : "feature";

    return {
      id:                issue.key,
      title:             issue.fields.summary,
      description:       this.extractText(issue.fields.description) || issue.fields.summary,
      acceptanceCriteria: [],
      storyType,
      priority,
    };
  }

  private extractText(adf: unknown): string {
    if (!adf || typeof adf !== "object") return "";
    const node = adf as { text?: string; content?: unknown[] };
    if (node.text) return node.text;
    if (!node.content) return "";
    return node.content.map(c => this.extractText(c)).join(" ").trim();
  }

  private toAdf(text: string): object {
    return {
      type:    "doc",
      version: 1,
      content: text.split("\n\n").filter(Boolean).map(para => ({
        type:    "paragraph",
        content: [{ type: "text", text: para.replace(/\n/g, " ") }],
      })),
    };
  }

  // ── Flow conversion helpers ───────────────────────────────────────────────

  private storyToFlow(story: JiraStory): UserFlow {
    const t = story.title.toLowerCase();

    const type: UserFlow["type"] =
      t.includes("log in") || t.includes("login") || t.includes("sign in")
        ? "authentication"
        : t.includes("register") || t.includes("sign up")
        ? "form_submission"
        : t.includes("browse") || t.includes("view") || t.includes("see")
        ? "navigation"
        : "form_submission";

    return {
      name:        story.title,
      description: story.description,
      type,
      priority:    story.priority,
      pages:       [],
      steps:       this.acToSteps(story.acceptanceCriteria, type),
    };
  }

  private acToSteps(criteria: string[], type: UserFlow["type"]): FlowStep[] {
    if (type === "authentication") {
      return [
        { action: "navigate", target: "/login" },
        { action: "fill",     target: "email",    value: "testuser@example.com" },
        { action: "fill",     target: "password", value: "TestPassword123" },
        { action: "click",    target: "Sign in" },
        { action: "assert",   target: "url",      value: "dashboard" },
      ];
    }
    if (type === "form_submission") {
      return [
        { action: "navigate", target: "/register" },
        { action: "fill",     target: "email",    value: "newuser@example.com" },
        { action: "fill",     target: "password", value: "NewPassword123" },
        { action: "click",    target: "Register" },
        { action: "assert",   target: "text",     value: "success" },
      ];
    }
    return [
      { action: "navigate", target: "/" },
      { action: "assert",   target: "text", value: criteria[0]?.slice(0, 30) ?? "home" },
    ];
  }

  // ── Mock data ─────────────────────────────────────────────────────────────

  private mockStories(projectKey: string): JiraStory[] {
    return [
      {
        id:          `${projectKey}-1`,
        title:       "User can log in with valid credentials",
        description: "As a registered user I want to log in so that I can access my account.",
        acceptanceCriteria: [
          "Given valid email and password, the user reaches the dashboard",
          "Given invalid credentials, an error message is shown",
        ],
        storyType: "feature",
        priority:  "high",
      },
      {
        id:          `${projectKey}-2`,
        title:       "User can register a new account",
        description: "As a visitor I want to create an account so that I can use the application.",
        acceptanceCriteria: [
          "Given a unique email, the registration form submits successfully",
          "Given a duplicate email, an error message is shown",
        ],
        storyType: "feature",
        priority:  "high",
      },
      {
        id:          `${projectKey}-3`,
        title:       "User can browse the home page",
        description: "As a user I want to see the home page so that I understand what the app offers.",
        acceptanceCriteria: [
          "The home page loads within 3 seconds",
          "Key navigation links are visible",
        ],
        storyType: "feature",
        priority:  "medium",
      },
    ];
  }
}
