import * as fs   from "fs";
import * as path from "path";

export interface CacheEntry {
  selector:     string;
  confidence:   number;
  source:       "llm" | "semantic" | "manual";
  lastUsed:     string;
  successCount: number;
  failureCount: number;
  contextKey?:  string; // SPA-safe: hash of page title + headings at heal time
}

// descriptor → ranked list of candidate selectors (best score first on retrieval)
type CacheData = Record<string, Record<string, CacheEntry[]>>;

const EVICT_THRESHOLD            = 3;
const MAX_SELECTORS_PER_DESCRIPTOR = 5;

export class HealerCache {
  private data: CacheData = {};
  readonly filePath: string;

  constructor(cacheFile = ".aiqa/healer-cache.json") {
    this.filePath = cacheFile;
    this.load();
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  private scoreEntry(e: CacheEntry): number {
    const ageDays      = (Date.now() - new Date(e.lastUsed).getTime()) / 86_400_000;
    const recencyBoost = Math.max(0, 7 - ageDays);
    const decayFactor  = Math.exp(-ageDays / 30); // 30-day half-life on historical counts
    return e.confidence * 10
         + e.successCount * 2 * decayFactor
         - e.failureCount * 3
         + recencyBoost;
  }

  /** Adjusts confidence toward observed success rate after each outcome. */
  private recalibrate(entry: CacheEntry): void {
    const total = entry.successCount + entry.failureCount;
    if (total === 0) return;
    const successRate  = entry.successCount / total;
    entry.confidence   = Math.min(1, entry.confidence * 0.7 + successRate * 0.3);
  }

  private sorted(entries: CacheEntry[]): CacheEntry[] {
    return [...entries].sort((a, b) => this.scoreEntry(b) - this.scoreEntry(a));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns the best-scored selector for a descriptor, or undefined.
   *  When contextKey is provided, prefers entries that match it; entries without
   *  a contextKey are always eligible (backward compat with pre-SPA cache files). */
  get(pageUrl: string, descriptor: string, contextKey?: string): string | undefined {
    const entries = this.data[this.normalizeUrl(pageUrl)]?.[descriptor];
    if (!entries?.length) return undefined;
    const pool = this.contextFilter(entries, contextKey);
    return this.sorted(pool)[0]?.selector;
  }

  /** Returns all selectors for a descriptor, ranked best-first. */
  getAll(pageUrl: string, descriptor: string, contextKey?: string): string[] {
    const entries = this.data[this.normalizeUrl(pageUrl)]?.[descriptor];
    if (!entries?.length) return [];
    return this.sorted(this.contextFilter(entries, contextKey)).map(e => e.selector);
  }

  set(
    pageUrl:    string,
    descriptor: string,
    selector:   string,
    opts: { confidence?: number; source?: CacheEntry["source"]; contextKey?: string } = {},
  ): void {
    const key  = this.normalizeUrl(pageUrl);
    const list = (this.data[key] ??= {})[descriptor] ??= [];

    const existing = list.find(e => e.selector === selector);
    if (existing) {
      // Refresh metadata without resetting counts
      existing.confidence = opts.confidence ?? existing.confidence;
      existing.source     = opts.source     ?? existing.source;
      existing.contextKey = opts.contextKey ?? existing.contextKey;
      existing.lastUsed   = new Date().toISOString();
    } else {
      list.push({
        selector,
        confidence:   opts.confidence ?? 1.0,
        source:       opts.source     ?? "llm",
        lastUsed:     new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
        contextKey:   opts.contextKey,
      });
      // Cap to MAX_SELECTORS_PER_DESCRIPTOR, evicting the lowest-scored entry
      if (list.length > MAX_SELECTORS_PER_DESCRIPTOR) {
        this.data[key][descriptor] = this.sorted(list).slice(0, MAX_SELECTORS_PER_DESCRIPTOR);
      }
    }
    this.save();
  }

  markSuccess(pageUrl: string, descriptor: string, selector?: string): void {
    const entry = this.findEntry(pageUrl, descriptor, selector);
    if (!entry) return;
    entry.successCount++;
    entry.lastUsed = new Date().toISOString();
    this.recalibrate(entry);
    this.save();
  }

  markFailure(pageUrl: string, descriptor: string, selector?: string): void {
    const key   = this.normalizeUrl(pageUrl);
    const list  = this.data[key]?.[descriptor];
    if (!list?.length) return;

    const entry = selector
      ? list.find(e => e.selector === selector)
      : this.sorted(list)[0];

    if (!entry) return;
    entry.failureCount++;
    this.recalibrate(entry);

    if (entry.failureCount >= EVICT_THRESHOLD) {
      const idx = list.indexOf(entry);
      list.splice(idx, 1);
      if (!list.length) delete this.data[key][descriptor];
    }
    this.save();
  }

  entries(): CacheData {
    return this.data;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Filters entries by contextKey when provided. Entries with no contextKey
   *  always pass through (backward compat). Falls back to all entries if the
   *  filtered set is empty (e.g. old cache file has no context tags yet). */
  private contextFilter(entries: CacheEntry[], contextKey?: string): CacheEntry[] {
    if (!contextKey) return entries;
    const matched = entries.filter(e => !e.contextKey || e.contextKey === contextKey);
    return matched.length ? matched : entries;
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  }

  private findEntry(pageUrl: string, descriptor: string, selector?: string): CacheEntry | undefined {
    const list = this.data[this.normalizeUrl(pageUrl)]?.[descriptor];
    if (!list?.length) return undefined;
    return selector ? list.find(e => e.selector === selector) : this.sorted(list)[0];
  }

  private load(): void {
    try {
      this.data = this.migrate(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch {
      this.data = {};
    }
  }

  // Upgrades: string → CacheEntry → CacheEntry[] (each format is handled gracefully).
  private migrate(raw: unknown): CacheData {
    if (typeof raw !== "object" || raw === null) return {};
    const result: CacheData = {};

    for (const [url, descs] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof descs !== "object" || descs === null) continue;
      result[url] = {};

      for (const [desc, val] of Object.entries(descs as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          result[url][desc] = val as CacheEntry[];
        } else if (typeof val === "string") {
          result[url][desc] = [{
            selector: val, confidence: 1.0, source: "llm",
            lastUsed: new Date().toISOString(), successCount: 0, failureCount: 0,
          }];
        } else if (typeof val === "object" && val !== null && "selector" in val) {
          result[url][desc] = [val as CacheEntry];
        }
      }
    }
    return result;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch { /* best-effort */ }
  }
}
