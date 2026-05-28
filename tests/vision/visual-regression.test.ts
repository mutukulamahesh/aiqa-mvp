import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { VisualRegression } from "../../src/vision/VisualRegression";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require("pngjs") as typeof import("pngjs");

function makePng(r: number, g: number, b: number, size = 4): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    png.data[idx]     = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `aiqa-vr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── snapshot ──────────────────────────────────────────────────────────────────

describe("VisualRegression.snapshot", () => {
  test("saves baseline file when it does not exist", async () => {
    const dir = tmpDir();
    const vr  = new VisualRegression(dir);
    const buf = makePng(255, 0, 0);
    await vr.snapshot("snap1", { screenshotBuffer: async () => buf });
    expect(fs.existsSync(path.join(dir, "snap1.png"))).toBe(true);
  });

  test("does not overwrite existing baseline without update:true", async () => {
    const dir  = tmpDir();
    const vr   = new VisualRegression(dir);
    const red  = makePng(255, 0, 0);
    const blue = makePng(0, 0, 255);
    await vr.snapshot("stable", { screenshotBuffer: async () => red });
    await vr.snapshot("stable", { screenshotBuffer: async () => blue });
    expect(fs.readFileSync(path.join(dir, "stable.png"))).toEqual(red);
  });

  test("overwrites baseline when update is true", async () => {
    const dir  = tmpDir();
    const vr   = new VisualRegression(dir);
    const red  = makePng(255, 0, 0);
    const blue = makePng(0, 0, 255);
    await vr.snapshot("updatable", { screenshotBuffer: async () => red });
    await vr.snapshot("updatable", { screenshotBuffer: async () => blue }, { update: true });
    expect(fs.readFileSync(path.join(dir, "updatable.png"))).toEqual(blue);
  });
});

// ── compare ───────────────────────────────────────────────────────────────────

describe("VisualRegression.compare", () => {
  test("throws when no baseline exists", async () => {
    const vr  = new VisualRegression(tmpDir());
    const buf = makePng(0, 255, 0);
    await expect(
      vr.compare("no-baseline", { screenshotBuffer: async () => buf }),
    ).rejects.toThrow(/no baseline/i);
  });

  test("returns match:true and diffPercent:0 for identical images", async () => {
    const dir = tmpDir();
    const vr  = new VisualRegression(dir);
    const buf = makePng(128, 128, 128);
    await vr.snapshot("identical", { screenshotBuffer: async () => buf }, { update: true });
    const result = await vr.compare("identical", { screenshotBuffer: async () => buf });
    expect(result.match).toBe(true);
    expect(result.diffPercent).toBe(0);
  });

  test("returns match:false when images differ beyond threshold", async () => {
    const dir  = tmpDir();
    const vr   = new VisualRegression(dir);
    const red  = makePng(255, 0, 0);
    const blue = makePng(0, 0, 255);
    await vr.snapshot("differ", { screenshotBuffer: async () => red }, { update: true });
    const result = await vr.compare("differ", { screenshotBuffer: async () => blue }, { max_diff_percent: 0.01 });
    expect(result.match).toBe(false);
    expect(result.diffPercent).toBeGreaterThan(0);
  });

  test("writes diff image to disk on failure", async () => {
    const dir  = tmpDir();
    const vr   = new VisualRegression(dir);
    const red  = makePng(255, 0, 0);
    const blue = makePng(0, 0, 255);
    await vr.snapshot("diff-img", { screenshotBuffer: async () => red }, { update: true });
    const result = await vr.compare("diff-img", { screenshotBuffer: async () => blue }, { max_diff_percent: 0.01 });
    expect(result.diffPath).toBeTruthy();
    expect(fs.existsSync(result.diffPath!)).toBe(true);
  });

  test("returns match:false and diffPercent:100 for size mismatch", async () => {
    const dir   = tmpDir();
    const vr    = new VisualRegression(dir);
    const small = makePng(128, 128, 128, 2);
    const large = makePng(128, 128, 128, 4);
    await vr.snapshot("size-mismatch", { screenshotBuffer: async () => small }, { update: true });
    const result = await vr.compare("size-mismatch", { screenshotBuffer: async () => large });
    expect(result.match).toBe(false);
    expect(result.diffPercent).toBe(100);
  });

  test("no diffPath returned on successful match", async () => {
    const dir = tmpDir();
    const vr  = new VisualRegression(dir);
    const buf = makePng(64, 64, 64);
    await vr.snapshot("no-diff-path", { screenshotBuffer: async () => buf }, { update: true });
    const result = await vr.compare("no-diff-path", { screenshotBuffer: async () => buf });
    expect(result.diffPath).toBeUndefined();
  });
});
