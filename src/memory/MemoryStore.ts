import * as fs   from "fs";
import * as path from "path";
import { KnownPattern, MemoryData, StepMemory } from "./types";

export { KnownPattern, MemoryData, StepMemory };

// ── Constants ─────────────────────────────────────────────────────────────────

export const FLAKINESS_THRESHOLD = 0.4;

// ── Step key ──────────────────────────────────────────────────────────────────

/**
 * Canonical key for a step in memory.
 * Format: "<testName>::step<N>::<action>"
 * e.g.  "Login flow::step3::click"
 */
export function makeStepKey(testName: string, stepIndex: number, action: string): string {
  return `${testName}::step${stepIndex + 1}::${action}`;
}

// ── MemoryStore ───────────────────────────────────────────────────────────────

/**
 * Persists cross-run QA memory: flakiness scores per step and cached
 * DebuggerAgent diagnoses (known failure patterns).
 *
 * Flakiness scoring:
 *   • On fail: score += 0.2 × (1 − score)   → asymptotically approaches 1.0
 *   • On pass: score ×= 0.8                  → exponential decay
 *   • score ≥ 0.4 → step is considered flaky
 *
 * When filePath is omitted the store is in-memory only (useful in tests).
 */
export class MemoryStore {
  private data: MemoryData;

  constructor(
    private readonly filePath?: string,
    suiteId = "default",
  ) {
    this.data = filePath ? this.load(filePath, suiteId) : this.fresh(suiteId);
  }

  // ── Flakiness tracking ────────────────────────────────────────────────────

  recordOutcome(stepKey: string, passed: boolean): void {
    const entry = this.getOrCreate(stepKey);
    entry.runCount++;
    if (!passed) {
      entry.failCount++;
      entry.flakinessScore = entry.flakinessScore + 0.2 * (1 - entry.flakinessScore);
    } else {
      entry.flakinessScore = entry.flakinessScore * 0.8;
    }
    entry.flakinessScore = Math.round(entry.flakinessScore * 1000) / 1000;
    entry.lastUpdated = new Date().toISOString();
  }

  getScore(stepKey: string): number {
    return this.data.steps[stepKey]?.flakinessScore ?? 0;
  }

  /** Returns extra milliseconds to wait before a retry, based on flakiness. */
  extraWaitMs(stepKey: string): number {
    const score = this.getScore(stepKey);
    if (score >= 0.8) return 3000;
    if (score >= 0.6) return 2000;
    if (score >= FLAKINESS_THRESHOLD) return 1000;
    return 0;
  }

  getFlakySteps(threshold = FLAKINESS_THRESHOLD): StepMemory[] {
    return Object.values(this.data.steps).filter(s => s.flakinessScore >= threshold);
  }

  // ── Known-pattern cache ───────────────────────────────────────────────────

  /**
   * Returns a cached diagnosis for this step, or undefined if none exists.
   * Each call increments hitCount and llmCallsSaved — call only when you
   * are actually skipping the LLM call.
   */
  getKnownPattern(stepKey: string): KnownPattern | undefined {
    const entry = this.data.steps[stepKey];
    if (!entry?.knownPattern) return undefined;
    entry.knownPattern.hitCount++;
    this.data.llmCallsSaved++;
    return entry.knownPattern;
  }

  /**
   * Stores a new failure diagnosis. First-seen wins — if a pattern already
   * exists for this step it is not overwritten.
   */
  storePattern(stepKey: string, pattern: Omit<KnownPattern, "hitCount" | "firstSeen">): void {
    const entry = this.getOrCreate(stepKey);
    if (!entry.knownPattern) {
      entry.knownPattern = {
        ...pattern,
        firstSeen: new Date().toISOString(),
        hitCount:  0,
      };
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  getReport(): string {
    const flaky = this.getFlakySteps();
    const total = Object.keys(this.data.steps).length;
    if (total === 0) return "";

    const lines: string[] = [
      "",
      "┌─ 🧠 Memory Report ──────────────────────────────────",
      `│  Steps tracked:      ${total}`,
      `│  Flaky steps:        ${flaky.length}${flaky.length ? `  (score ≥ ${FLAKINESS_THRESHOLD})` : ""}`,
      `│  LLM calls saved:    ${this.data.llmCallsSaved}`,
    ];

    if (flaky.length) {
      lines.push("│");
      lines.push("│  Flaky steps:");
      for (const s of flaky.sort((a, b) => b.flakinessScore - a.flakinessScore)) {
        const badge = s.flakinessScore >= 0.8 ? " ⚠️ " : "    ";
        lines.push(
          `│  ${badge}• ${s.stepKey.padEnd(44)} score: ${s.flakinessScore.toFixed(2)}` +
          `  (${s.failCount}/${s.runCount} failed)`,
        );
      }
    }

    lines.push("└────────────────────────────────────────────────────");
    return lines.join("\n");
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save(): void {
    if (!this.filePath) return;
    this.data.updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getOrCreate(stepKey: string): StepMemory {
    if (!this.data.steps[stepKey]) {
      this.data.steps[stepKey] = {
        stepKey,
        flakinessScore: 0,
        runCount:       0,
        failCount:      0,
        lastUpdated:    new Date().toISOString(),
      };
    }
    return this.data.steps[stepKey];
  }

  private fresh(suiteId: string): MemoryData {
    return { suiteId, updated: new Date().toISOString(), llmCallsSaved: 0, steps: {} };
  }

  private load(filePath: string, suiteId: string): MemoryData {
    if (!fs.existsSync(filePath)) return this.fresh(suiteId);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MemoryData;
      return {
        suiteId:       raw.suiteId       ?? suiteId,
        updated:       raw.updated       ?? new Date().toISOString(),
        llmCallsSaved: raw.llmCallsSaved ?? 0,
        steps:         raw.steps         ?? {},
      };
    } catch {
      return this.fresh(suiteId);
    }
  }
}
