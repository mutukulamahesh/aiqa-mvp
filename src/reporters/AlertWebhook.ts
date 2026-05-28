import * as http  from "http";
import * as https from "https";

export interface WebhookPayload {
  runId:    string;
  passed:   number;
  failed:   number;
  total:    number;
  failures: Array<{ testName: string; error?: string }>;
}

export function buildWebhookBody(webhookUrl: string, payload: WebhookPayload): unknown {
  const { hostname } = new URL(webhookUrl);
  const summary = `AIQA: ${payload.failed}/${payload.total} tests failed (run ${payload.runId})`;
  const failureLines = payload.failures
    .map(f => `• ${f.testName}${f.error ? `: ${f.error}` : ""}`)
    .join("\n");

  if (hostname === "hooks.slack.com") {
    return {
      text: summary,
      attachments: [{
        color: "danger",
        fields: [
          { title: "Passed",   value: String(payload.passed), short: true },
          { title: "Failed",   value: String(payload.failed), short: true },
          { title: "Run ID",   value: payload.runId,          short: true },
          { title: "Failures", value: failureLines || "—",    short: false },
        ],
      }],
    };
  }

  if (hostname.endsWith("webhook.office.com")) {
    return {
      "@type":    "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "FF0000",
      summary,
      sections: [{
        activityTitle:    summary,
        activitySubtitle: `Passed: ${payload.passed}  Failed: ${payload.failed}  Total: ${payload.total}`,
        facts: payload.failures.map(f => ({ name: f.testName, value: f.error ?? "failed" })),
      }],
    };
  }

  if (hostname === "events.pagerduty.com") {
    const parsed     = new URL(webhookUrl);
    const routingKey = parsed.searchParams.get("routing_key") ?? "";
    return {
      routing_key:  routingKey,
      event_action: "trigger",
      dedup_key:    payload.runId,
      payload: {
        summary,
        severity: "error",
        source:   "aiqa",
        custom_details: {
          passed:   payload.passed,
          failed:   payload.failed,
          total:    payload.total,
          failures: payload.failures.map(f => f.testName),
        },
      },
    };
  }

  return { status: "failed", ...payload };
}

export async function postAlertWebhook(webhookUrl: string, payload: WebhookPayload): Promise<void> {
  const body   = buildWebhookBody(webhookUrl, payload);
  const data   = Buffer.from(JSON.stringify(body));
  const parsed = new URL(webhookUrl);
  const lib    = parsed.protocol === "https:" ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
        path:     parsed.pathname + parsed.search,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        res.resume();
        (res.statusCode ?? 0) >= 400
          ? reject(new Error(`Webhook returned HTTP ${res.statusCode}`))
          : resolve();
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("Webhook timeout")));
    req.write(data);
    req.end();
  });
}
