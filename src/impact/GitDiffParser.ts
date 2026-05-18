import { spawnSync } from "child_process";

export interface GitDiffOptions {
  /** Ref to compare HEAD against. Supports any git ref: branch, commit, tag.
   *  Defaults to "origin/main". Uses three-dot syntax internally (A...B) to
   *  diff from the common ancestor — correct for feature branches behind main.
   *
   *  NOTE: requires a full clone (fetch-depth: 0 in CI). Shallow clones may
   *  produce incomplete diffs or fail entirely when the merge-base is not local. */
  base?: string;
  /** Working directory for the git command. Defaults to process.cwd(). */
  cwd?: string;
}

// ── Internal helper ────────────────────────────────────────────────────────────

function runGit(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; ok: boolean } {
  // spawnSync passes args as an array — no shell is invoked, eliminating
  // command-injection risk from user-supplied refs like --impact-only <base>.
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout:  15_000,
  });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ok:     result.status === 0 && !result.error,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

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

  const { stdout, stderr, ok } = runGit(["diff", "--name-only", `${base}...HEAD`], cwd);
  if (!ok) {
    throw new Error(`GitDiffParser: git diff failed — ${stderr.trim() || "unknown error"}`);
  }

  return stdout
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
  const { stdout, ok } = runGit(["rev-parse", "--show-toplevel"], cwd);
  return ok ? stdout.trim() : null;
}

/**
 * Returns true when the working directory is a shallow git clone.
 * Shallow clones (fetch-depth: 1) may lack the merge-base needed for
 * three-dot diff syntax, causing getChangedFiles() to fail or return
 * incomplete results.
 */
export function isShallowClone(cwd = process.cwd()): boolean {
  const { stdout, ok } = runGit(["rev-parse", "--is-shallow-repository"], cwd);
  return ok && stdout.trim() === "true";
}
