import * as fs   from "fs";
import * as path from "path";

export interface TestRunSummary {
  name:   string;
  passed: boolean;
}

export interface TrendRecord {
  runId:        string;
  date:         string;
  passed:       number;
  failed:       number;
  total:        number;
  score:        number;
  grade:        string;
  durationMs:   number;
  url?:         string;
  tags?:        string[];
  testResults?: TestRunSummary[];
}

/** Returns the top N tests by failure count across all history records. */
export function topFlakyTests(
  records: TrendRecord[],
  topN = 5,
): { name: string; failCount: number; runCount: number }[] {
  const failCounts = new Map<string, { fail: number; total: number }>();
  for (const rec of records) {
    for (const t of rec.testResults ?? []) {
      const entry = failCounts.get(t.name) ?? { fail: 0, total: 0 };
      entry.total++;
      if (!t.passed) entry.fail++;
      failCounts.set(t.name, entry);
    }
  }
  return [...failCounts.entries()]
    .filter(([, v]) => v.fail > 0)
    .sort(([, a], [, b]) => b.fail - a.fail)
    .slice(0, topN)
    .map(([name, v]) => ({ name, failCount: v.fail, runCount: v.total }));
}

export class TrendTracker {
  private readonly filePath: string;

  constructor(resultsDir: string, private readonly maxHistory = 200) {
    this.filePath = path.join(resultsDir, "history.json");
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  append(record: TrendRecord): void {
    // Capture mtime before reading so we can detect a concurrent write
    const mtimeBefore = this.mtime();
    const history     = this.read();
    history.push(record);

    // Re-check mtime — if it changed another worker wrote while we were working
    if (this.mtime() !== mtimeBefore) {
      const mtimeConflict = this.mtime();
      const fresh = this.read();
      const seen  = new Set(fresh.map(r => r.runId));
      if (!seen.has(record.runId)) fresh.push(record);

      // Rare second collision: another worker wrote while we were re-reading — retry once
      if (this.mtime() !== mtimeConflict) {
        const fresh2 = this.read();
        const seen2  = new Set(fresh2.map(r => r.runId));
        if (!seen2.has(record.runId)) fresh2.push(record);
        this.flush(fresh2);
      } else {
        this.flush(fresh);
      }
    } else {
      this.flush(history);
    }
  }

  read(): TrendRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /** Last N pass-rates as percentages (0-100), oldest first. */
  passRateTrend(lastN = 10): number[] {
    return this.read().slice(-lastN).map(r =>
      r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0
    );
  }

  /** Formatted one-liner for CLI output, silent when only 1 run exists. */
  formatTrend(): string {
    const history = this.read();
    if (history.length < 2) return "";

    const rates  = this.passRateTrend(10);
    const latest = rates[rates.length - 1];
    const prev   = rates[rates.length - 2];
    const delta  = latest - prev;
    const arrow  = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    const sign   = delta > 0 ? "+" : "";
    const bar    = rates.map(r => r >= 75 ? "█" : r >= 50 ? "▒" : "░").join("");

    return `   Trend  : ${bar}  ${arrow} ${sign}${delta}% vs last run (${history.length} runs tracked)`;
  }

  private mtime(): number {
    try { return fs.statSync(this.filePath).mtimeMs; } catch { return 0; }
  }

  private flush(records: TrendRecord[]): void {
    const sorted = [...records].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const trimmed = sorted.length > this.maxHistory
      ? sorted.slice(sorted.length - this.maxHistory)
      : sorted;
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), "utf-8");
    fs.renameSync(tmp, this.filePath);
  }
}
