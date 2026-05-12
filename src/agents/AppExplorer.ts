import { chromium, BrowserContext, Page } from "playwright";
import {
  InputField,
  PageLink,
  ExploredPage,
  ExplorationResult,
  ExplorerOptions,
} from "./types";

export type { InputField, PageLink, ExploredPage, ExplorationResult, ExplorerOptions };

const DEFAULT_IGNORE: RegExp[] = [
  /logout|signout|log-out|sign-out/i,
  /\.(pdf|zip|png|jpg|jpeg|gif|svg|ico|css|js)$/i,
  /^mailto:|^tel:|^javascript:/i,
  /^#/,
];

export class AppExplorer {
  async explore(url: string, opts: ExplorerOptions = {}): Promise<ExplorationResult> {
    const {
      headless       = true,
      maxPages       = 10,
      maxDepth       = 3,
      timeout        = 10_000,
      ignorePatterns = DEFAULT_IGNORE,
    } = opts;

    const browser = await chromium.launch({ headless });
    try {
      const baseUrl = new URL(url).origin;
      const visited = new Set<string>();
      const queue: Array<{ url: string; depth: number }> = [{ url: this.normalise(url), depth: 0 }];
      const pages:  ExploredPage[] = [];

      while (queue.length > 0 && pages.length < maxPages) {
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
          console.warn(`  [Explorer] Skipped ${current}: ${(err as Error).message}`);
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
      headless       = true,
      maxPages       = 15,
      maxDepth       = 3,
      timeout        = 15_000,
      ignorePatterns = DEFAULT_IGNORE,
    } = opts;

    const browser = await chromium.launch({ headless });
    try {
      const baseUrl = new URL(authPageUrl).origin;
      const context: BrowserContext = await browser.newContext();

      // ── Login ──────────────────────────────────────────────────────────────
      let postLoginUrl: string;
      const loginPage = await context.newPage();
      try {
        await loginPage.goto(authPageUrl, { waitUntil: "load", timeout });

        const usernameSelector = this.resolveUsernameSelector(authPage);
        const submitSelector   = this.resolveSubmitSelector(authPage);

        await loginPage.fill(usernameSelector, creds.username);
        await loginPage.fill('input[type="password"]', creds.password);
        await loginPage.click(submitSelector);
        // wait for load (not just DOMContentLoaded) so SPA frameworks have time to mount
        await loginPage.waitForLoadState("load", { timeout });

        postLoginUrl = this.normalise(loginPage.url());
      } finally {
        await loginPage.close();
      }

      if (postLoginUrl === this.normalise(authPageUrl)) {
        console.warn("  [Explorer] Auth crawl: login did not redirect — credentials may be wrong");
        return { baseUrl, exploredAt: new Date().toISOString(), pages: [], totalPages: 0, totalLinks: 0 };
      }

      // ── Authenticated BFS crawl ────────────────────────────────────────────
      // Pages in the same context share cookies, so they stay logged in.
      const visited = new Set<string>();
      visited.add(this.normalise(authPageUrl)); // skip login page itself
      const queue: Array<{ url: string; depth: number }> = [{ url: postLoginUrl, depth: 0 }];
      const pages: ExploredPage[] = [];

      while (queue.length > 0 && pages.length < maxPages) {
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
            // For SPAs that use history.pushState (href="#") discover routes via simulated clicks
            const spaRoutes = await this.discoverSpaRoutes(page, baseUrl, ignorePatterns);
            for (const route of spaRoutes) {
              const norm = this.normalise(route);
              if (!visited.has(norm) && !queue.some(q => q.url === norm)) {
                queue.push({ url: norm, depth: depth + 1 });
              }
            }
          }
        } catch (err) {
          console.warn(`  [Explorer] Auth crawl skipped ${current}: ${(err as Error).message}`);
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

  // Discovers SPA routes by intercepting history.pushState during simulated anchor clicks.
  // This handles apps (React Router, Vue Router, etc.) that use href="#" + JS navigation.
  private async discoverSpaRoutes(
    page: Page,
    baseUrl: string,
    ignorePatterns: RegExp[],
  ): Promise<string[]> {
    try {
      const urls: string[] = await page.evaluate((base) => {
        const found: string[] = [];
        const orig = { push: history.pushState.bind(history), replace: history.replaceState.bind(history) };

        // Intercept without actually navigating so we capture the target URL only
        (history as unknown as Record<string, unknown>).pushState =
          (_s: unknown, _t: string, url?: string) => {
            if (url) found.push(new URL(url, window.location.href).href);
          };
        (history as unknown as Record<string, unknown>).replaceState =
          (_s: unknown, _t: string, url?: string) => {
            if (url) found.push(new URL(url, window.location.href).href);
          };

        const SKIP = /logout|signout|log.out|sign.out|reset|delete|remove|clear/i;
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="#"], a[href=""]'));
        for (const a of anchors.slice(0, 20)) {
          const txt = (a.textContent ?? "").trim();
          const cls = a.className ?? "";
          if (SKIP.test(txt) || SKIP.test(cls)) continue;
          a.click();
        }

        (history as unknown as Record<string, unknown>).pushState   = orig.push;
        (history as unknown as Record<string, unknown>).replaceState = orig.replace;
        return found.filter(u => u.startsWith(base));
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
