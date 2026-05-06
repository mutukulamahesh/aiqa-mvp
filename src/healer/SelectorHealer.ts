import { Page }                           from "playwright";
import { LLMProvider, createLLMProvider } from "../llm/LLMProvider";
import { HealerCache }                    from "./HealerCache";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CandidateElement {
  tag:          string;
  id?:          string;
  type?:        string;
  text?:        string;
  placeholder?: string;
  dataTest?:    string;
  ariaLabel?:   string;
  name?:        string;
  value?:       string;
}

export interface HealerEvent {
  ts:          string;
  type:        "cache_hit" | "healed" | "fallback_tried" | "rejected" | "evicted";
  descriptor:  string;
  selector?:   string;
  confidence?: number;
  source?:     "llm" | "semantic" | "manual";
  pageUrl:     string;
  pageTitle?:  string;
}

// ── SelectorHealer ────────────────────────────────────────────────────────────

export class SelectorHealer {
  private readonly llm: LLMProvider;
  readonly cache: HealerCache;
  private readonly events: HealerEvent[] = [];

  constructor(llm?: LLMProvider, cacheFile?: string) {
    this.llm   = llm ?? createLLMProvider();
    this.cache = new HealerCache(cacheFile);
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  getCached(pageUrl: string, descriptor: string): string | undefined {
    return this.cache.get(pageUrl, descriptor);
  }

  /**
   * Multi-selector fallback: tries each cached selector (ranked best-first) and
   * validates with page.locator().count(). Returns the first valid one, evicting
   * stale entries along the way.
   */
  async tryCache(pageUrl: string, descriptor: string, page: Page): Promise<string | null> {
    const selectors = this.cache.getAll(pageUrl, descriptor);

    for (const sel of selectors) {
      const count = await page.locator(sel).count();
      if (count === 1) {
        this.cache.markSuccess(pageUrl, descriptor, sel);
        this.emit({ type: "cache_hit", descriptor, selector: sel, pageUrl });
        return sel;
      }
      // Stale — mark failure (may evict) and try next
      this.cache.markFailure(pageUrl, descriptor, sel);
      this.emit({ type: "evicted", descriptor, selector: sel, pageUrl });
    }
    return null;
  }

  // ── LLM healing ───────────────────────────────────────────────────────────

  async heal(descriptor: string, page: Page, pageUrl: string): Promise<string | null> {
    if (this.llm.name === "mock") return null;

    const [candidates, pageTitle] = await Promise.all([
      this.extractCandidates(page),
      page.title().catch(() => ""),
    ]);
    if (!candidates.length) return null;

    const selector = await this.queryLLM(descriptor, pageUrl, candidates, pageTitle);
    if (!selector) {
      this.emit({ type: "rejected", descriptor, pageUrl, pageTitle });
      return null;
    }

    // Validate the selector uniquely matches exactly one element before caching
    const count = await page.locator(selector).count();
    if (count !== 1) {
      this.emit({ type: "rejected", descriptor, selector, pageUrl, pageTitle });
      return null;
    }

    // Semantic guard: ensure the matched element's visible text relates to the descriptor.
    // Prevents silent wrong-heals (e.g. "Logout" button healed for "login_button" descriptor).
    if (!await this.validateSemanticMatch(page, selector, descriptor)) {
      this.emit({ type: "rejected", descriptor, selector, pageUrl, pageTitle });
      return null;
    }

    this.cache.set(pageUrl, descriptor, selector, { confidence: 0.85, source: "llm" });
    this.emit({ type: "healed", descriptor, selector, confidence: 0.85, source: "llm", pageUrl, pageTitle });
    return selector;
  }

  markSuccess(pageUrl: string, descriptor: string, selector?: string): void {
    this.cache.markSuccess(pageUrl, descriptor, selector);
  }

  markFailure(pageUrl: string, descriptor: string, selector?: string): void {
    this.cache.markFailure(pageUrl, descriptor, selector);
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  getReport(): string {
    if (process.env.HEALER_LOG_LEVEL === "off") return "";
    if (!this.events.length) return "🔧 Healer: no activity this run";

    const hits     = this.events.filter(e => e.type === "cache_hit");
    const healed   = this.events.filter(e => e.type === "healed");
    const evicted  = this.events.filter(e => e.type === "evicted");
    const rejected = this.events.filter(e => e.type === "rejected");
    const llmCalls = healed.length + rejected.length;

    const warmDescriptors = new Set(hits.map(e => e.descriptor));
    const coldDescriptors = new Set(healed.map(e => e.descriptor));
    const runType =
      coldDescriptors.size === 0 ? "Warm  (all from cache)"  :
      warmDescriptors.size === 0 ? "Cold  (all LLM)"         :
      `Mixed (${[...warmDescriptors].filter(d => !coldDescriptors.has(d)).length} warm, ${[...coldDescriptors].filter(d => !warmDescriptors.has(d)).length} cold)`;

    const lines: string[] = [
      "",
      "┌─ 🔧 Healer Report ──────────────────────────────────",
      `│  Run type:         ${runType}`,
      `│  Cache hits:       ${hits.length}`,
      `│  LLM calls:        ${llmCalls}`,
      `│  Healed:           ${healed.length}`,
      `│  Evicted (stale):  ${evicted.length}`,
      `│  Rejected (bad):   ${rejected.length}`,
    ];

    if (healed.length) {
      lines.push("│");
      lines.push("│  Healed locators:");
      const seen = new Map<string, HealerEvent>();
      for (const e of healed) if (!seen.has(e.descriptor)) seen.set(e.descriptor, e);
      for (const e of seen.values()) {
        const conf = e.confidence != null ? `  conf: ${e.confidence.toFixed(2)}` : "";
        lines.push(`│    • ${e.descriptor.padEnd(28)} → ${e.selector}${conf}`);
      }
    }

    lines.push("└────────────────────────────────────────────────────");
    return lines.join("\n");
  }

  resetEvents(): void {
    this.events.length = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private static readonly MAX_EVENTS = 500;

  private static readonly SEMANTIC_STOP_WORDS = new Set([
    "btn", "button", "field", "input", "link", "icon", "label", "the", "for", "and",
  ]);

  /**
   * Lightweight semantic guard: rejects a healed selector when the element's
   * visible text clearly contradicts the descriptor (e.g. "Logout" for "login_button").
   * Returns true (accept) when the element has no readable content — icon-only
   * and SVG elements should not be blocked.
   */
  private async validateSemanticMatch(page: Page, selector: string, descriptor: string): Promise<boolean> {
    const words = descriptor.toLowerCase()
      .split(/[_\-\s]+/)
      .filter(w => w.length > 2 && !SelectorHealer.SEMANTIC_STOP_WORDS.has(w));

    if (!words.length) return true;

    try {
      const locator = page.locator(selector);
      const [text, ariaLabel, placeholder] = await Promise.all([
        locator.textContent().catch(() => null),
        locator.getAttribute("aria-label").catch(() => null),
        locator.getAttribute("placeholder").catch(() => null),
      ]);

      const content = [text, ariaLabel, placeholder]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .trim();

      if (!content || content.length < 2) return true;

      const contentWords = content.split(/\W+/).filter(Boolean);
      return words.some(dw => contentWords.some(cw => cw.includes(dw) || dw.includes(cw)));
    } catch {
      return true;
    }
  }

  private emit(partial: Omit<HealerEvent, "ts">): void {
    if (this.events.length >= SelectorHealer.MAX_EVENTS) this.events.shift();
    this.events.push({ ts: new Date().toISOString(), ...partial });
  }

  private async extractCandidates(page: Page): Promise<CandidateElement[]> {
    return page.evaluate(() => {
      const sel = [
        "button",
        "input:not([type='hidden'])",
        "a[href]",
        "select",
        "textarea",
        "[data-test]",
        "[role='button']",
      ].join(",");

      return Array.from(document.querySelectorAll(sel))
        .slice(0, 60)
        .map(el => ({
          tag:         el.tagName.toLowerCase(),
          id:          el.id                                          || undefined,
          type:        el.getAttribute("type")                        || undefined,
          text:        el.textContent?.trim().slice(0, 60)            || undefined,
          placeholder: el.getAttribute("placeholder")                 || undefined,
          dataTest:    el.getAttribute("data-test")                   || undefined,
          ariaLabel:   el.getAttribute("aria-label")                  || undefined,
          name:        el.getAttribute("name")                        || undefined,
          value:       (el as HTMLInputElement).value?.slice(0, 40)   || undefined,
        }));
    });
  }

  private async queryLLM(
    descriptor: string,
    url:        string,
    candidates: CandidateElement[],
    pageTitle:  string,
  ): Promise<string | null> {
    const formatted = candidates.map((c, i) => {
      const parts = [
        c.dataTest    && `data-test="${c.dataTest}"`,
        c.id          && `id="${c.id}"`,
        c.name        && `name="${c.name}"`,
        c.ariaLabel   && `aria-label="${c.ariaLabel}"`,
        c.type        && `type="${c.type}"`,
        c.placeholder && `placeholder="${c.placeholder}"`,
        c.value       && `value="${c.value}"`,
        c.text        && `text="${c.text}"`,
      ].filter(Boolean).join(" ");
      return `${i + 1}. <${c.tag} ${parts}>`;
    }).join("\n");

    try {
      const res = await this.llm.complete({
        system:
          "You are a Playwright test automation expert. " +
          "Given a logical element descriptor and a list of interactive DOM elements, " +
          "return ONLY a valid CSS selector that uniquely identifies exactly one element. " +
          "Selector priority: [data-test] attribute > id > name > aria-label > placeholder > visible text. " +
          "Avoid generic class selectors like .btn or .form-control. " +
          "Do NOT explain. Do NOT wrap the selector in quotes. " +
          'If no element matches, return exactly the word: null',
        userMessage:
          `Failed to locate: "${descriptor}"\n` +
          `Page: ${url}${pageTitle ? `  (title: "${pageTitle}")` : ""}\n\n` +
          `Interactive elements on page:\n${formatted}\n\n` +
          `Return only the CSS selector (e.g. [data-test="login-button"] or #submit), or null.`,
        maxTokens: 60,
      });

      const raw = res.content.trim().replace(/^['"`]|['"`]$/g, "").trim();
      if (!raw || raw.toLowerCase() === "null") return null;
      // Reject prose: strip quoted attribute values then check for remaining spaces
      const withoutQuotedParts = raw.replace(/"[^"]*"|'[^']*'/g, "");
      if (/\s/.test(withoutQuotedParts)) return null;
      // Must start with a recognised CSS selector character
      if (!/^[#.\[a-zA-Z*]/.test(raw)) return null;
      return raw;
    } catch {
      return null;
    }
  }
}
