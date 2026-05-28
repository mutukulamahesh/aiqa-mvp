import * as childProcess from "child_process";
import type { ChildProcess } from "child_process";

// Windows-only (EPIC-15 scope). macOS requires Accessibility permissions
// granted manually and is not supported in this release.

export interface IDesktopAdapter {
  launch(appPath: string): Promise<void>;
  waitForWindow(titlePattern: string | RegExp, timeout?: number): Promise<void>;
  screenshot(): Promise<Buffer>;
  getScreenSize(): Promise<{ width: number; height: number }>;
  click(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  getWindowTitle(): Promise<string>;
  close(): Promise<void>;
}

// Win32 API call via PowerShell — reads foreground window title without any
// third-party dependency. Spawned with array args to avoid shell-escaping issues.
const GET_TITLE_SCRIPT = [
  "Add-Type @'",
  "using System.Runtime.InteropServices;",
  "public class WinTitle {",
  "  [DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();",
  "  [DllImport(\"user32.dll\")] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int c);",
  "}",
  "'@",
  "$h = [WinTitle]::GetForegroundWindow()",
  "$s = New-Object System.Text.StringBuilder 512",
  "[WinTitle]::GetWindowText($h, $s, 512) | Out-Null",
  "$s.ToString()",
].join("; ");

export class DesktopAdapter implements IDesktopAdapter {
  private proc:        ChildProcess | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nut:         any = null;
  private _screenSize: { width: number; height: number } | null = null;

  private async loadNut(): Promise<any> {
    if (this.nut) return this.nut;
    try {
      const mod = await import("@nut-tree-fork/nut-js" as string);
      this.nut  = mod;
      return this.nut;
    } catch {
      throw new Error(
        "[DesktopAdapter] @nut-tree-fork/nut-js is not installed. " +
        "Run: npm install --save-optional @nut-tree-fork/nut-js  " +
        "(~150MB optional dep — omit in Docker/CI with --omit=optional)",
      );
    }
  }

  async launch(appPath: string): Promise<void> {
    this.proc = childProcess.spawn(appPath, [], { detached: false, shell: false });
  }

  async waitForWindow(titlePattern: string | RegExp, timeout = 10_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const title  = await this.getWindowTitle();
        const matches =
          typeof titlePattern === "string"
            ? title.includes(titlePattern)
            : titlePattern.test(title);
        if (matches) return;
      } catch {
        // window not yet ready — keep polling
      }
      await new Promise<void>(r => setTimeout(r, 250));
    }
    throw new Error(
      `[DesktopAdapter] window matching "${String(titlePattern)}" not found within ${timeout}ms`,
    );
  }

  async screenshot(): Promise<Buffer> {
    const nut = await this.loadNut();
    const { PNG } = require("pngjs") as typeof import("pngjs");
    const img = await nut.screen.grab();
    // Cache dimensions from the grab so getScreenSize() avoids a second capture (M1 fix)
    this._screenSize = { width: img.width as number, height: img.height as number };
    const png = new PNG({ width: img.width, height: img.height });
    // nut-js returns BGRA on Windows; swap channels for PNG (RGBA)
    const src = Buffer.from(img.data as Uint8Array);
    for (let i = 0; i < src.length; i += 4) {
      png.data[i]     = src[i + 2]; // R ← B
      png.data[i + 1] = src[i + 1]; // G
      png.data[i + 2] = src[i];     // B ← R
      png.data[i + 3] = src[i + 3]; // A
    }
    return PNG.sync.write(png);
  }

  async getScreenSize(): Promise<{ width: number; height: number }> {
    if (this._screenSize) return this._screenSize;
    const nut = await this.loadNut();
    const img = await nut.screen.grab();
    this._screenSize = { width: img.width as number, height: img.height as number };
    return this._screenSize;
  }

  async click(x: number, y: number): Promise<void> {
    const nut = await this.loadNut();
    await nut.mouse.setPosition({ x, y });
    await nut.mouse.leftClick();
  }

  async typeText(text: string): Promise<void> {
    const nut = await this.loadNut();
    await nut.keyboard.type(text);
  }

  async pressKey(key: string): Promise<void> {
    const nut  = await this.loadNut();
    const keyVal = (nut.Key as Record<string, unknown>)[key];
    if (keyVal === undefined) {
      throw new Error(
        `[DesktopAdapter] Unknown key: "${key}". Use nut-js Key enum names (e.g. "Return", "Escape", "Tab").`,
      );
    }
    await nut.keyboard.pressKey(keyVal);
    await nut.keyboard.releaseKey(keyVal);
  }

  async getWindowTitle(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const ps = childProcess.spawn(
        "powershell",
        ["-NonInteractive", "-Command", GET_TITLE_SCRIPT],
        { timeout: 3000 },
      );
      let out = "";
      ps.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      ps.on("close", code => {
        if (code !== 0) { reject(new Error(`[DesktopAdapter] getWindowTitle failed (exit ${code})`)); return; }
        resolve(out.trim());
      });
      ps.on("error", reject);
    });
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

export class StubDesktopAdapter implements IDesktopAdapter {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private _screenSize:    { width: number; height: number };
  private _windowTitle:   string;
  private _screenshot:    Buffer;
  private _titleSequence: string[];
  private _titleCallIdx = 0;

  constructor(opts: {
    screenSize?:     { width: number; height: number };
    windowTitle?:    string;
    screenshot?:     Buffer;
    // Successive getWindowTitle() calls cycle through this list; falls back to windowTitle when exhausted (L2 fix)
    titleSequence?:  string[];
  } = {}) {
    this._screenSize    = opts.screenSize    ?? { width: 1920, height: 1080 };
    this._windowTitle   = opts.windowTitle   ?? "";
    this._screenshot    = opts.screenshot    ?? Buffer.alloc(0);
    this._titleSequence = opts.titleSequence ?? [];
  }

  async launch(appPath: string): Promise<void>                              { this.calls.push({ method: "launch",         args: [appPath]   }); }
  async waitForWindow(p: string | RegExp, t = 10_000): Promise<void>       { this.calls.push({ method: "waitForWindow",  args: [p, t]      }); }
  async screenshot(): Promise<Buffer>                                        { this.calls.push({ method: "screenshot",     args: []          }); return this._screenshot; }
  async getScreenSize(): Promise<{ width: number; height: number }>         { this.calls.push({ method: "getScreenSize",  args: []          }); return this._screenSize; }
  async click(x: number, y: number): Promise<void>                          { this.calls.push({ method: "click",         args: [x, y]      }); }
  async typeText(text: string): Promise<void>                               { this.calls.push({ method: "typeText",      args: [text]      }); }
  async pressKey(key: string): Promise<void>                                { this.calls.push({ method: "pressKey",      args: [key]       }); }
  async getWindowTitle(): Promise<string> {
    this.calls.push({ method: "getWindowTitle", args: [] });
    if (this._titleCallIdx < this._titleSequence.length) {
      return this._titleSequence[this._titleCallIdx++];
    }
    return this._windowTitle;
  }
  async close(): Promise<void>                                               { this.calls.push({ method: "close",         args: []          }); }
}
