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
import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import { AdapterActions } from "./AdapterActions";

export interface PlaywrightAdapterOptions {
  headless: boolean;
  timeout?: number;      // per-action timeout in ms (default: 10 000)
  slowMo?: number;       // slow-mo ms so you can watch it run (default: 0)
}

export class PlaywrightAdapter implements AdapterActions {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private timeout: number;

  constructor(private opts: PlaywrightAdapterOptions) {
    this.timeout = opts.timeout ?? 10_000;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Launch the browser. Called lazily on first UI action if not called explicitly. */
  async launch(): Promise<void> {
    if (this.browser) return;
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

  /** Ensure the browser is running before any UI operation. */
  private async ensureLaunched(): Promise<Page> {
    if (!this.page) await this.launch();
    return this.page!;
  }

  // ── AdapterActions ───────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const page = await this.ensureLaunched();
    await page.goto(url, { waitUntil: "domcontentloaded" });
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
    const page = await this.ensureLaunched();
    const el = page.getByText(text, { exact: false });
    await el
      .first()
      .waitFor({ state: "visible", timeout: this.timeout })
      .catch(() => {
        throw new Error(`assertTextVisible: text "${text}" not found on page`);
      });
  }

  async assertUrlContains(substring: string): Promise<void> {
    const page = await this.ensureLaunched();
    const current = page.url();
    if (!current.includes(substring)) {
      throw new Error(
        `assertUrlContains: expected URL to contain "${substring}", got "${current}"`
      );
    }
  }

  async assertElementVisible(locator: string): Promise<void> {
    const el = await this.resolveLocator(locator);
    await el.first().waitFor({ state: "visible", timeout: this.timeout }).catch(() => {
      throw new Error(`assertElementVisible: element "${locator}" not visible on page`);
    });
  }

  async screenshot(filePath: string): Promise<void> {
    if (!this.page) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await this.page.screenshot({ path: filePath, fullPage: true });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async resolveLocator(descriptor: string): Promise<Locator> {
    const page = await this.ensureLaunched();

    // Strategy 1 — CSS or XPath (starts with # . [ // @)
    if (/^[#.\[/@]/.test(descriptor)) {
      return page.locator(descriptor);
    }

    const strategies: Locator[] = [
      page.getByRole("button", { name: descriptor, exact: true }),
      page.getByRole("link",   { name: descriptor, exact: true }),
      page.getByLabel(descriptor,       { exact: true }),
      page.getByPlaceholder(descriptor, { exact: true }),
      page.getByText(descriptor,        { exact: true }),
      page.getByLabel(descriptor,       { exact: false }),
      page.getByPlaceholder(descriptor, { exact: false }),
      page.getByRole("button", { name: descriptor, exact: false }),
      page.getByRole("link",   { name: descriptor, exact: false }),
      page.getByText(descriptor,        { exact: false }),
    ];

    const union = strategies.reduce((acc, loc) => acc.or(loc));
    await union.first().waitFor({ state: "visible", timeout: this.timeout }).catch(() => {
      throw new Error(`Timeout ${this.timeout}ms exceeded. Could not resolve locator for: "${descriptor}"`);
    });
    return union.first();
  }
}
