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
}

export interface PushResultItem {
  testName: string;
  passed:   boolean;
  error?:   string;
  /** Xray test issue key (e.g. AIQA-42) — populated if xraySyncEnabled */
  testKey?: string;
}

export interface PushResultSummary {
  created: string[];   // Jira issue keys for newly created defects
  skipped: number;     // passed tests — no action taken
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class JiraAdapter {
  private readonly useMock: boolean;
  private readonly client: JiraClient | null;

  constructor(private readonly config: JiraConfig = {}) {
    this.useMock =
      config.useMock ??
      !(config.baseUrl && config.email && config.apiToken);

    this.client = this.useMock
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
      return { created: [], skipped: results.filter(r => r.passed).length };
    }

    const created: string[] = [];
    let   skipped = 0;

    for (const r of results) {
      if (r.passed) { skipped++; continue; }

      const summary = `[AIQA] Test failed: ${r.testName}`;
      const bodyText = r.error
        ? `Test "${r.testName}" failed in an AIQA automated run.\n\nError:\n${r.error}`
        : `Test "${r.testName}" failed in an AIQA automated run.`;

      const issue = await this.client.createIssue({
        project:     { key },
        issuetype:   { name: "Bug" },
        summary,
        priority:    { name: "High" },
        labels:      ["aiqa-auto"],
        description: this.toAdf(bodyText),
      });
      created.push(issue.key);
      process.stderr.write(`[jira] created defect ${issue.key} for "${r.testName}"\n`);
    }

    return { created, skipped };
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

  // ── Parsing helpers ───────────────────────────────────────────────────────

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
