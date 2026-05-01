import * as fs from "fs";
import * as path from "path";
import { TestResult } from "../runner/TestRunner";
import { ReadinessScorer } from "../agents/ReadinessScorer";

export interface ReportOptions {
  title?:   string;
  baseUrl?: string;
}

const ACTION_COLORS: Record<string, string> = {
  navigate: "#3b82f6",
  click:    "#8b5cf6",
  fill:     "#0ea5e9",
  assert:   "#10b981",
  api:      "#f59e0b",
};

export class HTMLReporter {
  generate(results: TestResult[], outputPath: string, opts: ReportOptions = {}): void {
    const scorer   = new ReadinessScorer();
    const debugMap = new Map(
      results
        .filter(r => r.debugResult)
        .map(r => [r.testName, r.debugResult!])
    );
    const report  = scorer.score(results, debugMap);
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

    const passRate = results.length
      ? Math.round((report.passed / results.length) * 100)
      : 0;

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
            border-radius: 12px; margin-bottom: 24px;
            display: flex; align-items: center; justify-content: space-between; }
  .header-left p { margin-top: 6px; font-size: 0.875rem; color: #94a3b8; }
  .header-badge { background: #1e293b; border-radius: 8px; padding: 8px 16px;
                  text-align: center; }
  .header-badge .grade { font-size: 2rem; font-weight: 800; color: ${scoreColor}; line-height: 1; }
  .header-badge .grade-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase;
                                letter-spacing: .06em; margin-top: 2px; }

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

  .progress-bar { background: #e2e8f0; border-radius: 999px; height: 6px; margin-top: 8px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 999px; background: ${scoreColor}; width: ${passRate}%; }

  .coverage { background: #fff; border-radius: 10px; padding: 16px 20px;
              margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .cov-badge { display: inline-block; background: #e0f2fe; color: #0369a1;
               padding: 3px 10px; border-radius: 20px; font-size: 0.8rem;
               font-weight: 600; margin-right: 6px; }
  .cov-badge.none { background: #f1f5f9; color: #94a3b8; }

  .reco { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 10px 14px;
          border-radius: 0 6px 6px 0; margin-top: 10px; font-size: .875rem; color: #166534; }

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
  .tags { display: inline-flex; gap: 4px; margin-left: 8px; }
  .tag { background: #f1f5f9; color: #475569; border-radius: 4px; padding: 1px 6px;
         font-size: 0.7rem; font-weight: 600; }
  .chevron { transition: transform .2s; color: #94a3b8; font-size: 0.9rem; }

  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  details[open] .chevron { transform: rotate(90deg); }

  .steps { padding: 4px 18px 16px 18px; border-top: 1px solid #f1f5f9; }
  .step { padding: 8px 0; border-bottom: 1px solid #f8fafc; }
  .step:last-child { border-bottom: none; }
  .step-row { display: flex; gap: 10px; align-items: flex-start; font-size: 0.875rem; }
  .step-idx { color: #94a3b8; font-size: 0.75rem; min-width: 28px;
              padding-top: 3px; text-align: right; flex-shrink: 0; }
  .step-badge { padding: 2px 7px; border-radius: 4px; font-size: 0.75rem;
                font-weight: 700; white-space: nowrap; flex-shrink: 0; }
  .step-badge.pass { background: #dcfce7; color: #16a34a; }
  .step-badge.fail { background: #fee2e2; color: #dc2626; }
  .step-action { font-family: monospace; padding: 2px 7px;
                 border-radius: 4px; font-size: 0.8rem; color: #fff;
                 font-weight: 600; flex-shrink: 0; }
  .step-detail { color: #475569; flex: 1; font-size: 0.82rem; }
  .step-duration { color: #94a3b8; font-size: 0.75rem; margin-top: 2px; }
  .step-error { font-size: 0.8rem; color: #dc2626; margin-top: 4px; font-family: monospace;
                background: #fff5f5; padding: 4px 8px; border-radius: 4px; }

  .inline-debug { background: #fffbeb; border-left: 3px solid #f59e0b;
                  padding: 8px 12px; margin-top: 8px; border-radius: 0 6px 6px 0;
                  font-size: 0.8rem; }
  .inline-debug .d-class { font-weight: 700; color: #b45309; font-size: 0.75rem;
                            text-transform: uppercase; letter-spacing: .04em; }
  .inline-debug .d-fix   { color: #78350f; margin-top: 4px; line-height: 1.4; }

  .screenshot-wrap { margin-top: 10px; }
  .screenshot-wrap summary { font-size: 0.8rem; color: #6366f1; cursor: pointer;
                              user-select: none; margin-bottom: 6px; }
  .screenshot-wrap img { max-width: 100%; border-radius: 6px;
                          border: 1px solid #e2e8f0; display: block; }

  .footer { text-align: center; font-size: 0.8rem; color: #94a3b8; margin-top: 24px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>${this.esc(title)}</h1>
    <p>Generated: ${generated}${baseUrl ? ` &nbsp;·&nbsp; ${this.esc(baseUrl)}` : ""}</p>
    <div class="progress-bar" style="margin-top:12px;width:200px">
      <div class="progress-fill"></div>
    </div>
    <p style="font-size:.75rem;color:#94a3b8;margin-top:4px">${passRate}% pass rate</p>
  </div>
  <div class="header-badge">
    <div class="grade">${report.score}<span style="font-size:1rem">/100</span></div>
    <div class="grade-label">Score (${report.grade})</div>
  </div>
</div>

<div class="summary">
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
  <div class="card score">
    <div class="value" style="color:${scoreColor}">${results.length}</div>
    <div class="label">Total Tests</div>
  </div>
</div>

<div class="coverage">
  <h2>Coverage</h2>
  ${coverageBadges}
  ${report.topIssues.length ? `<p style="margin-top:8px;font-size:.85rem;color:#64748b">${report.topIssues.join(" &nbsp;·&nbsp; ")}</p>` : ""}
  <div class="reco"><strong>Recommendation:</strong> ${this.esc(report.recommendation)}</div>
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
    const status    = result.passed ? "pass" : "fail";
    const icon      = result.passed ? "✅" : "❌";
    const tags      = result.tags;
    const tagsHtml  = tags?.length
      ? `<span class="tags">${tags.map(t => `<span class="tag">${this.esc(t)}</span>`).join("")}</span>`
      : "";
    const stepsHtml = result.stepResults.map(s => this.stepRow(s, result.debugResult)).join("\n");

    return `<div class="test">
  <details>
    <summary class="test-header ${status}">
      <span class="status-dot ${status}"></span>
      <span class="test-name">${icon} ${this.esc(result.testName)}${tagsHtml}</span>
      <span class="test-meta">${result.stepResults.length} steps &nbsp;·&nbsp; ${result.durationMs}ms</span>
      <span class="chevron">▶</span>
    </summary>
    <div class="steps">
      ${stepsHtml}
      ${result.error ? `<p style="color:#dc2626;font-size:.85rem;margin-top:10px;padding:8px 12px;background:#fff5f5;border-radius:6px">⛔ ${this.esc(result.error)}</p>` : ""}
    </div>
  </details>
</div>`;
  }

  private stepRow(
    step: { index: number; action: string; passed: boolean; durationMs: number; error?: string; screenshotPath?: string },
    debugResult: TestResult["debugResult"],
  ): string {
    const badge       = step.passed ? "pass" : "fail";
    const label       = step.passed ? "PASS" : "FAIL";
    const actionColor = ACTION_COLORS[step.action] ?? "#64748b";

    const errorHtml = step.error
      ? `<div class="step-error">${this.esc(step.error)}</div>`
      : "";

    const debugHtml = (!step.passed && debugResult)
      ? `<div class="inline-debug">
          <div class="d-class">🔍 ${this.esc(debugResult.failure_class.replace(/_/g, " "))}</div>
          <div class="d-fix">💡 ${this.esc(debugResult.suggested_fix)}</div>
        </div>`
      : "";

    let screenshotHtml = "";
    if (!step.passed && step.screenshotPath && fs.existsSync(step.screenshotPath)) {
      try {
        const imgBuffer = fs.readFileSync(step.screenshotPath);
        const b64       = imgBuffer.toString("base64");
        screenshotHtml  = `<details class="screenshot-wrap">
          <summary>📸 View failure screenshot</summary>
          <img src="data:image/png;base64,${b64}" alt="Failure screenshot step ${step.index + 1}"/>
        </details>`;
      } catch {
        // screenshot unreadable — skip
      }
    }

    return `<div class="step">
      <div class="step-row">
        <span class="step-idx">${step.index + 1}</span>
        <span class="step-badge ${badge}">${label}</span>
        <span class="step-action" style="background:${actionColor}">${this.esc(step.action)}</span>
        <div class="step-detail">
          <div class="step-duration">${step.durationMs}ms</div>
          ${errorHtml}
        </div>
      </div>
      ${debugHtml}
      ${screenshotHtml}
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
