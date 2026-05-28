import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { VisualSnapshotHandler } from "../../src/handlers/VisualSnapshotHandler";
import { ExecutionContext }       from "../../src/execution/ExecutionContext";
import { AdapterActions }         from "../../src/adapter/AdapterActions";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require("pngjs") as typeof import("pngjs");

function makePng(r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < 4; i++) {
    const idx       = i * 4;
    png.data[idx]   = r;
    png.data[idx+1] = g;
    png.data[idx+2] = b;
    png.data[idx+3] = 255;
  }
  return PNG.sync.write(png);
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `aiqa-vs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAdapter(buf: Buffer): AdapterActions {
  return {
    navigate:                async () => {},
    click:                   async () => {},
    fill:                    async () => {},
    assertTextVisible:       async () => {},
    assertUrlContains:       async () => {},
    assertElementVisible:    async () => {},
    assertElementNotVisible: async () => {},
    screenshot:              async () => {},
    currentUrl:              async () => "http://localhost/",
    waitForSelector:         async () => {},
    waitForUrl:              async () => {},
    getElementText:          async () => "",
    getElementAttribute:     async () => "",
    screenshotBuffer:        async () => buf,
    getViewportSize:         async () => ({ width: 1280, height: 720 }),
    countLocator:            async () => 0,
  };
}

// ── update mode ───────────────────────────────────────────────────────────────

describe("VisualSnapshotHandler — update mode", () => {
  test("captures baseline file when update:true", async () => {
    const dir     = tmpDir();
    const handler = new VisualSnapshotHandler(dir);
    await handler.execute(
      { action: "visual_snapshot", name: "snap1", update: true },
      makeAdapter(makePng(255, 0, 0)),
      new ExecutionContext(),
    );
    expect(fs.existsSync(path.join(dir, "snap1.png"))).toBe(true);
  });

  test("stores {match:true, diffPercent:0} in store_as when in update mode", async () => {
    const dir     = tmpDir();
    const handler = new VisualSnapshotHandler(dir);
    const ctx     = new ExecutionContext();
    await handler.execute(
      { action: "visual_snapshot", name: "s", update: true, store_as: "res" },
      makeAdapter(makePng(0, 255, 0)),
      ctx,
    );
    const res = ctx.get("res") as { match: boolean; diffPercent: number };
    expect(res.match).toBe(true);
    expect(res.diffPercent).toBe(0);
  });
});

// ── compare mode ──────────────────────────────────────────────────────────────

describe("VisualSnapshotHandler — compare mode", () => {
  test("passes when current matches baseline", async () => {
    const dir     = tmpDir();
    const handler = new VisualSnapshotHandler(dir);
    const buf     = makePng(100, 100, 100);
    await handler.execute(
      { action: "visual_snapshot", name: "match", update: true },
      makeAdapter(buf),
      new ExecutionContext(),
    );
    await expect(
      handler.execute(
        { action: "visual_snapshot", name: "match" },
        makeAdapter(buf),
        new ExecutionContext(),
      ),
    ).resolves.toBeUndefined();
  });

  test("throws AssertionError when images differ beyond threshold", async () => {
    const dir     = tmpDir();
    const handler = new VisualSnapshotHandler(dir);
    await handler.execute(
      { action: "visual_snapshot", name: "diff", update: true },
      makeAdapter(makePng(255, 0, 0)),
      new ExecutionContext(),
    );
    await expect(
      handler.execute(
        { action: "visual_snapshot", name: "diff", max_diff_percent: 0.01 },
        makeAdapter(makePng(0, 0, 255)),
        new ExecutionContext(),
      ),
    ).rejects.toThrow(/differs/i);
  });

  test("stores compare result in store_as on success", async () => {
    const dir     = tmpDir();
    const handler = new VisualSnapshotHandler(dir);
    const buf     = makePng(50, 50, 50);
    await handler.execute(
      { action: "visual_snapshot", name: "stored", update: true },
      makeAdapter(buf),
      new ExecutionContext(),
    );
    const ctx = new ExecutionContext();
    await handler.execute(
      { action: "visual_snapshot", name: "stored", store_as: "vr" },
      makeAdapter(buf),
      ctx,
    );
    const res = ctx.get("vr") as { match: boolean; diffPercent: number };
    expect(res.match).toBe(true);
    expect(res.diffPercent).toBe(0);
  });

  test("throws when no baseline exists", async () => {
    const handler = new VisualSnapshotHandler(tmpDir());
    await expect(
      handler.execute(
        { action: "visual_snapshot", name: "no-baseline" },
        makeAdapter(makePng(0, 0, 0)),
        new ExecutionContext(),
      ),
    ).rejects.toThrow(/no baseline/i);
  });
});
