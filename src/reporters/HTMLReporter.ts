import * as fs from "fs";
import * as path from "path";
import { TestResult } from "../runner/TestRunner";
import { ReadinessScorer } from "../agents/ReadinessScorer";

export interface ReportOptions {
  title?:   string;
  baseUrl?: string;
}

export class HTMLReporter {
  generate(results: TestResult[], outputPath: string, opts: ReportOptions = {}): void {
    const scorer  = new ReadinessScorer();
    const report  = scorer.score(results);
    const html    = this.buildHtml(results, report, opts);
    const dir     = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, html, "utf-8");
  }

  private buildHtml(
    results: TestResult[],
    report:  ReturnType<ReadinessScorer["score"]>,
    opts:    ReportOptions,
  ): string {
    const title     = opts.title   ?? "AIQA Test Report";
    const baseUrl   = opts.baseUrl ?? "";
    const generated = new Date().toLocaleString();
    const totalMs   = results.reduce((s, r) => s + r.durationMs, 0);

    const scoreColor =
      report.score >= 75 ? "#22c55e" :
      report.score >= 50 ? "#f59e0b" : "#ef4444";

    const testsHtml = results.map(r => this.testBlock(r)).join("\n");

    const coverageBadges = report.coverageLayers.length
      ? report.coverageLayers.map(l =>
          `<span class="cov-badge">${l}</span>`
        ).join(" ")
      : '<span class="cov-badge none">No coverage data</span>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${this.esc(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f1f5f9; color: #1e293b; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 700; }
  h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 12px; }

  .header { background: #0f172a; color: #f8fafc; padding: 24px 28px;
            border-radius: 12px; margin-bottom: 24px; }
  .header p { margin-top: 6px; font-size: 0.875rem; color: #94a3b8; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
             gap: 16px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 10px; padding: 20px 16px;
          text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card .value { font-size: 2rem; font-weight: 700; line-height: 1; margin-bottom: 4px; }
  .card .label { font-size: 0.8rem; color: #64748b; text-transform: uppercase;
                 letter-spacing: .05em; }
  .card.score  { border-top: 4px solid ${scoreColor}; }
  .card.pass   { border-top: 4px solid #22c55e; }
  .card.fail   { border-top: 4px solid #ef4444; }
  .card.time   { border-top: 4px solid #6366f1; }

  .coverage { background: #fff; border-radius: 10px; padding: 16px 20px;
              margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .cov-badge { display: inline-block; background: #e0f2fe; color: #0369a1;
               padding: 3px 10px; border-radius: 20px; font-size: 0.8rem;
               font-weight: 600; margin-right: 6px; }
  .cov-badge.none { background: #f1f5f9; color: #94a3b8; }

  .tests-section { margin-bottom: 24px; }
  .test { background: #fff; border-radius: 10px; margin-bottom: 10px;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
  .test-header { padding: 14px 18px; display: flex; align-items: center;
                 gap: 12px; cursor: pointer; user-select: none; }
  .test-header:hover { background: #f8fafc; }
  .test-header.pass { border-left: 5px solid #22c55e; }
  .test-header.fail { border-left: 5px solid #ef4444; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.pass { background: #22c55e; }
  .status-dot.fail { background: #ef4444; }
  .test-name { font-weight: 600; flex: 1; }
  .test-meta { font-size: 0.8rem; color: #94a3b8; }
  .chevron { transition: transform .2s; color: #94a3b8; font-size: 0.9rem; }

  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  details[open] .chevron { transform: rotate(90deg); }

  .steps { padding: 4px 18px 16px 18px; border-top: 1px solid #f1f5f9; }
  .step { display: flex; gap: 10px; align-items: flex-start;
          padding: 7px 0; font-size: 0.875rem; border-bottom: 1px solid #f8fafc; }
  .step:last-child { border-bottom: none; }
  .step-idx { color: #94a3b8; font-size: 0.75rem; min-width: 28px;
              padding-top: 2px; text-align: right; }
  .step-badge { padding: 2px 7px; border-radius: 4px; font-size: 0.75rem;
                font-weight: 700; white-space: nowrap; }
  .step-badge.pass { background: #dcfce7; color: #16a34a; }
  .step-badge.fail { background: #fee2e2; color: #dc2626; }
  .step-badge.skip { background: #f1f5f9; color: #94a3b8; }
  .step-action { font-family: monospace; background: #f8fafc; padding: 2px 6px;
                 border-radius: 4px; font-size: 0.8rem; color: #6366f1; }
  .step-detail { color: #475569; flex: 1; }
  .step-error { font-size: 0.8rem; color: #dc2626; margin-top: 3px; }

  .debug-box { background: #fffbeb; border-left: 3px solid #f59e0b;
               padding: 10px 14px; margin-top: 8px; border-radius: 0 6px 6px 0;
               font-size: 0.8rem; }
  .debug-box .d-class { font-weight: 700; color: #b45309; }
  .debug-box .d-fix   { color: #78350f; margin-top: 4px; }

  .footer { text-align: center; font-size: 0.8rem; color: #94a3b8; margin-top: 24px; }
</style>
</head>
<body>

<div class="header">
  <h1>${this.esc(title)}</h1>
  <p>Generated: ${generated}${baseUrl ? ` &nbsp;·&nbsp; ${this.esc(baseUrl)}` : ""}</p>
</div>

<div class="summary">
  <div class="card score">
    <div class="value" style="color:${scoreColor}">${report.score}<span style="font-size:1rem">/100</span></div>
    <div class="label">Score (${report.grade})</div>
  </div>
  <div class="card pass">
    <div class="value" style="color:#22c55e">${report.passed}</div>
    <div class="label">Passed</div>
  </div>
  <div class="card fail">
    <div class="value" style="color:#ef4444">${report.failed}</div>
    <div class="label">Failed</div>
  </div>
  <div class="card time">
    <div class="value" style="color:#6366f1">${(totalMs / 1000).toFixed(1)}s</div>
    <div class="label">Duration</div>
  </div>
</div>

<div class="coverage">
  <h2>Coverage</h2>
  ${coverageBadges}
  ${report.topIssues.length ? `<p style="margin-top:8px;font-size:.85rem;color:#64748b">${report.topIssues.join(" &nbsp;·&nbsp; ")}</p>` : ""}
  <p style="margin-top:10px;font-size:.875rem;color:#475569"><strong>Recommendation:</strong> ${this.esc(report.recommendation)}</p>
</div>

<div class="tests-section">
  <h2>Test Results</h2>
  ${testsHtml}
</div>

<div class="footer">Generated by AIQA — Enterprise AI QA Platform</div>

</body>
</html>`;
  }

  private testBlock(result: TestResult): string {
    const status   = result.passed ? "pass" : "fail";
    const icon     = result.passed ? "✅" : "❌";
    const stepsHtml = result.stepResults.map(s => this.stepRow(s)).join("\n");

    const debugHtml = result.debugResult
      ? `<div class="debug-box">
          <div class="d-class">🔍 ${this.esc(result.debugResult.failure_class.replace(/_/g, " "))}</div>
          <div class="d-fix">${this.esc(result.debugResult.suggested_fix)}</div>
        </div>`
      : "";

    return `<div class="test">
  <details>
    <summary class="test-header ${status}">
      <span class="status-dot ${status}"></span>
      <span class="test-name">${icon} ${this.esc(result.testName)}</span>
      <span class="test-meta">${result.stepResults.length} steps &nbsp;·&nbsp; ${result.durationMs}ms</span>
      <span class="chevron">▶</span>
    </summary>
    <div class="steps">
      ${stepsHtml}
      ${debugHtml}
      ${result.error ? `<p style="color:#dc2626;font-size:.85rem;margin-top:10px">Error: ${this.esc(result.error)}</p>` : ""}
    </div>
  </details>
</div>`;
  }

  private stepRow(step: { index: number; action: string; passed: boolean; durationMs: number; error?: string }): string {
    const badge = step.passed ? "pass" : "fail";
    const label = step.passed ? "PASS" : "FAIL";
    return `<div class="step">
      <span class="step-idx">${step.index + 1}</span>
      <span class="step-badge ${badge}">${label}</span>
      <span class="step-action">${this.esc(step.action)}</span>
      <span class="step-detail">${step.durationMs}ms${step.error ? `<div class="step-error">${this.esc(step.error)}</div>` : ""}</span>
    </div>`;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
