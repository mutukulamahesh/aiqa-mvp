import { execSync } from "child_process";

export interface GitDiffOptions {
  /** Ref to compare HEAD against. Supports any git ref: branch, commit, tag.
   *  Defaults to "origin/main". Use three-dot syntax internally (A...B) so we
   *  diff from the common ancestor — correct for feature branches that may be
   *  behind main. */
  base?: string;
  /** Working directory for the git command. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * Returns the list of files changed between <base> and HEAD using
 * `git diff --name-only base...HEAD`.
 *
 * Paths are returned exactly as git reports them (relative to the git root,
 * forward-slash separated on all platforms).
 *
 * Throws if git is unavailable or the base ref does not exist.
 */
export function getChangedFiles(opts: GitDiffOptions = {}): string[] {
  const base = opts.base ?? "origin/main";
  const cwd  = opts.cwd  ?? process.cwd();

  let output: string;
  try {
    output = execSync(`git diff --name-only ${base}...HEAD`, {
      cwd,
      encoding: "utf-8",
      timeout:  15_000,
      stdio:    ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = (err as { stderr?: string; message?: string }).stderr?.trim()
              || (err as Error).message;
    throw new Error(`GitDiffParser: git diff failed — ${msg}`);
  }

  return output
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}

/**
 * Returns the git repository root (absolute path), or null if not in a repo.
 * Used to resolve test-file paths relative to the repo root when comparing
 * against git-reported paths.
 */
export function getGitRoot(cwd = process.cwd()): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      timeout:  5_000,
      stdio:    ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
