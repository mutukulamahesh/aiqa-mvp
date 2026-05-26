import * as http from "http";
import { buildWebhookBody, postAlertWebhook, WebhookPayload } from "../../src/reporters/AlertWebhook";

const basePayload: WebhookPayload = {
  runId:    "run-001",
  passed:   8,
  failed:   2,
  total:    10,
  failures: [
    { testName: "Login test",    error: "Element not found" },
    { testName: "Checkout test", error: undefined },
  ],
};

// ── buildWebhookBody ─────────────────────────────────────────────────────────

describe("buildWebhookBody — Slack", () => {
  const url  = "https://hooks.slack.com/services/T000/B000/xxx";
  const body = buildWebhookBody(url, basePayload) as Record<string, unknown>;

  test("sets text summary", () => {
    expect(body.text).toContain("2/10 tests failed");
    expect(body.text).toContain("run-001");
  });

  test("includes passed/failed fields in attachment", () => {
    const fields = (body.attachments as { fields: { title: string; value: string }[] }[])[0].fields;
    const passed = fields.find(f => f.title === "Passed");
    const failed = fields.find(f => f.title === "Failed");
    expect(passed?.value).toBe("8");
    expect(failed?.value).toBe("2");
  });

  test("attachment color is danger", () => {
    const att = (body.attachments as { color: string }[])[0];
    expect(att.color).toBe("danger");
  });

  test("lists failure names in Failures field", () => {
    const fields = (body.attachments as { fields: { title: string; value: string }[] }[])[0].fields;
    const failures = fields.find(f => f.title === "Failures");
    expect(failures?.value).toContain("Login test");
    expect(failures?.value).toContain("Element not found");
    expect(failures?.value).toContain("Checkout test");
  });
});

describe("buildWebhookBody — Teams", () => {
  const url  = "https://myorg.webhook.office.com/webhookb2/xxx";
  const body = buildWebhookBody(url, basePayload) as Record<string, unknown>;

  test("type is MessageCard", () => {
    expect(body["@type"]).toBe("MessageCard");
  });

  test("themeColor is red", () => {
    expect(body.themeColor).toBe("FF0000");
  });

  test("summary contains failure count", () => {
    expect(body.summary).toContain("2/10 tests failed");
  });

  test("facts list failure names", () => {
    const section = (body.sections as { facts: { name: string; value: string }[] }[])[0];
    const names   = section.facts.map(f => f.name);
    expect(names).toContain("Login test");
    expect(names).toContain("Checkout test");
  });

  test("activitySubtitle contains counts", () => {
    const section = (body.sections as { activitySubtitle: string }[])[0];
    expect(section.activitySubtitle).toContain("Passed: 8");
    expect(section.activitySubtitle).toContain("Failed: 2");
  });
});

describe("buildWebhookBody — PagerDuty", () => {
  const url  = "https://events.pagerduty.com/v2/enqueue?routing_key=abc123";
  const body = buildWebhookBody(url, basePayload) as Record<string, unknown>;

  test("event_action is trigger", () => {
    expect(body.event_action).toBe("trigger");
  });

  test("routing_key extracted from query param", () => {
    expect(body.routing_key).toBe("abc123");
  });

  test("dedup_key is runId", () => {
    expect(body.dedup_key).toBe("run-001");
  });

  test("payload severity is error", () => {
    const pd = body.payload as Record<string, unknown>;
    expect(pd.severity).toBe("error");
    expect(pd.source).toBe("aiqa");
  });

  test("custom_details contains failure names", () => {
    const pd      = body.payload as Record<string, unknown>;
    const details = pd.custom_details as { failures: string[] };
    expect(details.failures).toContain("Login test");
    expect(details.failures).toContain("Checkout test");
  });

  test("missing routing_key defaults to empty string", () => {
    const noKey = buildWebhookBody("https://events.pagerduty.com/v2/enqueue", basePayload) as Record<string, unknown>;
    expect(noKey.routing_key).toBe("");
  });
});

describe("buildWebhookBody — generic", () => {
  const url  = "https://my-internal-webhook.example.com/hook";
  const body = buildWebhookBody(url, basePayload) as Record<string, unknown>;

  test("status is failed", () => {
    expect(body.status).toBe("failed");
  });

  test("spreads runId, passed, failed, total", () => {
    expect(body.runId).toBe("run-001");
    expect(body.passed).toBe(8);
    expect(body.failed).toBe(2);
    expect(body.total).toBe(10);
  });
});

// ── postAlertWebhook (HTTP integration) ─────────────────────────────────────

describe("postAlertWebhook", () => {
  let server: http.Server;
  let port:   number;
  let lastBody: unknown;
  let respondWith: number;

  beforeEach(done => {
    respondWith = 200;
    lastBody    = null;
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => {
        lastBody = JSON.parse(raw);
        res.writeHead(respondWith);
        res.end();
      });
    });
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      done();
    });
  });

  afterEach(done => { server.close(done); });

  test("POSTs JSON body to the given URL", async () => {
    await postAlertWebhook(`http://localhost:${port}/hook`, basePayload);
    expect(lastBody).toMatchObject({ status: "failed", runId: "run-001" });
  });

  test("rejects when server returns 4xx", async () => {
    respondWith = 400;
    await expect(postAlertWebhook(`http://localhost:${port}/hook`, basePayload))
      .rejects.toThrow(/4\d\d/);
  });

  test("rejects on connection refused", async () => {
    await expect(postAlertWebhook("http://localhost:1/hook", basePayload))
      .rejects.toThrow();
  });
});
