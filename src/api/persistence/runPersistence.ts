import * as fs   from "fs";
import * as path from "path";
import { RunJobMeta } from "../jobs/RunJob";

const RUNS_DIR = path.join(process.cwd(), ".aiqa", "runs");

export function runsBaseDir(): string { return RUNS_DIR; }
export function runDir(runId: string): string { return path.join(RUNS_DIR, runId); }

export async function writeMeta(meta: RunJobMeta): Promise<void> {
  const dir = runDir(meta.runId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export async function writeResults(runId: string, results: unknown): Promise<void> {
  const dir = runDir(runId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
}

export async function writeExploration(runId: string, exploration: unknown): Promise<void> {
  const dir = runDir(runId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, "exploration.json"), JSON.stringify(exploration, null, 2));
}

export async function readMeta(runId: string): Promise<RunJobMeta | null> {
  try {
    const raw    = await fs.promises.readFile(path.join(runDir(runId), "meta.json"), "utf-8");
    const parsed = JSON.parse(raw);
    // Validate required shape — rejects corrupt/attacker-modified files
    if (typeof parsed?.runId !== "string" || typeof parsed?.status !== "string") return null;
    return parsed as RunJobMeta;
  } catch {
    return null;
  }
}

export async function readResults(runId: string): Promise<unknown | null> {
  try {
    const raw = await fs.promises.readFile(path.join(runDir(runId), "results.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function readExploration(runId: string): Promise<unknown | null> {
  try {
    const raw = await fs.promises.readFile(path.join(runDir(runId), "exploration.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadRecentMetas(limit = 100): Promise<RunJobMeta[]> {
  try {
    await fs.promises.mkdir(RUNS_DIR, { recursive: true });
    const entries = await fs.promises.readdir(RUNS_DIR);
    const settled = await Promise.all(entries.map(id => readMeta(id)));
    const metas   = settled.filter((m): m is RunJobMeta => m !== null);
    metas.sort((a, b) => {
      const ta = a.startedAt ?? "";
      const tb = b.startedAt ?? "";
      return tb.localeCompare(ta);
    });
    return metas.slice(0, limit);
  } catch {
    return [];
  }
}
