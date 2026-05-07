/**
 * PlaywrightAdapter — implements AdapterActions using Playwright.
 *
 * Locator resolution order for click/fill/assert:
 *   1. CSS/XPath prefix (#, ., [, /, @)  → page.locator() directly
 *   2. Healer cache hit                  → page.locator(cachedSelector) directly
 *   3. Semantic strategies               → getByRole / getByLabel / getByPlaceholder / getByText
 *   4. Self-healing (LLM)               → DOM extraction + LLM selector suggestion + cache write
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import { AdapterActions } from "./AdapterActions";
import { AssertionError, TransientError } from "../errors";
import { SelectorHealer } from "../healer/SelectorHealer";
import { wlog } from "../execution/WorkerContext";

export interface PlaywrightAdapterOptions {
  headless: boolean;
  timeout?: number;      // per-action timeout in ms (default: 10 000)
  slowMo?: number;       // slow-mo ms so you can watch it run (default: 0)
  healer?: SelectorHealer;
}

export class PlaywrightAdapter implements AdapterActions {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly timeout: number;
  private readonly healer: SelectorHealer | undefined;

  constructor(private opts: PlaywrightAdapterOptions) {
    this.timeout = opts.timeout ?? 10_000;
    this.healer  = opts.healer;
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
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(err => {
      throw new TransientError((err as Error).message);
    });
  }

  async click(locator: string): Promise<void> {
    await this.resolveAndAct(locator, el => el.click(), err => new TransientError(err.message));
  }

  async fill(locator: string, value: string): Promise<void> {
    await this.resolveAndAct(locator, el => el.fill(value), err => new TransientError(err.message));
  }

  async assertTextVisible(text: string): Promise<void> {
    const page = await this.ensureLaunched();
    const el = page.getByText(text, { exact: false });
    await el
      .first()
      .waitFor({ state: "visible", timeout: this.timeout })
      .catch(() => {
        throw new AssertionError(`assertTextVisible: text "${text}" not found on page`);
      });
  }

  async assertUrlContains(substring: string): Promise<void> {
    const page = await this.ensureLaunched();
    await page
      .waitForURL(url => url.toString().includes(substring), { timeout: this.timeout })
      .catch(() => {
        throw new AssertionError(
          `assertUrlContains: expected URL to contain "${substring}", got "${page.url()}"`
        );
      });
  }

  async assertElementVisible(locator: string): Promise<void> {
    const el = await this.resolveLocator(locator);
    await el.first().waitFor({ state: "visible", timeout: this.timeout }).catch(() => {
      throw new AssertionError(`assertElementVisible: element "${locator}" not visible on page`);
    });
  }

  async currentUrl(): Promise<string> {
    const page = await this.ensureLaunched();
    return page.url();
  }

  async waitForSelector(selector: string): Promise<void> {
    const page = await this.ensureLaunched();
    await page.locator(selector).first().waitFor({ state: "visible", timeout: this.timeout })
      .catch(() => { throw new TransientError(`waitForSelector: "${selector}" not visible within ${this.timeout}ms`); });
  }

  async waitForUrl(substring: string): Promise<void> {
    const page = await this.ensureLaunched();
    await page.waitForURL(url => url.toString().includes(substring), { timeout: this.timeout })
      .catch(() => { throw new TransientError(`waitForUrl: URL did not contain "${substring}" within ${this.timeout}ms`); });
  }

  async getElementText(selector: string): Promise<string> {
    const page = await this.ensureLaunched();
    return await page.locator(selector).first().innerText({ timeout: this.timeout });
  }

  async getElementAttribute(selector: string, attribute: string): Promise<string> {
    const page = await this.ensureLaunched();
    return (await page.locator(selector).first().getAttribute(attribute, { timeout: this.timeout })) ?? "";
  }

  async screenshot(filePath: string): Promise<void> {
    if (!this.page) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await this.page.screenshot({ path: filePath, fullPage: true });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resolves a locator and performs an action. If the action fails on a healed/cached
   * selector, evicts the stale cache entry and re-heals once before re-throwing.
   */
  private async resolveAndAct<T>(
    descriptor: string,
    action:     (el: Locator) => Promise<T>,
    wrapError:  (err: Error)  => Error,
  ): Promise<T> {
    const el = await this.resolveLocator(descriptor);
    try {
      return await action(el);
    } catch (err) {
      const error = err as Error;
      const page  = this.page;  // non-null: resolveLocator called ensureLaunched first

      if (page && this.healer && !/^[#.\[/@]/.test(descriptor)) {
        const pageUrl = page.url();
        this.healer.markFailure(pageUrl, descriptor);

        const selector = await this.healer.heal(descriptor, page, pageUrl);
        if (selector) {
          wlog(`         🔧 [Healer] "${descriptor}" → ${selector}  (re-healed after action failure)`);
          return await action(page.locator(selector)).catch(err2 => {
            throw wrapError(err2 as Error);
          });
        }
      }

      throw wrapError(error);
    }
  }

  private async resolveLocator(descriptor: string): Promise<Locator> {
    const page = await this.ensureLaunched();

    // Strategy 1 — CSS or XPath (starts with # . [ / @) — use directly
    if (/^[#.\[/@]/.test(descriptor)) {
      return page.locator(descriptor);
    }

    // Strategy 2 — Healer cache (multi-selector fallback, count-validated, ranked by score)
    if (this.healer) {
      const cached = await this.healer.tryCache(page.url(), descriptor, page);
      if (cached) {
        wlog(`         🔧 [Healer] "${descriptor}" → ${cached}  (from cache)`);
        return page.locator(cached);
      }
    }

    // Strategy 3 — Semantic Playwright locators
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
    try {
      await union.first().waitFor({ state: "visible", timeout: this.timeout });
      return union.first();
    } catch {
      // Strategy 4 — Self-healing via LLM
      if (this.healer) {
        const selector = await this.healer.heal(descriptor, page, page.url());
        if (selector) {
          wlog(`         🔧 [Healer] "${descriptor}" → ${selector}  (healed)`);
          return page.locator(selector);
        }
      }
      throw new TransientError(
        `Timeout ${this.timeout}ms exceeded. Could not resolve locator for: "${descriptor}"`,
      );
    }
  }
}
