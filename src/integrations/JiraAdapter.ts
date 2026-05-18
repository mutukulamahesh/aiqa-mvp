import * as crypto from "crypto";
import { JiraClient, JiraIssue } from "./JiraClient";
import { UserFlow, FlowStep } from "../agents/FlowMapper";
import { logger } from "../utils/logger";

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
  throttleMs?: number;  // minimum ms between consecutive API calls; default 100; set 0 to disable (e.g. in tests)
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

// ── JQL builder ───────────────────────────────────────────────────────────────

/**
 * Builds a parameterized JQL clause that correctly quotes and escapes values.
 * Prevents JQL injection by never interpolating raw user input into the query string.
 *
 * Jira JQL string literals are quoted with double-quotes; internal double-quotes
 * must be escaped as \".  We additionally strip characters Jira rejects in labels.
 */
function jqlString(value: string): string {
  // Escape backslashes first, then double-quotes
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Builds a JQL clause for the standard issue search used in dedup queries. */
function buildDedupJql(projectKey: string, fingerprintLabel: string): string {
  return (
    `project = ${jqlString(projectKey)} ` +
    `AND labels = ${jqlString(fingerprintLabel)} ` +
    `AND statusCategory != Done ` +
    `ORDER BY created DESC`
  );
}

/** Builds the JQL clause for fetching project stories. */
function buildStoriesJql(projectKey: string): string {
  return (
    `project = ${jqlString(projectKey)} ` +
    `AND issuetype in (Story, Task) ` +
    `ORDER BY priority DESC`
  );
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class JiraAdapter {
  private readonly useMock: boolean;
  private readonly client: JiraClient | null;

  constructor(private readonly config: JiraConfig = {}) {
    const hasCredentials = !!(config.baseUrl && config.email && config.apiToken);

    // Warn when partial credentials are provided but the set is incomplete
    if (!hasCredentials && (config.baseUrl || config.email || config.apiToken)) {
      process.stderr.write(
        `[jira] incomplete credentials (need baseUrl + email + apiToken) — falling back to mock mode\n`,
      );
    }

    // SEC: Reject non-HTTPS Jira URLs — credentials would be sent in plaintext.
    // Set AIQA_JIRA_ALLOW_HTTP=true only for local/dev environments.
    if (config.baseUrl && !config.baseUrl.startsWith("https://")) {
      if (process.env.AIQA_JIRA_ALLOW_HTTP === "true") {
        logger.warn(`[JiraAdapter] Connecting to Jira over HTTP — credentials in plaintext: ${config.baseUrl}`);
      } else {
        throw new Error(
          `[JiraAdapter] baseUrl must use https://. Got: "${config.baseUrl}". ` +
          `Set AIQA_JIRA_ALLOW_HTTP=true to override (not recommended for production).`,
        );
      }
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

    const result = await this.client.searchIssues(buildStoriesJql(key), [
      "summary", "description", "priority", "issuetype",
    ]);
    return result.issues.map(issue => this.parseIssue(issue));
  }

  // ── Convert stories → flows ───────────────────────────────────────────────

  async convertToFlows(stories: JiraStory[]): Promise<UserFlow[]> {
    return stories.map(story => this.storyToFlow(story));
  }

  // ── Push results → Jira defects ───────────────────────────────────────────

  async pushResults(results: PushResultItem[], runId?: string): Promise<PushResultSummary> {
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
    const effectiveRunId = runId ?? new Date().toISOString();

    for (const r of results) {
      if (r.passed) { skipped++; continue; }

      const fp      = this.fingerprint(r.testName, r.error);
      const summary = `[AIQA] Test failed: ${r.testName}`;
      const labels  = ["aiqa", "aiqa-auto", fp, this.sanitizeLabel(r.testName)];

      try {
        await this.throttle();

        let existingKey: string | undefined;
        try {
          const existing = await this.client.searchIssues(buildDedupJql(key, fp), ["summary", "status"]);
          existingKey    = existing.issues[0]?.key;
        } catch {
          // search failure is non-fatal — fall through to create
        }

        if (existingKey) {
          const commentText =
            `Test "${r.testName}" failed again in AIQA run ${effectiveRunId}.` +
            (r.error ? `\n\nError:\n${r.error}` : "");
          await this.throttle();
          await this.client.addComment(existingKey, commentText);
          commented.push(existingKey);
          process.stderr.write(`[jira] updated existing defect ${existingKey} for "${r.testName}"\n`);
        } else {
          const bodyText =
            `Test "${r.testName}" failed in AIQA run ${effectiveRunId}.` +
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
    const errorClass = error?.match(/[A-Za-z]+(?:Error|Exception)/)?.[0] ?? "";
    return "aiqa-fp-" + crypto.createHash("sha256")
      .update(`${testName}|${errorClass}`)
      .digest("hex")
      .slice(0, 12);
  }

  /**
   * Jira-safe label derived from the test name (no spaces, max 50 chars).
   * Appends a 6-char hash suffix to guarantee uniqueness even when two test
   * names collide after slug normalisation (e.g. "foo_bar" vs "foo--bar").
   */
  private sanitizeLabel(name: string): string {
    const slug = "aiqa-test-" + name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 33); // leave room for dash + 6-char hash
    const hash = crypto.createHash("sha256").update(name).digest("hex").slice(0, 6);
    return `${slug}-${hash}`;
  }

  private lastCallTime = 0;

  private async throttle(): Promise<void> {
    const ms = this.config.throttleMs ?? 100;
    if (ms <= 0) return;
    const elapsed = Date.now() - this.lastCallTime;
    const wait    = Math.max(0, ms - elapsed);
    if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
    this.lastCallTime = Date.now();
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
      type: "doc", version: 1,
      content: [{
        type: "paragraph",
        content: [{ type: "text", text }],
      }],
    };
  }

  private storyToFlow(story: JiraStory): UserFlow {
    const titleLower = story.title.toLowerCase();
    const isLogin    = /\blog.?in\b|login/.test(titleLower);
    const isRegister = /register|sign.?up/.test(titleLower);

    let flowType: UserFlow["type"];
    if (isLogin) {
      flowType = "authentication";
    } else if (isRegister) {
      flowType = "form_submission";
    } else if (story.storyType === "bug") {
      flowType = "crud";
    } else {
      flowType = "navigation";
    }

    const steps: FlowStep[] = [
      { action: "navigate", target: "{{ env.base }}" },
    ];

    if (isLogin) {
      steps.push({ action: "fill",   target: 'input[type="email"], input[name="username"]', value: "{{ env.username }}" });
      steps.push({ action: "fill",   target: 'input[type="password"]', value: "{{ env.password }}" });
      steps.push({ action: "click",  target: 'button[type="submit"]' });
      steps.push({ action: "assert", target: "text", value: story.acceptanceCriteria[1] ?? "access granted" });
    } else if (isRegister) {
      steps.push({ action: "fill",   target: 'input[name="email"]',    value: "{{ env.newEmail }}" });
      steps.push({ action: "fill",   target: 'input[type="password"]', value: "{{ env.password }}" });
      steps.push({ action: "click",  target: 'button[type="submit"]' });
    } else {
      steps.push({ action: "assert", target: "text", value: story.title });
      for (const criterion of story.acceptanceCriteria.slice(0, 3)) {
        steps.push({ action: "assert", target: "text", value: criterion });
      }
    }

    return {
      name:        story.title,
      description: story.description,
      type:        flowType,
      priority:    story.priority,
      pages:       [],
      steps,
    };
  }

  private mockStories(projectKey: string): JiraStory[] {
    return [
      {
        id:                `${projectKey}-1`,
        title:             "User can log in with valid credentials",
        description:       "As a user, I want to log in with my username and password",
        acceptanceCriteria: ["Login form is displayed", "Valid credentials grant access", "Invalid credentials show error"],
        storyType:         "feature",
        priority:          "high",
      },
      {
        id:                `${projectKey}-2`,
        title:             "User can register a new account",
        description:       "As a new user, I want to register with my email and password",
        acceptanceCriteria: ["Registration form is displayed", "Valid details create account", "Duplicate email shows error"],
        storyType:         "feature",
        priority:          "high",
      },
      {
        id:                `${projectKey}-3`,
        title:             "User can view their profile",
        description:       "As a user, I want to view my profile information",
        acceptanceCriteria: ["Profile page loads", "Name and email are displayed"],
        storyType:         "feature",
        priority:          "medium",
      },
    ];
  }
}
