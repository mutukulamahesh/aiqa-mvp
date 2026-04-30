import { chromium, Browser, Page } from "playwright";

export interface InputField {
  type:         string;
  name?:        string;
  placeholder?: string;
}

export interface PageLink {
  text: string;
  href: string;
}

export interface ExploredPage {
  url:           string;
  title:         string;
  headings:      string[];
  buttons:       string[];
  inputs:        InputField[];
  links:         PageLink[];
  internalLinks: string[];
}

export interface ExplorationResult {
  baseUrl:     string;
  exploredAt:  string;
  pages:       ExploredPage[];
  totalPages:  number;
  totalLinks:  number;
}

export interface ExplorerOptions {
  headless?:       boolean;
  maxPages?:       number;
  timeout?:        number;
  ignorePatterns?: RegExp[];
}

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
      timeout        = 10_000,
      ignorePatterns = DEFAULT_IGNORE,
    } = opts;

    const browser = await chromium.launch({ headless });
    try {
      const baseUrl = new URL(url).origin;
      const visited = new Set<string>();
      const queue   = [this.normalise(url)];
      const pages:   ExploredPage[] = [];

      while (queue.length > 0 && pages.length < maxPages) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const page = await browser.newPage();
        try {
          await page.goto(current, { waitUntil: "domcontentloaded", timeout });
          const explored = await this.extractPage(page, baseUrl, ignorePatterns);
          pages.push({ url: current, ...explored });

          for (const link of explored.internalLinks) {
            if (!visited.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        } catch {
          // Skip pages that fail to load (auth walls, errors, etc.)
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
