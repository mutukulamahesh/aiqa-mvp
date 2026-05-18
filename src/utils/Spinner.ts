const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

/**
 * Minimal TTY spinner — no external deps.
 * Falls back to a no-op in non-TTY environments (CI, pipes).
 */
export class Spinner {
  private timer:   ReturnType<typeof setInterval> | null = null;
  private frame  = 0;
  private active = false;

  start(text: string): void {
    if (!process.stdout.isTTY) return;
    this.active = true;
    this.frame  = 0;
    process.stdout.write(`${FRAMES[0]} ${text}`);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      process.stdout.write(`\r${FRAMES[this.frame]} ${text}`);
    }, INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  succeed(text: string): void {
    this.clear();
    console.log(`✅ ${text}`);
  }

  fail(text: string): void {
    this.clear();
    console.log(`❌ ${text}`);
  }

  stop(text?: string): void {
    this.clear();
    if (text) console.log(text);
  }

  private clear(): void {
    if (!this.active) return;
    if (this.timer) clearInterval(this.timer);
    this.timer  = null;
    this.active = false;
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  }
}
