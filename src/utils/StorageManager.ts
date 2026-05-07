import * as fs   from "fs";
import * as path from "path";

const FIELD_MAX_BYTES = 2048;

/** Truncates a string to maxBytes and appends "…" if cut. Shared safe-logging utility. */
export function truncField(s: string, maxBytes = FIELD_MAX_BYTES): string {
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes - 1) + "…";
}

/** Warns to stderr when a generated file exceeds threshold (default 1 MB). */
export function warnLargeFile(filePath: string, sizeBytes: number, thresholdBytes = 1024 * 1024): void {
  if (sizeBytes > thresholdBytes) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(1);
    const lim = (thresholdBytes / 1024 / 1024).toFixed(0);
    process.stderr.write(`[warn] Large test file detected (>${lim}MB): ${path.basename(filePath)} (${mb} MB)\n`);
  }
}

export interface CleanOptions {
  /** Path to history.json — run dates used to determine cutoff. */
  historyPath: string;
  /** Directories to scan for stale files (screenshots, allure-results, etc.). */
  dirs: string[];
  /** Number of most-recent runs to keep; older artifacts are deleted. */
  retainRuns: number;
}

/**
 * Deletes files/directories in `dirs` that are older than the N-th most recent
 * run recorded in history.json. Returns the count of deleted entries.
 *
 * Safe by design: if history.json has ≤ retainRuns entries, nothing is deleted.
 */
export function cleanArtifacts(opts: CleanOptions): number {
  const cutoff = getCutoffMs(opts.historyPath, opts.retainRuns);
  if (cutoff === 0) return 0;

  let deleted = 0;
  for (const dir of opts.dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          if (stat.isDirectory()) {
            fs.rmSync(full, { recursive: true, force: true });
          } else {
            fs.unlinkSync(full);
          }
          console.log(`   [cleanup] removed ${full}`);
          deleted++;
        }
      } catch { /* already removed or locked — skip */ }
    }
  }
  if (deleted > 0) console.log(`   [cleanup] ${deleted} artifact(s) removed (retaining last ${opts.retainRuns} run(s))`);
  return deleted;
}

/** Returns the mtime threshold in ms-epoch below which artifacts should be deleted. */
function getCutoffMs(historyPath: string, retainRuns: number): number {
  if (!fs.existsSync(historyPath)) return 0;
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    if (!Array.isArray(raw)) return 0;
    const dated = raw.filter(r => typeof r.date === "string");
    if (dated.length <= retainRuns) return 0;
    const sorted = [...dated].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    // Cutoff is the start of the (retainRuns+1)-th oldest run — everything before it is deleted
    return new Date(sorted[retainRuns].date).getTime();
  } catch { return 0; }
}
