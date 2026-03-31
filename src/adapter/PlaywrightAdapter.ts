/**
 * PlaywrightAdapter — implements AdapterActions using Playwright.
 *
 * Strategy for click/fill locators (in priority order):
 *   1. Exact text match via getByText()
 *   2. Role-based locator via getByRole()
 *   3. Label-based locator via getByLabel()
 *   4. Placeholder-based locator via getByPlaceholder()
 *   5. CSS/XPath selector (if the string looks like one)
 *
 * This smart fallback means DSL authors can write human-readable
 * names ("More information", "Submit") instead of brittle CSS selectors.
 */
import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import { AdapterActions } from "./AdapterActions";

export interface PlaywrightAdapterOptions {
  headless: boolean;
  timeout?: number;      // per-action timeout in ms (default: 10 000)
  slowMo?: number;       // slow-mo ms so you can watch it run (default: 0)
}

export class PlaywrightAdapter implements AdapterActions {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private timeout: number;

  constructor(private opts: PlaywrightAdapterOptions) {
    this.timeout = opts.timeout ?? 10_000;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo ?? 0,
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  // ── AdapterActions ───────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async click(locator: string): Promise<void> {
    const el = await this.resolveLocator(locator);
    await el.click();
  }

  async fill(locator: string, value: string): Promise<void> {
    const el = await this.resolveLocator(locator);
    await el.fill(value);
  }

  async assertTextVisible(text: string): Promise<void> {
    // getByText with exact:false so substring matches work
    const el = this.page.getByText(text, { exact: false });
    await el
      .first()
      .waitFor({ state: "visible", timeout: this.timeout })
      .catch(() => {
        throw new Error(`assertTextVisible: text "${text}" not found on page`);
      });
  }

  async assertUrlContains(substring: string): Promise<void> {
    const current = this.page.url();
    if (!current.includes(substring)) {
      throw new Error(
        `assertUrlContains: expected URL to contain "${substring}", got "${current}"`
      );
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async resolveLocator(descriptor: string): Promise<Locator> {
    // Strategy 1 — CSS or XPath (starts with # . [ // @)
    if (/^[#.\[/@]/.test(descriptor)) {
      return this.page.locator(descriptor);
    }

    const strategies: Locator[] = [
      this.page.getByRole("button", { name: descriptor, exact: true }),
      this.page.getByRole("link", { name: descriptor, exact: true }),
      this.page.getByLabel(descriptor, { exact: true }),
      this.page.getByPlaceholder(descriptor, { exact: true }),
      this.page.getByText(descriptor, { exact: true }),
      
      this.page.getByLabel(descriptor, { exact: false }),
      this.page.getByPlaceholder(descriptor, { exact: false }),
      this.page.getByRole("button", { name: descriptor, exact: false }),
      this.page.getByRole("link", { name: descriptor, exact: false }),
      this.page.getByText(descriptor, { exact: false }),
    ];

    const start = Date.now();
    // Poll through strategies in priority order until one finds an element or timeout is reached
    while (Date.now() - start < this.timeout) {
      for (const loc of strategies) {
        try {
          if ((await loc.count()) > 0) {
            return loc.first();
          }
        } catch {
          // ignore parsing errors (e.g. if we add a raw css fallback that throws)
        }
      }
      // Wait 100ms before checking again
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`Timeout ${this.timeout}ms exceeded. Could not resolve locator for: "${descriptor}"`);
  }
}
