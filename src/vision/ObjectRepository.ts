import * as crypto from "crypto";
import * as fs     from "fs";
import * as path   from "path";
import type { DetectedElement, RepoEntry, RepoKey } from "./types";

const REPO_DIR = path.resolve(process.cwd(), "object-repository", "web");

// Locked normalization rules (see BACKLOG.md design decisions):
//   1. Lowercase hostname
//   2. Strip default port (:443 on https, :80 on http)
//   3. Strip query string and fragment
//   4. Strip trailing slash from pathname (preserve root "/")
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.toLowerCase());
  if ((u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:"  && u.port === "80")) {
    u.port = "";
  }
  u.search   = "";
  u.hash     = "";
  u.pathname = u.pathname.replace(/\/$/, "") || "/";
  return u.toString();
}

function repoKey(url: string, title: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeUrl(url) + "|" + title)
    .digest("hex")
    .slice(0, 16);
}

export class ObjectRepository {
  private readonly dir: string;

  constructor(dir: string = REPO_DIR) {
    this.dir = dir;
  }

  get(url: string, title: string): RepoEntry | null {
    const file = this.filePath(url, title);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as RepoEntry;
    } catch {
      return null;
    }
  }

  set(url: string, title: string, elements: DetectedElement[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const key: RepoKey = { url: normalizeUrl(url), title };
    const entry: RepoEntry = { key, elements, capturedAt: new Date().toISOString() };
    const tmp = this.filePath(url, title) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2));
    fs.renameSync(tmp, this.filePath(url, title));
  }

  // Merge new elements into existing entry — existing elements with same id are replaced
  merge(url: string, title: string, elements: DetectedElement[]): void {
    const existing = this.get(url, title);
    if (!existing) { this.set(url, title, elements); return; }
    const map = new Map(existing.elements.map(e => [e.id, e]));
    for (const e of elements) map.set(e.id, e);
    this.set(url, title, Array.from(map.values()));
  }

  private filePath(url: string, title: string): string {
    return path.join(this.dir, `${repoKey(url, title)}.json`);
  }
}
