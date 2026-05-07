import * as fs   from "fs";
import * as path from "path";
import { KnownPattern, MemoryData, StepMemory } from "./types";
import { truncField } from "../utils/StorageManager";

export { KnownPattern, MemoryData, StepMemory };

// ── Constants ─────────────────────────────────────────────────────────────────

export const FLAKINESS_THRESHOLD             = 0.4;

/** Maximum step entries retained in the store; oldest entry evicted when exceeded. */
export const MAX_STEP_ENTRIES                = 500;

/**
 * A cached diagnosis is evicted after this many consecutive failures on the same step.
 * The next failure triggers a fresh LLM call, producing an updated diagnosis.
 *
 * TODO (future): split memory into separate flakiness.json + diagnosis.json files once
 * multi-suite mixing or file-size growth becomes a concern.
 */
export const DIAGNOSIS_INVALIDATION_THRESHOLD = 5;

// ── Step key ──────────────────────────────────────────────────────────────────

/**
 * Canonical key for a step in memory.
 * Format: "<testName>::step<N>::<action>"
 * e.g.  "Login flow::step3::click"
 *
 * TODO (future): normalize action text before hashing so minor wording changes
 * (e.g. "click_login" → "click_login_button") don't silently create a new key
 * and lose accumulated flakiness/diagnosis history for that step.
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
  // Mtime captured at load; used to detect concurrent writes before saving.
  private loadMtime: number | null = null;

  constructor(
    private readonly filePath?: string,
    suiteId = "default",
    private readonly maxEntries = MAX_STEP_ENTRIES,
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
      if (entry.knownPattern) {
        entry.knownPattern.failuresSinceDiagnosis =
          (entry.knownPattern.failuresSinceDiagnosis ?? 0) + 1;
        if (entry.knownPattern.failuresSinceDiagnosis >= DIAGNOSIS_INVALIDATION_THRESHOLD) {
          delete entry.knownPattern; // stale diagnosis — force fresh LLM call next failure
        }
      }
    } else {
      entry.flakinessScore = entry.flakinessScore * 0.8;
      if (entry.knownPattern) entry.knownPattern.failuresSinceDiagnosis = 0;
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
  storePattern(stepKey: string, pattern: Omit<KnownPattern, "hitCount" | "firstSeen" | "failuresSinceDiagnosis">): void {
    const entry = this.getOrCreate(stepKey);
    if (!entry.knownPattern) {
      entry.knownPattern = {
        ...pattern,
        // Truncate LLM-generated strings so a single large diagnosis can't bloat the file
        failureClass: truncField(pattern.failureClass),
        rootCause:    truncField(pattern.rootCause),
        suggestedFix: truncField(pattern.suggestedFix),
        firstSeen:              new Date().toISOString(),
        hitCount:               0,
        failuresSinceDiagnosis: 0,
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
    const currentMtime = fileMtime(this.filePath);
    if (this.loadMtime !== null && currentMtime !== null && currentMtime !== this.loadMtime) {
      // Another worker wrote the file since we loaded — merge external changes.
      try {
        const diskRaw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as MemoryData;
        this.data = mergeMemoryData(diskRaw, this.data);
      } catch { /* merge failed — proceed with our state */ }
    }
    atomicWrite(this.filePath, JSON.stringify(this.data, null, 2));
    this.loadMtime = fileMtime(this.filePath); // update baseline for next save
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getOrCreate(stepKey: string): StepMemory {
    if (!this.data.steps[stepKey]) {
      const keys = Object.keys(this.data.steps);
      if (keys.length >= this.maxEntries) {
        // TODO (future): evict by lowest value (low runCount + low flakinessScore) rather than
        // oldest lastUpdated — a frequently-failing but stale step carries more signal than a
        // rarely-seen step and should be retained longer.
        const oldest = keys.reduce((a, b) =>
          this.data.steps[a].lastUpdated < this.data.steps[b].lastUpdated ? a : b
        );
        delete this.data.steps[oldest];
      }
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
      this.loadMtime = fileMtime(filePath);
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MemoryData;
      return {
        suiteId:       raw.suiteId       ?? suiteId,
        updated:       raw.updated       ?? new Date().toISOString(),
        llmCallsSaved: raw.llmCallsSaved ?? 0,
        steps:         raw.steps         ?? {},
      };
    } catch {
      this.loadMtime = null;
      return this.fresh(suiteId);
    }
  }
}

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}

function fileMtime(filePath: string): number | null {
  try { return fs.statSync(filePath).mtimeMs; } catch { return null; }
}

/**
 * Merges two MemoryData snapshots. `overlay` is our in-memory state; `base`
 * is what another worker wrote to disk between our load and save.
 * — Steps: union all keys; for conflicts keep the entry with the higher runCount.
 * — llmCallsSaved: take max (avoids double-counting cross-worker cache hits).
 */
function mergeMemoryData(base: MemoryData, overlay: MemoryData): MemoryData {
  const mergedSteps: Record<string, StepMemory> = {};
  const allKeys = new Set([...Object.keys(base.steps), ...Object.keys(overlay.steps)]);

  for (const key of allKeys) {
    const b = base.steps[key];
    const o = overlay.steps[key];
    if (!b) { mergedSteps[key] = o; continue; }
    if (!o) { mergedSteps[key] = b; continue; }
    mergedSteps[key] = o.runCount >= b.runCount ? o : b;
  }

  return {
    ...overlay,
    steps:         mergedSteps,
    llmCallsSaved: Math.max(base.llmCallsSaved, overlay.llmCallsSaved),
  };
}
