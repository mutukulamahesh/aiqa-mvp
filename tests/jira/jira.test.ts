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
  // Access internal client via a subclass that exposes it for testing
  const adapter = new JiraAdapter({
    baseUrl:    "https://test.atlassian.net",
    email:      "user@test.com",
    apiToken:   "token123",
    projectKey: "AIQA",
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
    let callCount = 0;
    const adapter = makeAdapterWithTransport(() => {
      callCount++;
      return { status: 201, json: { id: `1000${callCount}`, key: `AIQA-${100 + callCount}` } };
    });

    const summary = await adapter.pushResults([
      { testName: "Login smoke",     passed: false, error: "Timeout waiting for selector" },
      { testName: "Dashboard loads", passed: true },
      { testName: "Checkout flow",   passed: false, error: "AssertionError: expected 200 got 500" },
    ]);

    expect(summary.created).toHaveLength(2);
    expect(summary.skipped).toBe(1);
    expect(callCount).toBe(2);
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
    const adapter = makeAdapterWithTransport((_opts, body) => {
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
});
