import * as fs   from "fs";
import * as path from "path";
import { TestResult } from "../runner/TestRunner";

/**
 * Produces a JUnit-compatible XML report (xUnit format).
 * Consumed by GitHub Actions, GitLab CI, Azure DevOps, and most CI platforms
 * via their built-in test-result parsers.
 *
 * Format: <testsuites> → <testsuite> → <testcase> (one per test).
 * Time attributes are in seconds (JUnit spec).
 */
export class JUnitReporter {
  generate(results: TestResult[], outputPath: string, suiteName = "AIQA"): void {
    const xml = this.buildXml(results, suiteName);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, xml, "utf-8");
  }

  buildXml(results: TestResult[], suiteName = "AIQA"): string {
    const total     = results.length;
    const failures  = results.filter(r => !r.passed).length;
    const totalSec  = (results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(3);
    const timestamp = new Date().toISOString();

    const cases = results.map(r => this.testCase(r)).join("\n    ");

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuites name="${esc(suiteName)}" tests="${total}" failures="${failures}" time="${totalSec}">`,
      `  <testsuite name="${esc(suiteName)}" tests="${total}" failures="${failures}" errors="0" time="${totalSec}" timestamp="${timestamp}">`,
      `    ${cases}`,
      `  </testsuite>`,
      `</testsuites>`,
    ].join("\n");
  }

  private testCase(r: TestResult): string {
    const sec = (r.durationMs / 1000).toFixed(3);
    const open = `<testcase name="${esc(r.testName)}" classname="${esc(r.testId)}" time="${sec}">`;

    if (r.passed) return `${open}</testcase>`;

    const msg    = esc(r.error ?? "Test failed");
    const detail = esc(r.error ?? "");
    return `${open}\n      <failure message="${msg}" type="failure">${detail}</failure>\n    </testcase>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&apos;");
}
