import { UserFlow, FlowStep } from "../agents/FlowMapper";

export interface JiraStory {
  id:                  string;
  title:               string;
  description:         string;
  acceptanceCriteria:  string[];
  storyType:           "feature" | "bug" | "improvement";
  priority:            "high" | "medium" | "low";
}

export interface JiraConfig {
  baseUrl?:    string;   // e.g. "https://yourcompany.atlassian.net"
  email?:      string;
  apiToken?:   string;
  projectKey?: string;
  useMock?:    boolean;  // default true when credentials are absent
}

export class JiraAdapter {
  private useMock: boolean;

  constructor(private config: JiraConfig = {}) {
    this.useMock =
      config.useMock ??
      !(config.baseUrl && config.email && config.apiToken);
  }

  // ── Fetch stories ─────────────────────────────────────────────────────────

  async fetchStories(projectKey?: string): Promise<JiraStory[]> {
    if (this.useMock) {
      console.log(`  [JiraAdapter] Using mock stories (no credentials configured)`);
      return this.mockStories(projectKey ?? this.config.projectKey ?? "DEMO");
    }

    // TODO: replace with real Jira REST API call when credentials are set
    // const url = `${this.config.baseUrl}/rest/api/3/search?jql=project=${projectKey}&fields=summary,description,priority`;
    // const response = await fetch(url, {
    //   headers: {
    //     Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64")}`,
    //     Accept: "application/json",
    //   },
    // });
    // const data = await response.json();
    // return this.parseJiraResponse(data);

    throw new Error(
      "[JiraAdapter] Real Jira integration not yet implemented. " +
      "Set useMock: true or provide baseUrl, email, and apiToken."
    );
  }

  // ── Convert stories → flows ───────────────────────────────────────────────

  async convertToFlows(stories: JiraStory[]): Promise<UserFlow[]> {
    return stories.map(story => this.storyToFlow(story));
  }

  // ── Push results back to Jira ─────────────────────────────────────────────

  async pushResults(_results: { testName: string; passed: boolean; error?: string }[]): Promise<void> {
    if (this.useMock) {
      console.log(`  [JiraAdapter] Mock mode — result push skipped`);
      return;
    }
    // TODO: implement Jira issue update / Xray test execution sync
    console.warn("[JiraAdapter] pushResults not yet implemented for real Jira.");
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

  // ── Conversion helpers ────────────────────────────────────────────────────

  private storyToFlow(story: JiraStory): UserFlow {
    const titleLower = story.title.toLowerCase();

    const type: UserFlow["type"] =
      titleLower.includes("log in") || titleLower.includes("login") || titleLower.includes("sign in")
        ? "authentication"
        : titleLower.includes("register") || titleLower.includes("sign up")
        ? "form_submission"
        : titleLower.includes("browse") || titleLower.includes("view") || titleLower.includes("see")
        ? "navigation"
        : "form_submission";

    const steps: FlowStep[] = this.acToSteps(story.acceptanceCriteria, type);

    return {
      name:        story.title,
      description: story.description,
      type,
      priority:    story.priority,
      pages:       [],
      steps,
    };
  }

  private acToSteps(criteria: string[], type: UserFlow["type"]): FlowStep[] {
    const steps: FlowStep[] = [];

    if (type === "authentication") {
      steps.push(
        { action: "navigate", target: "/login" },
        { action: "fill",     target: "email",    value: "testuser@example.com" },
        { action: "fill",     target: "password", value: "TestPassword123" },
        { action: "click",    target: "Sign in" },
        { action: "assert",   target: "url",      value: "dashboard" },
      );
    } else if (type === "form_submission") {
      steps.push(
        { action: "navigate", target: "/register" },
        { action: "fill",     target: "email",    value: "newuser@example.com" },
        { action: "fill",     target: "password", value: "NewPassword123" },
        { action: "click",    target: "Register" },
        { action: "assert",   target: "text",     value: "success" },
      );
    } else {
      steps.push(
        { action: "navigate", target: "/" },
        { action: "assert",   target: "text",     value: criteria[0]?.slice(0, 30) ?? "home" },
      );
    }

    return steps;
  }
}
