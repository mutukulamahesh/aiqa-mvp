import * as nodemailer from "nodemailer";
import * as fs from "fs";

export interface EmailConfig {
  host:     string;
  port:     number;
  secure:   boolean;
  user:     string;
  pass:     string;
  from:     string;
  to:       string[];
  onFailureOnly?: boolean;
}

export interface EmailRunSummary {
  runId:       string;
  passed:      number;
  failed:      number;
  total:       number;
  score:       number;
  grade:       string;
  durationMs:  number;
  baseUrl?:    string;
  reportPath?: string;
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export class EmailNotifier {
  private readonly config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  static fromEnv(to?: string[]): EmailNotifier | null {
    const host = process.env.SMTP_HOST;
    if (!host) return null;

    const recipients = to?.length
      ? to
      : (process.env.NOTIFY_EMAIL ?? "").split(",").map(s => s.trim()).filter(Boolean);

    if (!recipients.length) return null;

    return new EmailNotifier({
      host,
      port:          parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure:        process.env.SMTP_SECURE === "true",
      user:          process.env.SMTP_USER ?? "",
      pass:          process.env.SMTP_PASS ?? "",
      from:          process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "aiqa@noreply.local",
      to:            recipients,
      onFailureOnly: process.env.EMAIL_ON_FAILURE_ONLY === "true",
    });
  }

  /** Never throws — logs warning on failure so the test run is never affected. */
  async send(summary: EmailRunSummary): Promise<void> {
    try {
      await this._send(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[notify] Email failed: ${msg}\n`);
    }
  }

  private async _send(summary: EmailRunSummary): Promise<void> {
    if (this.config.onFailureOnly && summary.failed === 0) return;

    const transporter = nodemailer.createTransport({
      host:   this.config.host,
      port:   this.config.port,
      secure: this.config.secure,
      auth:   { user: this.config.user, pass: this.config.pass },
    });

    const pct    = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
    const status = summary.failed === 0 ? "PASSED" : "FAILED";
    const color  = summary.failed === 0 ? "#22c55e" : "#ef4444";

    const attachments: { filename: string; path: string; contentType: string }[] = [];
    let   reportNote = "";

    if (summary.reportPath && fs.existsSync(summary.reportPath)) {
      const sizeBytes = fs.statSync(summary.reportPath).size;
      if (sizeBytes <= MAX_ATTACHMENT_BYTES) {
        attachments.push({ filename: "aiqa-report.html", path: summary.reportPath, contentType: "text/html" });
      } else {
        const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
        reportNote   = `Report too large to attach (${sizeMb} MB) — Run ID: ${summary.runId} — see artifacts at: ${summary.reportPath}`;
      }
    }

    await transporter.sendMail({
      from:        this.config.from,
      to:          this.config.to.join(", "),
      subject:     `AIQA ${status}: ${summary.passed}/${summary.total} passed — ${summary.baseUrl ?? summary.runId}`,
      html:        this.buildHtml(summary, pct, color, reportNote),
      attachments,
    });
  }

  private buildHtml(summary: EmailRunSummary, pct: number, color: string, reportNote: string): string {
    const attachLine = reportNote
      ? `<p style="margin-top:16px;font-size:13px;color:#b45309;">${reportNote}</p>`
      : summary.reportPath
        ? `<p style="margin-top:16px;font-size:13px;color:#6b7280;">Full HTML report attached.</p>`
        : "";

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9fafb;padding:24px;">
  <div style="max-width:560px;margin:auto;background:white;border-radius:8px;
              box-shadow:0 1px 4px rgba(0,0,0,.1);overflow:hidden;">
    <div style="background:${color};padding:20px 24px;color:white;">
      <h2 style="margin:0;font-size:20px;">AIQA Test Run Complete</h2>
      ${summary.baseUrl ? `<p style="margin:4px 0 0;opacity:.9;font-size:14px;">${summary.baseUrl}</p>` : ""}
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Tests passed</td>
          <td style="padding:8px 0;font-weight:bold;">${summary.passed} / ${summary.total} (${pct}%)</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Score</td>
          <td style="padding:8px 0;font-weight:bold;">${summary.score}/100 (${summary.grade})</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Duration</td>
          <td style="padding:8px 0;">${(summary.durationMs / 1000).toFixed(1)}s</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Run ID</td>
          <td style="padding:8px 0;font-family:monospace;font-size:13px;">${summary.runId}</td>
        </tr>
      </table>
      ${attachLine}
    </div>
  </div>
</body>
</html>`;
  }
}
