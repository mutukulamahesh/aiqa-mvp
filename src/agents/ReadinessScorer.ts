import { TestResult } from "../runner/TestRunner";
import { DebugResult, FailureClass } from "./DebuggerAgent";

export interface ReadinessReport {
  score:            number;
  grade:            "A" | "B" | "C" | "D" | "F";
  totalTests:       number;
  passed:           number;
  failed:           number;
  passRatePct:      number;
  coverageLayers:   string[];
  failureBreakdown: Partial<Record<FailureClass, number>>;
  topIssues:        string[];
  recommendation:   string;
  generatedAt:      string;
}

export class ReadinessScorer {
  score(
    results: TestResult[],
    debugMap: Map<string, DebugResult> = new Map(),
  ): ReadinessReport {
    const total  = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? passed / total : 0;

    // ── Coverage layers ────────────────────────────────────────────────────
    const allSteps = results.flatMap(r => r.stepResults);
    const coverageLayers: string[] = [];
    if (allSteps.some(s => ["navigate", "click", "fill"].includes(s.action))) coverageLayers.push("UI");
    if (allSteps.some(s => s.action === "api"))                               coverageLayers.push("API");
    if (allSteps.some(s => s.action === "assert"))                            coverageLayers.push("Assertions");

    // ── Scoring formula ────────────────────────────────────────────────────
    // Base: pass rate (max 60 pts)
    let pts = passRate * 60;

    // Coverage breadth bonus (max 20 pts)
    pts += coverageLayers.length * 6;

    // Volume bonus (max 10 pts)
    if (total >= 3)  pts += 4;
    if (total >= 7)  pts += 4;
    if (total >= 15) pts += 2;

    // Diversity bonus — both UI and API present (10 pts)
    if (coverageLayers.includes("UI") && coverageLayers.includes("API")) pts += 10;

    // Penalty for repeated critical failures
    const failureBreakdown: Partial<Record<FailureClass, number>> = {};
    for (const [, debug] of debugMap) {
      failureBreakdown[debug.failure_class] = (failureBreakdown[debug.failure_class] ?? 0) + 1;
      if (debug.failure_class === "network_error" || debug.failure_class === "api_failure") pts -= 5;
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(pts)));
    const grade = finalScore >= 90 ? "A"
      : finalScore >= 75 ? "B"
      : finalScore >= 60 ? "C"
      : finalScore >= 45 ? "D"
      : "F";

    // ── Top issues ─────────────────────────────────────────────────────────
    const topIssues: string[] = [];
    for (const [cls, count] of Object.entries(failureBreakdown) as [FailureClass, number][]) {
      topIssues.push(`${count}× ${cls.replace(/_/g, " ")}`);
    }
    if (failed > 0 && topIssues.length === 0) {
      topIssues.push(`${failed} test${failed > 1 ? "s" : ""} failed`);
    }

    // ── Recommendation ─────────────────────────────────────────────────────
    const recommendation = this.buildRecommendation(finalScore, grade, coverageLayers, total);

    return {
      score:            finalScore,
      grade,
      totalTests:       total,
      passed,
      failed,
      passRatePct:      Math.round(passRate * 100),
      coverageLayers,
      failureBreakdown,
      topIssues,
      recommendation,
      generatedAt:      new Date().toISOString(),
    };
  }

  private buildRecommendation(
    score: number,
    grade: string,
    layers: string[],
    total: number,
  ): string {
    if (score >= 90) return "Excellent coverage. System appears production-ready.";
    if (score >= 75) return "Good coverage. Address failing tests before releasing.";
    if (score >= 60) {
      if (!layers.includes("API")) return "Moderate coverage. Add API tests to improve confidence.";
      if (!layers.includes("UI"))  return "Moderate coverage. Add UI tests to improve confidence.";
      return "Moderate coverage. Increase test volume and fix failures.";
    }
    if (score >= 45) {
      if (total < 3) return "Low coverage. Run more tests — current sample is too small to assess readiness.";
      return "Low coverage. Significant failures detected. Not recommended for production.";
    }
    return "Critical coverage gap. Do not release without addressing failures and expanding test suite.";
  }
}
