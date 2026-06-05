import * as fs   from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** Pure SHA-256 hash — no I/O. Shared by JudgeCacheStore and NoopJudgeCacheStore. */
export function computeJudgeCacheKey(value: string, prompt: string, acContext: string): string {
  return crypto.createHash("sha256")
    .update(`${value}\x00${prompt}\x00${acContext}`)
    .digest("hex");
}

interface CacheEntry {
  score:     number;
  reason:    string;
  storedAt:  number;   // epoch ms
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const DEFAULT_TTL_MS  = 24 * 60 * 60 * 1000;  // 24 hours
const CACHE_FILE_NAME = "judge-cache.json";

export class JudgeCacheStore {
  private readonly filePath: string;
  private readonly ttlMs:    number;
  private entries:           Map<string, CacheEntry>;

  constructor(indexPath = ".aiqa", ttlMs = DEFAULT_TTL_MS) {
    this.filePath = path.resolve(indexPath, CACHE_FILE_NAME);
    this.ttlMs    = ttlMs;
    this.entries  = this._load();
  }

  cacheKey(value: string, prompt: string, acContext: string): string {
    return computeJudgeCacheKey(value, prompt, acContext);
  }

  get(key: string): { score: number; reason: string } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { score: entry.score, reason: entry.reason };
  }

  set(key: string, score: number, reason: string): void {
    this.entries.set(key, { score, reason, storedAt: Date.now() });
    this._save();
  }

  private _load(): Map<string, CacheEntry> {
    try {
      if (!fs.existsSync(this.filePath)) return new Map();
      const raw  = fs.readFileSync(this.filePath, "utf-8");
      const file = JSON.parse(raw) as CacheFile;
      if (file.version !== 1) return new Map();
      const now = Date.now();
      const map = new Map<string, CacheEntry>();
      for (const [k, v] of Object.entries(file.entries)) {
        if (now - v.storedAt <= this.ttlMs) map.set(k, v);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private _save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: CacheFile = {
        version: 1,
        entries: Object.fromEntries(this.entries),
      };
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Non-fatal — cache miss on next run is acceptable
    }
  }

  get size(): number { return this.entries.size; }
}

/** No-op cache — used in unit tests and when config is not loaded.
 *  cacheKey delegates to the module-level pure function — no filesystem I/O. */
export class NoopJudgeCacheStore {
  cacheKey(value: string, prompt: string, acContext: string): string {
    return computeJudgeCacheKey(value, prompt, acContext);
  }
  get(_key: string): undefined { return undefined; }
  set(_key: string, _score: number, _reason: string): void { /* no-op */ }
  get size(): number { return 0; }
}
