import * as http  from "http";
import { EventEmitter } from "events";
import { JiraClient, JiraIssue, JiraSearchResult, HttpTransport } from "../../src/integrations/JiraClient";
import { JiraAdapter } from "../../src/integrations/JiraAdapter";

// ── Transport factory ─────────────────────────────────────────────────────────

type Handler = (opts: http.RequestOptions, body: string) => { status: number; json: unknown };

function makeTransport(handler: Handler): HttpTransport {
  return (options, callback) => {
    let requestBody = "";

    const fakeReq = {
      write: (chunk: string) => { requestBody += chunk; },
      end:   () => {
        const { status, json } = handler(options, requestBody);
        const text = JSON.stringify(json);

        const fakeRes = Object.assign(new EventEmitter(), { statusCode: status });
        if (callback) callback(fakeRes as unknown as http.IncomingMessage);

        setImmediate(() => {
          fakeRes.emit("data", Buffer.from(text, "utf-8"));
          fakeRes.emit("end");
        });
      },
      on: (_ev: string, _cb: unknown) => fakeReq,
    };

    return fakeReq as unknown as http.ClientRequest;
  };
}

function makeClient(handler: Handler): JiraClient {
  return new JiraClient(
    "https://test.atlassian.net",
    "user@test.com",
    "token123",
    makeTransport(handler),
  );
}

// ── JiraClient ────────────────────────────────────────────────────────────────

describe("JiraClient", () => {
  test("searchIssues — parses response correctly", async () => {
    const mockIssue: JiraIssue = {
      id: "10001", key: "AIQA-1",
      fields: {
        summary:   "Login test story",
        status:    { name: "To Do" },
        priority:  { name: "High" },
        issuetype: { name: "Story" },
      },
    };
    const mockResult: JiraSearchResult = { issues: [mockIssue], total: 1, maxResults: 50 };

    const client = makeClient(() => ({ status: 200, json: mockResult }));
    const result = await client.searchIssues('project = "AIQA"');

    expect(result.total).toBe(1);
    expect(result.issues[0].key).toBe("AIQA-1");
    expect(result.issues[0].fields.summary).toBe("Login test story");
  });

  test("createIssue — sends correct payload and returns key", async () => {
    let capturedBody = "";
    const client = makeClient((_opts, body) => {
      capturedBody = body;
      return { status: 201, json: { id: "10002", key: "AIQA-2" } };
    });

    const result = await client.createIssue({
      project:   { key: "AIQA" },
      issuetype: { name: "Bug" },
      summary:   "[AIQA] Test failed: Login smoke",
      priority:  { name: "High" },
      labels:    ["aiqa-auto"],
    });

    expect(result.key).toBe("AIQA-2");
    const payload = JSON.parse(capturedBody);
    expect(payload.fields.summary).toBe("[AIQA] Test failed: Login smoke");
    expect(payload.fields.issuetype.name).toBe("Bug");
    expect(payload.fields.labels).toContain("aiqa-auto");
  });

  test("request — rejects on HTTP 4xx with error message", async () => {
    const client = makeClient(() => ({
      status: 403,
      json:   { errorMessages: ["You do not have permission"], errors: {} },
    }));

    await expect(client.getProject("AIQA")).rejects.toThrow(/HTTP 403/);
  });

  test("addComment — sends ADF body", async () => {
    let capturedBody = "";
    const client = makeClient((_opts, body) => {
      capturedBody = body;
      return { status: 201, json: { id: "comment-1" } };
    });

    await client.addComment("AIQA-1", "Test failed on CI pipeline");

    const payload = JSON.parse(capturedBody);
    expect(payload.body.type).toBe("doc");
    expect(payload.body.content[0].type).toBe("paragraph");
    expect(payload.body.content[0].content[0].text).toBe("Test failed on CI pipeline");
  });

  test("getTransitions — returns transitions array", async () => {
    const client = makeClient(() => ({
      status: 200,
      json: {
        transitions: [
          { id: "11", name: "To Do" },
          { id: "21", name: "In Progress" },
          { id: "31", name: "Done" },
        ],
      },
    }));

    const transitions = await client.getTransitions("AIQA-1");
    expect(transitions).toHaveLength(3);
    expect(transitions[2].name).toBe("Done");
  });

  test("Authorization header uses base64 of email:token", async () => {
    let capturedAuth = "";
    const client = new JiraClient(
      "https://test.atlassian.net",
      "user@test.com",
      "mytoken",
      makeTransport((opts) => {
        capturedAuth = (opts.headers as Record<string, string>)["Authorization"] ?? "";
        return { status: 200, json: { key: "AIQA", name: "AIQA Project" } };
      }),
    );

    await client.getProject("AIQA");
    const expected = "Basic " + Buffer.from("user@test.com:mytoken").toString("base64");
    expect(capturedAuth).toBe(expected);
  });
});

// ── JiraAdapter — mock mode ───────────────────────────────────────────────────

describe("JiraAdapter — mock mode", () => {
  test("fetchStories returns 3 mock stories when no credentials", async () => {
    const adapter = new JiraAdapter({ useMock: true, projectKey: "DEMO" });
    const stories = await adapter.fetchStories();
    expect(stories).toHaveLength(3);
    expect(stories[0].id).toBe("DEMO-1");
    expect(stories[0].storyType).toBe("feature");
  });

  test("fetchStories uses provided projectKey as story ID prefix", async () => {
    const adapter = new JiraAdapter({ useMock: true });
    const stories = await adapter.fetchStories("MYPROJ");
    expect(stories[0].id).toBe("MYPROJ-1");
  });

  test("pushResults skips passed tests and returns empty created list", async () => {
    const adapter = new JiraAdapter({ useMock: true });
    const summary = await adapter.pushResults([
      { testName: "Login",     passed: true },
      { testName: "Dashboard", passed: true },
    ]);
    expect(summary.created).toHaveLength(0);
    expect(summary.commented).toHaveLength(0);
    expect(summary.failed).toHaveLength(0);
    expect(summary.skipped).toBe(2);
  });

  test("pushResults in mock mode does not throw for failed tests", async () => {
    const adapter = new JiraAdapter({ useMock: true });
    const summary = await adapter.pushResults([
      { testName: "Checkout", passed: false, error: "Element not found" },
    ]);
    expect(summary.created).toHaveLength(0);
    expect(summary.skipped).toBe(0);
  });

  test("convertToFlows generates authentication flow for login story", async () => {
    const adapter = new JiraAdapter({ useMock: true });
    const stories = await adapter.fetchStories("AIQA");
    const flows   = await adapter.convertToFlows(stories);

    expect(flows).toHaveLength(3);
    const loginFlow = flows[0];
    expect(loginFlow.type).toBe("authentication");
    expect(loginFlow.steps.some(s => s.action === "navigate")).toBe(true);
    expect(loginFlow.steps.some(s => s.action === "click")).toBe(true);
  });

  test("convertToFlows generates form_submission flow for register story", async () => {
    const adapter = new JiraAdapter({ useMock: true });
    const stories = await adapter.fetchStories("AIQA");
    const flows   = await adapter.convertToFlows(stories);

    const registerFlow = flows[1];
    expect(registerFlow.type).toBe("form_submission");
    expect(registerFlow.steps.some(s => s.action === "fill")).toBe(true);
  });
});

// ── JiraAdapter — real client (injectable transport) ─────────────────────────

function makeAdapterWithTransport(handler: Handler): JiraAdapter {
  const transport = makeTransport(handler);
  // throttleMs: 0 disables inter-call delays so tests run at full speed
  const adapter = new JiraAdapter({
    baseUrl:    "https://test.atlassian.net",
    email:      "user@test.com",
    apiToken:   "token123",
    projectKey: "AIQA",
    throttleMs: 0,
  });
  // Patch the private client with one that uses our test transport
  (adapter as unknown as { client: JiraClient }).client = new JiraClient(
    "https://test.atlassian.net",
    "user@test.com",
    "token123",
    transport,
  );
  return adapter;
}

/** Minimal valid JiraSearchResult with no issues (used in dedup search stubs). */
const NO_DUPLICATES = { issues: [], total: 0, maxResults: 50 };

describe("JiraAdapter — real client (injectable transport)", () => {
  test("fetchStories calls searchIssues and maps priority correctly", async () => {
    const adapter = makeAdapterWithTransport(() => ({
      status: 200,
      json: {
        issues: [
          {
            id: "10010", key: "AIQA-10",
            fields: {
              summary:     "User can checkout",
              status:      { name: "To Do" },
              priority:    { name: "Critical" },
              issuetype:   { name: "Story" },
              description: null,
            },
          },
        ],
        total: 1, maxResults: 50,
      },
    }));

    const stories = await adapter.fetchStories();
    expect(stories[0].id).toBe("AIQA-10");
    expect(stories[0].priority).toBe("high");
    expect(stories[0].storyType).toBe("feature");
  });

  test("pushResults creates one bug per failed test", async () => {
    let createCount = 0;
    const adapter = makeAdapterWithTransport((opts) => {
      if (opts.method === "GET") {
        // dedup search — no existing issues
        return { status: 200, json: NO_DUPLICATES };
      }
      createCount++;
      return { status: 201, json: { id: `1000${createCount}`, key: `AIQA-${100 + createCount}` } };
    });

    const summary = await adapter.pushResults([
      { testName: "Login smoke",     passed: false, error: "Timeout waiting for selector" },
      { testName: "Dashboard loads", passed: true },
      { testName: "Checkout flow",   passed: false, error: "AssertionError: expected 200 got 500" },
    ]);

    expect(summary.created).toHaveLength(2);
    expect(summary.commented).toHaveLength(0);
    expect(summary.failed).toHaveLength(0);
    expect(summary.skipped).toBe(1);
    expect(createCount).toBe(2);
  });

  test("pushResults skips all when no failures", async () => {
    let callCount = 0;
    const adapter = makeAdapterWithTransport(() => { callCount++; return { status: 201, json: {} }; });

    const summary = await adapter.pushResults([
      { testName: "Login",  passed: true },
      { testName: "Signup", passed: true },
    ]);

    expect(callCount).toBe(0);
    expect(summary.created).toHaveLength(0);
    expect(summary.skipped).toBe(2);
  });

  test("pushResults adds comment when duplicate fingerprint found (dedup)", async () => {
    let commentBody = "";
    const adapter = makeAdapterWithTransport((opts, body) => {
      if (opts.method === "GET") {
        // dedup search returns one existing open issue
        return {
          status: 200,
          json: {
            issues: [{
              id: "10001", key: "AIQA-100",
              fields: {
                summary:   "[AIQA] Test failed: Login",
                status:    { name: "Open" },
                priority:  { name: "High" },
                issuetype: { name: "Bug" },
              },
            }],
            total: 1, maxResults: 50,
          },
        };
      }
      // POST to comment endpoint
      commentBody = body;
      return { status: 201, json: { id: "comment-99" } };
    });

    const summary = await adapter.pushResults([
      { testName: "Login smoke", passed: false, error: "Timeout" },
    ]);

    expect(summary.created).toHaveLength(0);
    expect(summary.commented).toHaveLength(1);
    expect(summary.commented[0]).toBe("AIQA-100");
    expect(summary.failed).toHaveLength(0);
    expect(commentBody).toContain("Timeout");
  });

  test("pushResults continues after a Jira API error (partial failure)", async () => {
    let createCount = 0;
    const adapter = makeAdapterWithTransport((opts) => {
      if (opts.method === "GET") {
        return { status: 200, json: NO_DUPLICATES };
      }
      createCount++;
      if (createCount === 1) {
        // First create fails with a 500
        return { status: 500, json: { errorMessages: ["Internal Server Error"] } };
      }
      return { status: 201, json: { id: "10002", key: "AIQA-102" } };
    });

    const summary = await adapter.pushResults([
      { testName: "Login smoke",   passed: false, error: "Timeout" },
      { testName: "Checkout flow", passed: false, error: "Not found" },
    ]);

    expect(summary.created).toHaveLength(1);
    expect(summary.created[0]).toBe("AIQA-102");
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].testName).toBe("Login smoke");
  });

  test("syncXrayResults sends to Xray endpoint path", async () => {
    let capturedPath = "";
    const adapter = makeAdapterWithTransport((opts) => {
      capturedPath = opts.path ?? "";
      return { status: 200, json: { testExecIssue: { key: "AIQA-99" } } };
    });

    await adapter.syncXrayResults("AIQA-99", [
      { testName: "Login",    passed: true,  testKey: "AIQA-10" },
      { testName: "Checkout", passed: false, testKey: "AIQA-11", error: "failed" },
    ]);

    expect(capturedPath).toContain("raven");
  });

  test("bug description uses ADF format", async () => {
    let capturedBody = "";
    const adapter = makeAdapterWithTransport((opts, body) => {
      if (opts.method === "GET") {
        return { status: 200, json: NO_DUPLICATES };
      }
      capturedBody = body;
      return { status: 201, json: { id: "10099", key: "AIQA-99" } };
    });

    await adapter.pushResults([
      { testName: "Payment flow", passed: false, error: "Expected 200, got 500" },
    ]);

    const payload = JSON.parse(capturedBody);
    expect(payload.fields.description.type).toBe("doc");
    expect(payload.fields.description.version).toBe(1);
  });

  test("created issues carry aiqa and fingerprint labels", async () => {
    let capturedBody = "";
    const adapter = makeAdapterWithTransport((opts, body) => {
      if (opts.method === "GET") return { status: 200, json: NO_DUPLICATES };
      capturedBody = body;
      return { status: 201, json: { id: "10010", key: "AIQA-10" } };
    });

    await adapter.pushResults([
      { testName: "Login smoke", passed: false, error: "TimeoutError: selector" },
    ]);

    const payload = JSON.parse(capturedBody);
    expect(payload.fields.labels).toContain("aiqa");
    expect(payload.fields.labels).toContain("aiqa-auto");
    expect(payload.fields.labels.some((l: string) => l.startsWith("aiqa-fp-"))).toBe(true);
    expect(payload.fields.labels.some((l: string) => l.startsWith("aiqa-test-"))).toBe(true);
  });

  test("dedup search failure falls back to create (non-fatal)", async () => {
    let createCount = 0;
    const adapter = makeAdapterWithTransport((opts) => {
      if (opts.method === "GET") {
        // search returns HTTP 500 — should be treated as "no duplicate"
        return { status: 500, json: { errorMessages: ["Search service unavailable"] } };
      }
      createCount++;
      return { status: 201, json: { id: "10001", key: "AIQA-101" } };
    });

    const summary = await adapter.pushResults([
      { testName: "Smoke test", passed: false, error: "Timed out" },
    ]);

    // Should create a new issue despite the search failure
    expect(summary.created).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
    expect(createCount).toBe(1);
  });

  test("attachFile — sends multipart/form-data to the attachments endpoint", async () => {
    let capturedPath    = "";
    let capturedHeaders: Record<string, string | number | string[]> = {};
    const client = new JiraClient(
      "https://test.atlassian.net",
      "user@test.com",
      "token123",
      makeTransport((opts) => {
        capturedPath    = opts.path ?? "";
        capturedHeaders = (opts.headers ?? {}) as Record<string, string | number | string[]>;
        return { status: 200, json: [{ id: "att-1", filename: "fail.png" }] };
      }),
    );

    // Write a tiny temp PNG so attachFile can read a real file
    const tmpFile = require("path").join(require("os").tmpdir(), `aiqa-test-${Date.now()}.png`);
    require("fs").writeFileSync(tmpFile, Buffer.from([137, 80, 78, 71])); // PNG magic bytes
    try {
      await client.attachFile("AIQA-1", tmpFile);
    } finally {
      require("fs").unlinkSync(tmpFile);
    }

    expect(capturedPath).toContain("/attachments");
    expect(String(capturedHeaders["X-Atlassian-Token"])).toBe("no-check");
    expect(String(capturedHeaders["Content-Type"])).toContain("multipart/form-data");
  });

  test("attachFile — rejects files larger than 50 MB before reading them", async () => {
    const client = new JiraClient(
      "https://test.atlassian.net",
      "user@test.com",
      "token123",
      makeTransport(() => ({ status: 200, json: [] })),
    );

    // Create a temp file then lie about its size via a spy on fs.statSync
    const tmpFile = require("path").join(require("os").tmpdir(), `aiqa-big-${Date.now()}.png`);
    require("fs").writeFileSync(tmpFile, Buffer.alloc(4));
    const fsMod = require("fs");
    const original = fsMod.statSync;
    fsMod.statSync = () => ({ size: 51 * 1024 * 1024 });

    try {
      await expect(client.attachFile("AIQA-1", tmpFile)).rejects.toThrow(/50 MB limit/);
    } finally {
      fsMod.statSync = original;
      require("fs").unlinkSync(tmpFile);
    }
  });

  test("pushResults attaches screenshot to new bug when screenshotPath provided", async () => {
    let attachCalled = false;
    let attachedPath = "";
    const adapter = makeAdapterWithTransport((opts, _body) => {
      if (opts.method === "GET")  return { status: 200, json: NO_DUPLICATES };
      if (opts.path?.includes("/attachments")) {
        attachCalled = true;
        // Capture filename from Content-Type or path
        attachedPath = opts.path;
        return { status: 200, json: [{ id: "att-1" }] };
      }
      return { status: 201, json: { id: "10001", key: "AIQA-101" } };
    });

    const tmpFile = require("path").join(require("os").tmpdir(), `aiqa-ss-${Date.now()}.png`);
    require("fs").writeFileSync(tmpFile, Buffer.from([137, 80, 78, 71]));
    try {
      const summary = await adapter.pushResults([
        { testName: "Login smoke", passed: false, error: "Timeout", screenshotPath: tmpFile },
      ]);
      expect(summary.created).toHaveLength(1);
      expect(attachCalled).toBe(true);
      expect(attachedPath).toContain("/attachments");
    } finally {
      require("fs").unlinkSync(tmpFile);
    }
  });
});

// ── Acceptance criteria extraction ────────────────────────────────────────────

describe("JiraAdapter — acceptance criteria extraction", () => {
  test("extracts list items from ADF bulletList", async () => {
    const adapter = makeAdapterWithTransport(() => ({
      status: 200,
      json: {
        issues: [{
          id: "1", key: "AIQA-1",
          fields: {
            summary:   "Login flow",
            status:    { name: "To Do" },
            priority:  { name: "High" },
            issuetype: { name: "Story" },
            description: {
              type: "doc", version: 1,
              content: [{
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Login form is displayed" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Valid credentials grant access" }] }] },
                ],
              }],
            },
          },
        }],
        total: 1, maxResults: 50,
      },
    }));
    const stories = await adapter.fetchStories();
    expect(stories[0].acceptanceCriteria).toHaveLength(2);
    expect(stories[0].acceptanceCriteria[0]).toBe("Login form is displayed");
    expect(stories[0].acceptanceCriteria[1]).toBe("Valid credentials grant access");
  });

  test("extracts list items that follow an Acceptance Criteria heading", async () => {
    const adapter = makeAdapterWithTransport(() => ({
      status: 200,
      json: {
        issues: [{
          id: "1", key: "AIQA-2",
          fields: {
            summary:   "Checkout flow",
            status:    { name: "To Do" },
            priority:  { name: "Medium" },
            issuetype: { name: "Story" },
            description: {
              type: "doc", version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Background description here." }] },
                { type: "heading",   attrs: { level: 2 }, content: [{ type: "text", text: "Acceptance Criteria" }] },
                {
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Cart shows item count" }] }] },
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Checkout button is enabled" }] }] },
                  ],
                },
                { type: "heading",   attrs: { level: 2 }, content: [{ type: "text", text: "Notes" }] },
                {
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Should not be included" }] }] },
                  ],
                },
              ],
            },
          },
        }],
        total: 1, maxResults: 50,
      },
    }));
    const stories = await adapter.fetchStories();
    expect(stories[0].acceptanceCriteria).toHaveLength(2);
    expect(stories[0].acceptanceCriteria[0]).toBe("Cart shows item count");
    // Items under the "Notes" heading must not bleed into AC
    expect(stories[0].acceptanceCriteria).not.toContain("Should not be included");
  });

  test("extracts AC from plain-text customfield_10016 when present", async () => {
    const adapter = makeAdapterWithTransport(() => ({
      status: 200,
      json: {
        issues: [{
          id: "1", key: "AIQA-3",
          fields: {
            summary:           "Profile page",
            status:            { name: "To Do" },
            priority:          { name: "Low" },
            issuetype:         { name: "Story" },
            description:       null,
            customfield_10016: "- Profile loads\n- Name is displayed\n- Email is displayed",
          },
        }],
        total: 1, maxResults: 50,
      },
    }));
    const stories = await adapter.fetchStories();
    expect(stories[0].acceptanceCriteria).toHaveLength(3);
    expect(stories[0].acceptanceCriteria[0]).toBe("Profile loads");
  });

  test("returns empty AC when description has no lists and no custom field", async () => {
    const adapter = makeAdapterWithTransport(() => ({
      status: 200,
      json: {
        issues: [{
          id: "1", key: "AIQA-4",
          fields: {
            summary:   "Simple story",
            status:    { name: "To Do" },
            priority:  { name: "Medium" },
            issuetype: { name: "Story" },
            description: {
              type: "doc", version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "No criteria here." }] }],
            },
          },
        }],
        total: 1, maxResults: 50,
      },
    }));
    const stories = await adapter.fetchStories();
    expect(stories[0].acceptanceCriteria).toHaveLength(0);
  });
});

// ── Sprint filter ─────────────────────────────────────────────────────────────

describe("JiraAdapter — sprint filter", () => {
  test("fetchStories with sprintId adds sprint clause to JQL", async () => {
    let capturedPath = "";
    const adapter = makeAdapterWithTransport((opts) => {
      capturedPath = opts.path ?? "";
      return { status: 200, json: { issues: [], total: 0, maxResults: 50 } };
    });

    await adapter.fetchStories("AIQA", "42");
    expect(decodeURIComponent(capturedPath)).toContain('sprint = "42"');
  });

  test("fetchStories without sprintId omits sprint clause", async () => {
    let capturedPath = "";
    const adapter = makeAdapterWithTransport((opts) => {
      capturedPath = opts.path ?? "";
      return { status: 200, json: { issues: [], total: 0, maxResults: 50 } };
    });

    await adapter.fetchStories("AIQA");
    expect(decodeURIComponent(capturedPath)).not.toContain("sprint");
  });
});
