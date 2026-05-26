import * as fs   from "fs";
import * as path from "path";

export interface UptimeEntry {
  date:       string;   // ISO-8601
  passed:     boolean;
  durationMs: number;
}

export type UptimeLog = Record<string, UptimeEntry[]>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FILENAME        = "uptime.json";

export class UptimeTracker {
  private readonly filePath: string;

  constructor(resultsDir: string) {
    this.filePath = path.join(resultsDir, FILENAME);
  }

  read(): UptimeLog {
    if (!fs.existsSync(this.filePath)) return {};
    try { return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as UptimeLog; }
    catch { return {}; }
  }

  append(entries: Array<{ testFile: string; passed: boolean; durationMs: number }>): void {
    const log     = this.read();
    const now     = new Date().toISOString();
    const cutoff  = Date.now() - THIRTY_DAYS_MS;

    for (const { testFile, passed, durationMs } of entries) {
      const key = testFile;
      const pruned = (log[key] ?? []).filter(e => new Date(e.date).getTime() >= cutoff);
      pruned.push({ date: now, passed, durationMs });
      log[key] = pruned;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(log, null, 2));
  }

  /** Format a summary table for CLI display. */
  formatSummary(log: UptimeLog, cwd: string): string {
    const keys = Object.keys(log);
    if (keys.length === 0) return "  (no uptime history yet — run tests with --out to start tracking)\n";

    const rows = keys.map(k => {
      const entries   = log[k];
      const total     = entries.length;
      const passed    = entries.filter(e => e.passed).length;
      const pct       = total === 0 ? 0 : Math.round((passed / total) * 100);
      const last      = entries[entries.length - 1];
      const lastStatus = last.passed ? "✅" : "❌";
      const lastDate  = new Date(last.date).toLocaleString();
      const label     = path.relative(cwd, k) || k;
      return { label, pct, passed, total, lastStatus, lastDate };
    }).sort((a, b) => a.pct - b.pct);   // worst first

    const labelW = Math.max(10, ...rows.map(r => r.label.length));
    const header = `${"Test file".padEnd(labelW)}  Uptime   Runs  Last run          Last status`;
    const sep    = "─".repeat(header.length);

    const lines = rows.map(r => {
      const bar  = uptimeBar(r.pct);
      const pctS = `${r.pct}%`.padStart(4);
      return `${r.label.padEnd(labelW)}  ${bar} ${pctS}  ${String(r.total).padStart(4)}  ${r.lastDate.padEnd(18)}  ${r.lastStatus}`;
    });

    return [sep, header, sep, ...lines, sep].join("\n");
  }
}

function uptimeBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}
