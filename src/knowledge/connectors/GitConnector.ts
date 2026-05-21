import * as cp from "child_process";
import { KnowledgeChunk } from "../types";
import { KnowledgeConnector } from "./KnowledgeConnector";
import { NaiveChunker } from "../chunkers/NaiveChunker";

const chunker = new NaiveChunker();

export class GitConnector implements KnowledgeConnector {
  readonly name = "git";

  private readonly lookbackDays: number;
  private readonly repoPath:     string;
  private readonly maxCommits:   number;

  constructor(opts: {
    lookbackDays?: number;   // default 30
    repoPath?:     string;   // default cwd
    maxCommits?:   number;   // default 200 — safety cap for large repos
  } = {}) {
    this.lookbackDays = opts.lookbackDays ?? 30;
    this.repoPath     = opts.repoPath ?? process.cwd();
    this.maxCommits   = opts.maxCommits ?? 200;
  }

  async fetch(): Promise<KnowledgeChunk[]> {
    const commits   = this.readCommits();
    const filesMap  = this.readFilesMap();
    const chunks: KnowledgeChunk[] = [];

    for (const commit of commits) {
      const files = filesMap.get(commit.hash) ?? [];
      const text  = this.commitToText(commit, files);
      if (!text) continue;
      chunks.push(...chunker.chunk(text, {
        sourceId:        commit.hash,
        sourceName:      this.name,
        type:            "git",
        tags:            commit.tags,
        sourceUpdatedAt: commit.date,
      }));
    }

    return chunks;
  }

  private readCommits(): GitCommit[] {
    try {
      const since  = `${this.lookbackDays} days ago`;
      const format = "%H\x1f%s\x1f%an\x1f%aI\x1f%b\x1e";
      const result = cp.spawnSync(
        "git",
        ["log", `--since=${since}`, `--format=${format}`, `--max-count=${this.maxCommits}`],
        { cwd: this.repoPath, encoding: "utf-8", timeout: 15_000 },
      );
      if (result.status !== 0 || !result.stdout) return [];

      return result.stdout
        .split("\x1e")
        .map(s => s.trim())
        .filter(Boolean)
        .map(raw => this.parseCommit(raw))
        .filter((c): c is GitCommit => c !== null);
    } catch {
      return [];
    }
  }

  // Returns a map of 12-char hash → list of changed file paths.
  // Uses a second git log pass with --name-only so parsing is unambiguous.
  private readFilesMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    try {
      const since  = `${this.lookbackDays} days ago`;
      const result = cp.spawnSync(
        "git",
        ["log", `--since=${since}`, "--name-only", "--format=%H", `--max-count=${this.maxCommits}`],
        { cwd: this.repoPath, encoding: "utf-8", timeout: 15_000 },
      );
      if (result.status !== 0 || !result.stdout) return map;

      // Output pattern: <full-hash>\n\nfile1\nfile2\n\n<full-hash>\n\n...
      let currentHash = "";
      for (const line of result.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // A 40-char hex string is a commit hash
        if (/^[0-9a-f]{40}$/.test(trimmed)) {
          currentHash = trimmed.slice(0, 12);
          if (!map.has(currentHash)) map.set(currentHash, []);
        } else if (currentHash) {
          map.get(currentHash)!.push(trimmed);
        }
      }
    } catch { /* non-fatal */ }
    return map;
  }

  private parseCommit(raw: string): GitCommit | null {
    const parts = raw.split("\x1f");
    if (parts.length < 4) return null;
    const [hash, subject, author, date, ...bodyParts] = parts;
    const body = bodyParts.join(" ").trim();

    // Extract tags from conventional commit prefix: feat(checkout): ... → ["checkout"]
    const scope = subject.match(/^[a-z]+\(([^)]+)\)/)?.[1];
    const tags  = scope ? scope.split(/[,/]/).map(t => t.trim()).filter(Boolean) : [];

    return { hash: hash.slice(0, 12), subject, author, date, body, tags };
  }

  private commitToText(c: GitCommit, files: string[]): string {
    const lines = [
      `[${c.hash}] ${c.subject}`,
      c.author ? `Author: ${c.author}` : "",
    ];
    if (files.length > 0) {
      lines.push(`Files changed:\n  ${files.slice(0, 30).join("\n  ")}`);
    }
    if (c.body) lines.push(c.body.slice(0, 400));
    return lines.filter(Boolean).join("\n").trim();
  }
}

interface GitCommit {
  hash:    string;
  subject: string;
  author:  string;
  date:    string;
  body:    string;
  tags:    string[];
}
