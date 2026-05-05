import * as fs   from "fs";
import * as path from "path";

export interface CacheEntry {
  selector:     string;
  confidence:   number;
  source:       "llm" | "semantic" | "manual";
  lastUsed:     string;
  successCount: number;
  failureCount: number;
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
    const ageDays     = (Date.now() - new Date(e.lastUsed).getTime()) / 86_400_000;
    const recencyBoost = Math.max(0, 7 - ageDays); // up to 7 pts within last 7 days
    return e.confidence * 10
         + e.successCount * 2
         - e.failureCount * 3
         + recencyBoost;
  }

  private sorted(entries: CacheEntry[]): CacheEntry[] {
    return [...entries].sort((a, b) => this.scoreEntry(b) - this.scoreEntry(a));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns the best-scored selector for a descriptor, or undefined. */
  get(pageUrl: string, descriptor: string): string | undefined {
    const entries = this.data[this.normalizeUrl(pageUrl)]?.[descriptor];
    if (!entries?.length) return undefined;
    return this.sorted(entries)[0]?.selector;
  }

  /** Returns all selectors for a descriptor, ranked best-first. */
  getAll(pageUrl: string, descriptor: string): string[] {
    const entries = this.data[this.normalizeUrl(pageUrl)]?.[descriptor];
    if (!entries?.length) return [];
    return this.sorted(entries).map(e => e.selector);
  }

  set(
    pageUrl:    string,
    descriptor: string,
    selector:   string,
    opts: { confidence?: number; source?: CacheEntry["source"] } = {},
  ): void {
    const key  = this.normalizeUrl(pageUrl);
    const list = (this.data[key] ??= {})[descriptor] ??= [];

    const existing = list.find(e => e.selector === selector);
    if (existing) {
      // Refresh metadata without resetting counts
      existing.confidence = opts.confidence ?? existing.confidence;
      existing.source     = opts.source     ?? existing.source;
      existing.lastUsed   = new Date().toISOString();
    } else {
      list.push({
        selector,
        confidence:   opts.confidence ?? 1.0,
        source:       opts.source     ?? "llm",
        lastUsed:     new Date().toISOString(),
        successCount: 0,
        failureCount: 0,
      });
    }
    this.save();
  }

  markSuccess(pageUrl: string, descriptor: string, selector?: string): void {
    const entry = this.findEntry(pageUrl, descriptor, selector);
    if (!entry) return;
    entry.successCount++;
    entry.lastUsed = new Date().toISOString();
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
