import { chromium, BrowserContext, Page } from "playwright";
import { logger } from "../utils/logger";
import {
  InputField,
  PageLink,
  ExploredPage,
  ExplorationResult,
  ExplorerOptions,
} from "./types";

export type { InputField, PageLink, ExploredPage, ExplorationResult, ExplorerOptions };

// Default wall-clock cap for the entire crawl (5 minutes).
// Long crawls otherwise block the entire request with no cancellation path.
export const DEFAULT_EXPLORE_TIMEOUT_MS = 300_000;

const DEFAULT_IGNORE: RegExp[] = [
  /logout|signout|log-out|sign-out/i,
  /\.(pdf|zip|png|jpg|jpeg|gif|svg|ico|css|js)$/i,
  /^mailto:|^tel:|^javascript:/i,
  /^#/,
];

export class AppExplorer {
  async explore(url: string, opts: ExplorerOptions = {}): Promise<ExplorationResult> {
    const {
      headless          = true,
      maxPages          = 10,
      maxDepth          = 3,
      timeout           = 10_000,
      exploreTimeoutMs  = DEFAULT_EXPLORE_TIMEOUT_MS,
      ignorePatterns    = DEFAULT_IGNORE,
    } = opts;

    const browser = await chromium.launch({ headless });
    const deadline = Date.now() + exploreTimeoutMs;

    try {
      const baseUrl = new URL(url).origin;
      const visited = new Set<string>();
      const queue: Array<{ url: string; depth: number }> = [{ url: this.normalise(url), depth: 0 }];
      const pages:  ExploredPage[] = [];

      while (queue.length > 0 && pages.length < maxPages) {
        if (Date.now() > deadline) {
          process.stderr.write(
            `  [Explorer] Wall-clock timeout (${exploreTimeoutMs}ms) reached after ${pages.length} page(s) — stopping crawl early.\n`,
          );
          break;
        }
        const { url: current, depth } = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const page = await browser.newPage();
        try {
          await page.goto(current, { waitUntil: "domcontentloaded", timeout });
          const explored = await this.extractPage(page, baseUrl, ignorePatterns);
          pages.push({ url: current, ...explored });

          if (depth < maxDepth) {
            for (const link of explored.internalLinks) {
              if (!visited.has(link) && !queue.some(q => q.url === link)) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        } catch (err) {
          logger.warn(`[Explorer] Skipped ${current}: ${(err as Error).message}`);
        } finally {
          await page.close();
        }
      }

      return {
        baseUrl,
        exploredAt: new Date().toISOString(),
        pages,
        totalPages: pages.length,
        totalLinks: pages.reduce((n, p) => n + p.internalLinks.length, 0),
      };
    } finally {
      await browser.close();
    }
  }

  async exploreAuthenticated(
    authPageUrl: string,
    authPage:    ExploredPage,
    creds:       { username: string; password: string },
    opts:        ExplorerOptions = {},
  ): Promise<ExplorationResult> {
    const {
      headless         = true,
      maxPages         = 25,  // higher default than unauthenticated — internal apps have more pages
      maxDepth         = 3,
      timeout          = 15_000,
      exploreTimeoutMs = DEFAULT_EXPLORE_TIMEOUT_MS,
      ignorePatterns   = DEFAULT_IGNORE,
    } = opts;

    const browser  = await chromium.launch({ headless });
    const deadline = Date.now() + exploreTimeoutMs;

    try {
      const baseUrl = new URL(authPageUrl).origin;
      const context: BrowserContext = await browser.newContext();

      // ── Login ──────────────────────────────────────────────────────────────
      const postLoginUrl = await this.performLogin(
        context, authPageUrl, authPage, creds, timeout,
      );

      if (postLoginUrl === this.normalise(authPageUrl)) {
        logger.warn("[Explorer] Auth crawl: login did not redirect — credentials may be wrong");
        return { baseUrl, exploredAt: new Date().toISOString(), pages: [], totalPages: 0, totalLinks: 0 };
      }

      // ── Authenticated BFS crawl ────────────────────────────────────────────
      // Pages in the same context share cookies, so they stay logged in.
      const visited = new Set<string>();
      visited.add(this.normalise(authPageUrl)); // skip login page itself
      const queue: Array<{ url: string; depth: number }> = [{ url: postLoginUrl, depth: 0 }];
      const pages: ExploredPage[] = [];

      while (queue.length > 0 && pages.length < maxPages) {
        if (Date.now() > deadline) {
          process.stderr.write(
            `  [Explorer] Auth crawl wall-clock timeout (${exploreTimeoutMs}ms) reached after ${pages.length} page(s) — stopping.\n`,
          );
          break;
        }
        const { url: current, depth } = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const page = await context.newPage();
        try {
          await page.goto(current, { waitUntil: "load", timeout });

          // If we were redirected back to login, session broke — stop
          if (this.normalise(page.url()) === this.normalise(authPageUrl)) break;

          const explored = await this.extractPage(page, baseUrl, ignorePatterns);
          pages.push({ url: current, ...explored });

          if (depth < maxDepth) {
            for (const link of explored.internalLinks) {
              if (!visited.has(link) && !queue.some(q => q.url === link)) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
            // Discover SPA routes from both anchor clicks and nav button clicks
            const navRoutes = await this.discoverNavigationRoutes(page, baseUrl, ignorePatterns);
            for (const route of navRoutes) {
              const norm = this.normalise(route);
              if (!visited.has(norm) && !queue.some(q => q.url === norm)) {
                queue.push({ url: norm, depth: depth + 1 });
              }
            }
          }
        } catch (err) {
          logger.warn(`[Explorer] Auth crawl skipped ${current}: ${(err as Error).message}`);
        } finally {
          await page.close();
        }
      }

      return {
        baseUrl,
        exploredAt: new Date().toISOString(),
        pages,
        totalPages: pages.length,
        totalLinks: pages.reduce((n, p) => n + p.internalLinks.length, 0),
      };
    } finally {
      await browser.close();
    }
  }

  /**
   * Handles both single-step and multi-step (email → password on next page) login flows.
   * After filling the username, checks whether the password field is already visible.
   * If not (e.g. Google-style or Azure AD two-step), submits the first step and waits
   * for the password field to appear before continuing.
   */
  private async performLogin(
    context:     BrowserContext,
    authPageUrl: string,
    authPage:    ExploredPage,
    creds:       { username: string; password: string },
    timeout:     number,
  ): Promise<string> {
    const page = await context.newPage();
    try {
      await page.goto(authPageUrl, { waitUntil: "load", timeout });

      const usernameSelector = this.resolveUsernameSelector(authPage);
      const submitSelector   = this.resolveSubmitSelector(authPage);

      await page.fill(usernameSelector, creds.username);

      // Detect multi-step login: password field may not be on the first screen.
      // isVisible() returns false (not throws) when the element is absent.
      const passwordVisible = await page.isVisible('input[type="password"]').catch(() => false);

      if (!passwordVisible) {
        // Multi-step flow: submit email/username step, then wait for password field.
        logger.info("[Explorer] Multi-step login detected — submitting email step");
        await page.click(submitSelector);
        try {
          await page.waitForSelector('input[type="password"]', { timeout: 8_000 });
        } catch {
          logger.warn("[Explorer] Password field did not appear after email step — may be SSO/MFA, skipping auth crawl");
          return this.normalise(page.url());
        }
      }

      await page.fill('input[type="password"]', creds.password);

      // Re-resolve submit after DOM may have changed between steps
      const step2Submit = 'input[type="submit"], button[type="submit"], button[type="button"], button:not([type])';
      await page.click(step2Submit);
      await page.waitForLoadState("load", { timeout });

      return this.normalise(page.url());
    } finally {
      await page.close();
    }
  }

  private resolveUsernameSelector(authPage: ExploredPage): string {
    const emailInput = authPage.inputs.find(i =>
      i.type === "email" || i.name?.toLowerCase().includes("email")
    );
    if (emailInput?.name) return `input[name="${emailInput.name}"]`;

    const userInput = authPage.inputs.find(i =>
      i.name?.toLowerCase().includes("user") ||
      i.placeholder?.toLowerCase().includes("user") ||
      i.placeholder?.toLowerCase().includes("login")
    );
    if (userInput?.name) return `input[name="${userInput.name}"]`;

    return 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])';
  }

  private resolveSubmitSelector(authPage: ExploredPage): string {
    const submitInput = authPage.inputs.find(i => i.type === "submit");
    if (submitInput?.name) return `input[name="${submitInput.name}"]`;
    return 'input[type="submit"], button[type="submit"], button';
  }

  /**
   * Discovers SPA routes by intercepting history.pushState/replaceState while
   * simulating clicks on two categories of navigation elements:
   *
   * 1. Anchor tags with href="#" or href="" — the classic SPA nav pattern
   * 2. Buttons and links inside nav/aside/sidebar/menu containers — covers React
   *    dashboards where sidebar items are <button> or <li> elements calling
   *    router.push() directly rather than rendering <a href> links.
   *
   * Only pushState/replaceState calls are captured — full-page navigations are
   * handled by the BFS loop via <a href> link extraction.
   */
  private async discoverNavigationRoutes(
    page: Page,
    baseUrl: string,
    ignorePatterns: RegExp[],
  ): Promise<string[]> {
    try {
      const urls: string[] = await page.evaluate((base) => {
        const found: string[] = [];
        const orig = {
          push:    history.pushState.bind(history),
          replace: history.replaceState.bind(history),
        };

        // Intercept without actually navigating — capture target URL only
        (history as unknown as Record<string, unknown>).pushState =
          (_s: unknown, _t: string, url?: string) => {
            if (url) found.push(new URL(url, window.location.href).href);
          };
        (history as unknown as Record<string, unknown>).replaceState =
          (_s: unknown, _t: string, url?: string) => {
            if (url) found.push(new URL(url, window.location.href).href);
          };

        const SKIP = /logout|signout|log.out|sign.out|reset|delete|remove|clear/i;

        // 1. SPA anchor clicks (original behaviour)
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href="#"], a[href=""]')
        );
        for (const a of anchors.slice(0, 20)) {
          const txt = (a.textContent ?? "").trim();
          const cls = a.className ?? "";
          if (SKIP.test(txt) || SKIP.test(cls)) continue;
          a.click();
        }

        // 2. Navigation container buttons — covers sidebar/nav items rendered as
        //    <button> or plain <a> elements that fire router.push() on click.
        const NAV_SELECTORS = [
          "nav button", "nav a",
          "aside button", "aside a",
          '[role="navigation"] button', '[role="navigation"] a',
          '[class*="sidebar"] button', '[class*="sidebar"] a',
          '[class*="Sidebar"] button', '[class*="Sidebar"] a',
          '[class*="nav-"] button',    '[class*="Nav"] button',
          '[class*="menu"] a',         '[class*="Menu"] a',
        ].join(", ");

        const navEls = Array.from(document.querySelectorAll<HTMLElement>(NAV_SELECTORS));
        // Deduplicate — multiple selectors can match the same element
        const seen = new Set<Element>();
        for (const el of navEls.slice(0, 40)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const txt = (el.textContent ?? "").trim();
          const cls = el.className ?? "";
          if (SKIP.test(txt) || SKIP.test(cls)) continue;
          el.click();
        }

        (history as unknown as Record<string, unknown>).pushState   = orig.push;
        (history as unknown as Record<string, unknown>).replaceState = orig.replace;

        return [...new Set(found)].filter(u => u.startsWith(base));
      }, baseUrl);

      return urls.filter(u => !ignorePatterns.some(p => p.test(u)));
    } catch {
      return [];
    }
  }

  private async extractPage(
    page: Page,
    baseUrl: string,
    ignore: RegExp[],
  ): Promise<Omit<ExploredPage, "url">> {
    const data = await page.evaluate(() => ({
      title: document.title,
      headings: Array.from(document.querySelectorAll("h1, h2, h3"))
        .map(el => el.textContent?.trim() ?? "")
        .filter(Boolean),
      buttons: Array.from(
        document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")
      )
        .map(el => el.textContent?.trim() ?? (el as HTMLInputElement).value ?? "")
        .filter(Boolean),
      inputs: Array.from(
        document.querySelectorAll("input:not([type='hidden']), textarea, select")
      ).map(el => ({
        type:        (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
        name:        (el as HTMLInputElement).name        || undefined,
        placeholder: (el as HTMLInputElement).placeholder || undefined,
      })),
      links: Array.from(document.querySelectorAll("a[href]")).map(el => ({
        text: el.textContent?.trim() ?? "",
        href: (el as HTMLAnchorElement).href,
      })),
    }));

    const shouldIgnore = (href: string) =>
      ignore.some(pattern => pattern.test(href));

    const internalLinks = [
      ...new Set(
        data.links
          .map(l => this.normalise(l.href))
          .filter(href =>
            href.startsWith(baseUrl) &&
            href !== page.url() &&
            !shouldIgnore(href)
          )
      ),
    ];

    return {
      title:    data.title,
      headings: data.headings,
      buttons:  [...new Set(data.buttons)],
      inputs:   data.inputs,
      links:    data.links,
      internalLinks,
    };
  }

  private normalise(url: string): string {
    try {
      const u = new URL(url);
      u.hash   = "";
      u.search = "";
      return u.toString().replace(/\/$/, "");
    } catch {
      return url;
    }
  }
}
