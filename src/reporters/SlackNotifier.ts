import * as https from "https";
import * as http  from "http";

export interface SlackRunSummary {
  runId:      string;
  passed:     number;
  failed:     number;
  total:      number;
  score:      number;
  grade:      string;
  durationMs: number;
  baseUrl?:   string;
  reportUrl?: string;
}

// Slack Block Kit field limit is 2000 chars; header plain_text limit is 150.
const FIELD_MAX  = 2000;
const HEADER_MAX = 150;

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  // Scan back up to 20 chars to avoid cutting mid-word or mid-markdown-token (*bold*, `code`)
  let cut = max - 1;
  const floor = Math.max(cut - 20, 0);
  while (cut > floor && s[cut] !== " " && s[cut] !== "\n") cut--;
  if (cut <= floor) cut = max - 1; // no safe boundary found — hard cut
  return s.slice(0, cut) + "…";
}

export class SlackNotifier {
  private readonly webhookUrl: string;
  readonly onFailureOnly: boolean;

  constructor(webhookUrl: string, onFailureOnly = false) {
    if (!webhookUrl) throw new Error("SlackNotifier: webhookUrl is required");
    this.webhookUrl    = webhookUrl;
    this.onFailureOnly = onFailureOnly;
  }

  static fromEnv(): SlackNotifier | null {
    const u = process.env.SLACK_WEBHOOK_URL;
    if (!u) return null;
    return new SlackNotifier(u, process.env.SLACK_ON_FAILURE_ONLY === "true");
  }

  /** Never throws — logs warning on failure so the test run is never affected. */
  async send(summary: SlackRunSummary): Promise<void> {
    try {
      await this._send(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[notify] Slack failed: ${msg}\n`);
    }
  }

  private async _send(summary: SlackRunSummary): Promise<void> {
    if (this.onFailureOnly && summary.failed === 0) return;

    const icon   = summary.failed === 0 ? "✅" : "❌";
    const status = summary.failed === 0 ? "All tests passed" : `${summary.failed} test(s) failed`;
    const pct    = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: trunc(`${icon} AIQA Run Complete`, HEADER_MAX) },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: trunc(`*Status*\n${status}`, FIELD_MAX) },
          { type: "mrkdwn", text: trunc(`*Score*\n${summary.score}/100  (${summary.grade})`, FIELD_MAX) },
          { type: "mrkdwn", text: trunc(`*Tests*\n${summary.passed}/${summary.total} passed  (${pct}%)`, FIELD_MAX) },
          { type: "mrkdwn", text: trunc(`*Duration*\n${(summary.durationMs / 1000).toFixed(1)}s`, FIELD_MAX) },
        ],
      },
    ];

    if (summary.baseUrl) {
      const contextText = trunc(`App: ${summary.baseUrl}  ·  Run ID: \`${summary.runId}\``, FIELD_MAX);
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: contextText }],
      });
    }

    if (summary.reportUrl) {
      blocks.push({
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View Report" },
          url:  summary.reportUrl,
        }],
      });
    }

    await this.post(JSON.stringify({ blocks }));
  }

  private post(body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed  = new URL(this.webhookUrl);
      const isHttps = parsed.protocol === "https:";
      const options = {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      };

      const req = (isHttps ? https : http).request(options, res => {
        res.resume();
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Slack webhook returned HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      });

      req.setTimeout(30_000, () => req.destroy(new Error("Slack webhook timed out after 30 s")));
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
