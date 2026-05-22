import * as fs   from "fs";
import * as path from "path";

export interface BaselineEntry {
  embedding:  number[];
  response:   string;
  recordedAt: string;
}

export class BaselineStore {
  constructor(private readonly basePath: string = "tests/baselines") {}

  get recordMode(): boolean {
    return process.env.AIQA_BASELINE_RECORD === "true";
  }

  async read(key: string): Promise<BaselineEntry | null> {
    const file = this.filePath(key);
    try {
      await fs.promises.access(file);
    } catch {
      return null;  // file not found
    }
    let content: string;
    try {
      content = await fs.promises.readFile(file, "utf-8");
      return JSON.parse(content) as BaselineEntry;
    } catch (err) {
      throw new Error(`BaselineStore: corrupt baseline "${file}" — ${(err as Error).message}`);
    }
  }

  async write(key: string, entry: BaselineEntry): Promise<void> {
    const file = this.filePath(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(entry, null, 2), "utf-8");
  }

  // M1: reject keys containing path traversal sequences
  private filePath(key: string): string {
    const base     = path.resolve(this.basePath);
    const resolved = path.resolve(base, `${key}.json`);
    if (!resolved.startsWith(base + path.sep)) {
      throw new Error(`BaselineStore: invalid baseline_key "${key}" — path traversal not allowed`);
    }
    return resolved;
  }
}
