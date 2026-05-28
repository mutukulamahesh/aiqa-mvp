import * as fs   from "fs";
import * as path from "path";

const BASELINE_DIR = path.resolve(process.cwd(), ".aiqa", "visual-baselines");

export interface CompareResult {
  match:       boolean;
  diffPercent: number;   // 0–100 (percentage of pixels that differ)
  diffPath?:   string;   // path to diff image, only written when match is false
}

export interface SnapshotSource {
  screenshotBuffer(): Promise<Buffer>;
}

export class VisualRegression {
  private readonly dir: string;

  constructor(dir: string = BASELINE_DIR) {
    this.dir = dir;
  }

  async snapshot(name: string, source: SnapshotSource, opts: { update?: boolean } = {}): Promise<void> {
    const baselinePath = this.baselinePath(name);
    const exists = fs.existsSync(baselinePath);

    if (exists && !opts.update) return;

    const buf = await source.screenshotBuffer();
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(baselinePath, buf);
    if (process.stderr.isTTY) {
      process.stderr.write(`[visual] baseline saved: ${baselinePath}\n`);
    }
  }

  async compare(
    name:   string,
    source: SnapshotSource,
    opts:   { max_diff_percent?: number; sensitivity?: number } = {},
  ): Promise<CompareResult> {
    const baselinePath = this.baselinePath(name);
    if (!fs.existsSync(baselinePath)) {
      throw new Error(
        `[visual] No baseline found for "${name}". ` +
        `Run with update: true first to capture a baseline.`,
      );
    }

    const maxDiffPercent = opts.max_diff_percent ?? 0.02;
    const sensitivity    = opts.sensitivity      ?? 0.1;

    const currentBuf  = await source.screenshotBuffer();
    const baselineBuf = fs.readFileSync(baselinePath);

    const { PNG }     = await import("pngjs" as string) as typeof import("pngjs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pixelmatch = (await import("pixelmatch" as string)) as any;

    const baseline = PNG.sync.read(baselineBuf);
    const current  = PNG.sync.read(currentBuf);

    if (baseline.width !== current.width || baseline.height !== current.height) {
      return {
        match:       false,
        diffPercent: 100,
      };
    }

    const { width, height } = baseline;
    const diff  = new PNG({ width, height });
    const fn = typeof pixelmatch === "function" ? pixelmatch : pixelmatch.default;
    const numDiffPixels = fn(
      baseline.data,
      current.data,
      diff.data,
      width,
      height,
      { threshold: sensitivity },
    );

    const diffPercent = (numDiffPixels / (width * height)) * 100;
    const match       = diffPercent <= maxDiffPercent * 100;

    if (!match) {
      const diffPath = this.diffPath(name);
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
      return { match, diffPercent, diffPath };
    }

    return { match, diffPercent };
  }

  private baselinePath(name: string): string {
    return path.join(this.dir, `${name}.png`);
  }

  private diffPath(name: string): string {
    return path.join(this.dir, `${name}.diff.png`);
  }
}
