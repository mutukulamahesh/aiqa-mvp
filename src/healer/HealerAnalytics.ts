import * as fs   from "fs";
import * as path from "path";
import { HealerCache } from "./HealerCache";

// ── Public types ───────────────────────────────────────────────────────────────

export interface PageInstability {
  pageUrl:     string;
  totalUses:   number;
  failures:    number;
  failureRate: number; // 0–100
}

export interface SelectorHealStat {
  descriptor:  string;
  pageUrl:     string;
  totalUses:   number;
  failures:    number;
  successRate: number; // 0–100
  status:      "provisional" | "validated";
}

export interface FlakyStat {
  descriptor:  string;
  pageUrl:     string;
  selector:    string;
  uses:        number;
  failureRate: number; // 0–100
}

/** Persisted per-run record — appended to healer-runs.json after every orchestrate run. */
export interface RunRecord {
  runId:           string;
  timestamp:       string;
  url:             string;
  seededSelectors: number;
  testsPassed:     number;
  testsFailed:     number;
}

export interface AnalyticsReport {
  generatedAt:         string;
  totalRuns:           number;
  totalLLMCallsSaved:  number;
  topUnstablePages:    PageInstability[];
  mostHealedSelectors: SelectorHealStat[];
  flakiestSteps:       FlakyStat[];
  memoryReuseTrend:    RunRecord[];
}

// ── HealerAnalytics ───────────────────────────────────────────────────────────

export class HealerAnalytics {
  readonly logFile: string;

  constructor(
    private readonly cache: HealerCache,
    logFile = ".aiqa/healer-runs.json",
    private readonly maxHistory = 200,
  ) {
    this.logFile = logFile;
  }

  // ── Run recording ──────────────────────────────────────────────────────────

  recordRun(record: RunRecord): void {
    this.withFileLock(() => {
      const preMtime = fileMtime(this.logFile);
      const runs     = this.loadRuns();
      runs.push(record);

      const postMtime = fileMtime(this.logFile);
      if (postMtime !== null && preMtime !== postMtime) {
        // Another worker appended while we were loading — re-read and deduplicate by runId.
        const fresh = this.loadRuns();
        if (!fresh.some(r => r.runId === record.runId)) fresh.push(record);
        this.saveRuns(fresh);
      } else {
        this.saveRuns(runs);
      }
    });
  }

  /**
   * Advisory file lock using O_EXCL (atomic on POSIX and Windows).
   * If already locked, degrades gracefully — the mtime+dedup logic still prevents
   * duplicate entries under concurrent writes.
   */
  private withFileLock(fn: () => void): void {
    const lockPath = `${this.logFile}.lock`;
    let acquired   = false;
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR);
      fs.closeSync(fd);
      acquired = true;
    } catch {
      // Lock held — proceed without exclusive lock
    }
    try {
      fn();
    } finally {
      if (acquired) {
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }
  }

  getMemoryReuseTrend(lastN = 10): RunRecord[] {
    return this.loadRuns().slice(-lastN);
  }

  getTotalLLMCallsSaved(): number {
    return this.loadRuns().reduce((sum, r) => sum + r.seededSelectors, 0);
  }

  // ── Cache-derived analytics ────────────────────────────────────────────────

  /** Pages ranked by raw failure count, then failure rate. */
  getTopUnstablePages(topN = 5): PageInstability[] {
    return Object.entries(this.cache.entries())
      .map(([pageUrl, descs]) => {
        let totalUses = 0;
        let failures  = 0;
        for (const entries of Object.values(descs)) {
          for (const e of entries) {
            totalUses += e.successCount + e.failureCount;
            failures  += e.failureCount;
          }
        }
        return {
          pageUrl,
          totalUses,
          failures,
          failureRate: totalUses ? Math.round((failures / totalUses) * 100) : 0,
        };
      })
      .filter(p => p.totalUses > 0)
      .sort((a, b) => b.failures - a.failures || b.failureRate - a.failureRate)
      .slice(0, topN);
  }

  /** Descriptors ranked by total heal attempts (successCount + failureCount across all entries). */
  getMostHealedSelectors(topN = 10): SelectorHealStat[] {
    const stats: SelectorHealStat[] = [];

    for (const [pageUrl, descs] of Object.entries(this.cache.entries())) {
      for (const [descriptor, entries] of Object.entries(descs)) {
        const totalUses = entries.reduce((s, e) => s + e.successCount + e.failureCount, 0);
        const failures  = entries.reduce((s, e) => s + e.failureCount, 0);
        const successes = entries.reduce((s, e) => s + e.successCount, 0);
        if (totalUses === 0) continue;
        // Use the most-used entry to determine representative status
        const topEntry = entries.reduce((best, e) =>
          (e.successCount + e.failureCount) > (best.successCount + best.failureCount) ? e : best,
        );
        stats.push({
          descriptor,
          pageUrl,
          totalUses,
          failures,
          successRate: Math.round((successes / totalUses) * 100),
          status:      topEntry.status,
        });
      }
    }

    return stats
      .sort((a, b) => b.totalUses - a.totalUses)
      .slice(0, topN);
  }

  /** Individual selector entries with any failures, ranked by failure rate then uses. */
  getFlakiestSteps(topN = 10): FlakyStat[] {
    const stats: FlakyStat[] = [];

    for (const [pageUrl, descs] of Object.entries(this.cache.entries())) {
      for (const [descriptor, entries] of Object.entries(descs)) {
        for (const e of entries) {
          const uses = e.successCount + e.failureCount;
          if (uses < 3 || e.failureCount === 0) continue;
          stats.push({
            descriptor,
            pageUrl,
            selector:    e.selector,
            uses,
            failureRate: Math.round((e.failureCount / uses) * 100),
          });
        }
      }
    }

    return stats
      .sort((a, b) => b.failureRate - a.failureRate || b.uses - a.uses)
      .slice(0, topN);
  }

  // ── Full report ────────────────────────────────────────────────────────────

  getReport(topN = 5): AnalyticsReport {
    return {
      generatedAt:         new Date().toISOString(),
      totalRuns:           this.loadRuns().length,
      totalLLMCallsSaved:  this.getTotalLLMCallsSaved(),
      topUnstablePages:    this.getTopUnstablePages(topN),
      mostHealedSelectors: this.getMostHealedSelectors(topN),
      flakiestSteps:       this.getFlakiestSteps(topN),
      memoryReuseTrend:    this.getMemoryReuseTrend(topN),
    };
  }

  // ── CLI formatting (static — works on a pre-computed report) ──────────────

  static format(report: AnalyticsReport): string {
    const lines: string[] = [];
    const sep = "─".repeat(46);

    const hasData =
      report.totalLLMCallsSaved > 0  ||
      report.mostHealedSelectors.length > 0 ||
      report.topUnstablePages.length > 0;

    if (!hasData && report.totalRuns === 0) return "";

    lines.push(`\n━━━ Healer Analytics ${"━".repeat(26)}`);

    if (report.totalRuns > 0) {
      lines.push(`   LLM calls saved   : ${report.totalLLMCallsSaved}  (across ${report.totalRuns} run${report.totalRuns !== 1 ? "s" : ""})`);
    }

    // Memory reuse trend
    if (report.memoryReuseTrend.length > 0) {
      lines.push(`\n   Memory reuse trend  (last ${report.memoryReuseTrend.length} run${report.memoryReuseTrend.length !== 1 ? "s" : ""})`);
      lines.push(`   ${sep}`);
      report.memoryReuseTrend.forEach((r, i) => {
        const seeded = r.seededSelectors;
        const tag    = seeded > 0
          ? `${seeded} seeded  ·  ${seeded} heals avoided`
          : "cache cold";
        const label = r.url.replace(/^https?:\/\//, "").slice(0, 30);
        lines.push(`   Run ${i + 1}  [${label}]  ${tag}`);
      });
    }

    // Most healed selectors
    if (report.mostHealedSelectors.length > 0) {
      lines.push(`\n   Most healed selectors`);
      lines.push(`   ${sep}`);
      report.mostHealedSelectors.forEach((s, i) => {
        const page = s.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
        const desc = s.descriptor.length > 22 ? s.descriptor.slice(0, 19) + "…" : s.descriptor;
        lines.push(`   ${i + 1}. ${desc.padEnd(22)} heals: ${String(s.totalUses).padStart(3)}  success: ${s.successRate}%  [${page}]`);
      });
    }

    // Top unstable pages
    if (report.topUnstablePages.length > 0) {
      lines.push(`\n   Top unstable pages`);
      lines.push(`   ${sep}`);
      report.topUnstablePages.forEach((p, i) => {
        const pg = p.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
        const padded = pg.length > 32 ? "…" + pg.slice(-31) : pg.padEnd(32);
        lines.push(`   ${i + 1}. ${padded}  ${p.failures}/${p.totalUses} failed (${p.failureRate}%)`);
      });
    }

    // Flakiest steps
    if (report.flakiestSteps.length > 0) {
      lines.push(`\n   Flakiest steps`);
      lines.push(`   ${sep}`);
      report.flakiestSteps.forEach((s, i) => {
        const pg  = s.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
        const sel = s.selector.length > 28 ? s.selector.slice(0, 25) + "…" : s.selector;
        lines.push(`   ${i + 1}. [${pg}] ${s.descriptor} → ${sel}  ${s.failureRate}% failure`);
      });
    }

    if (!hasData) {
      lines.push(`   No healing data yet — cache will warm after the first run.`);
    }

    lines.push(`${"━".repeat(48)}\n`);
    return lines.join("\n");
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private loadRuns(): RunRecord[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.logFile, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private saveRuns(runs: RunRecord[]): void {
    const sorted = [...runs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const trimmed = sorted.length > this.maxHistory ? sorted.slice(-this.maxHistory) : sorted;
    try {
      atomicWrite(this.logFile, JSON.stringify(trimmed, null, 2));
    } catch { /* best-effort */ }
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
