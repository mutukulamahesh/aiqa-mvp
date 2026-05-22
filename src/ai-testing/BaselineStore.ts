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

  read(key: string): BaselineEntry | null {
    const file = this.filePath(key);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as BaselineEntry;
    } catch {
      return null;
    }
  }

  write(key: string, entry: BaselineEntry): void {
    const file = this.filePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf-8");
  }

  private filePath(key: string): string {
    return path.join(this.basePath, `${key}.json`);
  }
}
