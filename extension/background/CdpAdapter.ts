/**
 * CdpAdapter — drives the active tab via Chrome DevTools Protocol.
 *
 * Selector string formats accepted by all step methods:
 *   aria=LABEL    → [aria-label="LABEL"]
 *   testid=ID     → [data-testid="ID"]
 *   text=TEXT     → first leaf element whose trimmed textContent equals TEXT
 *   anything else → standard CSS selector
 */

type Debuggee = chrome.debugger.Debuggee;

interface EvalResult<T> {
  result: { value: T };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CdpAdapter {
  private target: Debuggee | null = null;
  private attached = false;
  private detachCallbacks: Array<(reason: string) => void> = [];

  constructor() {
    // Single shared listener — handles DevTools or another extension stealing the session.
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (this.target && source.tabId === this.target.tabId) {
        this.attached = false;
        this.target = null;
        for (const cb of this.detachCallbacks) cb(reason);
      }
    });

    // Auto-dismiss JS dialogs (alert, confirm, beforeunload) so they don't block runs.
    chrome.debugger.onEvent.addListener((source, method) => {
      if (!this.attached || source.tabId !== this.target?.tabId) return;
      if (method === "Page.javascriptDialogOpening") {
        this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    });
  }

  /** Register a callback invoked if the CDP session is stolen mid-run. */
  onDetach(cb: (reason: string) => void): void {
    this.detachCallbacks.push(cb);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async attach(tabId: number): Promise<void> {
    if (this.attached && this.target?.tabId === tabId) return;
    if (this.attached) {
      throw new Error("Already attached to another tab. Call detach() first.");
    }
    const target: Debuggee = { tabId };
    try {
      await chrome.debugger.attach(target, "1.3");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Another debugger is already attached")) {
        throw new Error(
          "DevTools or another extension is already debugging this tab. " +
            "Close DevTools and try again."
        );
      }
      throw new Error(`CDP attach failed: ${msg}`);
    }
    this.target = target;
    this.attached = true;
    // Page.enable is required for Page.loadEventFired to be dispatched.
    await this.send("Page.enable");
    await this.send("Page.setLifecycleEventsEnabled", { enabled: true });
  }

  async detach(): Promise<void> {
    if (!this.attached || !this.target) return;
    const target = this.target;
    this.attached = false;
    this.target = null;
    try {
      await chrome.debugger.detach(target);
    } catch {
      // Tab may already be closed — ignore.
    }
  }

  isAttached(): boolean {
    return this.attached;
  }

  // ---------------------------------------------------------------------------
  // Step primitives
  // ---------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    // Register the lifecycle listener BEFORE sending Page.navigate to avoid a
    // race where "load" fires before we start listening.
    const settled = this.waitForNavigation(15_000);
    await this.send("Page.navigate", { url });
    await settled;
  }

  async click(selector: string): Promise<void> {
    const rect = await this.getRect(selector);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  /**
   * Sets the element value via the native value setter + dispatches input/change.
   * Do NOT use Input.dispatchKeyEvent character-by-character — it breaks
   * React/Vue controlled inputs which intercept `keydown`, not the setter.
   */
  async fill(selector: string, value: string): Promise<void> {
    const find = this.buildFindExpr(selector);
    const script = `
      (function() {
        const el = ${find};
        if (!el) return "not_found";
        el.focus();
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return "ok";
      })()
    `;
    const res = await this.eval<string>(script);
    if (res === "not_found") throw new Error(`fill: element not found — ${selector}`);
  }

  /** Assert the page body contains the given text string. */
  async assertText(text: string): Promise<void> {
    const found = await this.eval<boolean>(
      `(document.body.textContent ?? "").includes(${JSON.stringify(text)})`
    );
    if (!found) throw new Error(`assertText: "${text}" not found on page`);
  }

  /** Assert the current URL contains the given substring. */
  async assertUrl(substring: string): Promise<void> {
    const actual = await this.eval<string>("window.location.href");
    if (!actual.includes(substring)) {
      throw new Error(`assertUrl: expected URL to contain "${substring}" but got "${actual}"`);
    }
  }

  /** Assert the element matching selector is visible (non-zero bounding box). */
  async assertVisible(selector: string): Promise<void> {
    const find = this.buildFindExpr(selector);
    const visible = await this.eval<boolean>(`
      (function() {
        const el = ${find};
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()
    `);
    if (!visible) throw new Error(`assertVisible: element not visible — ${selector}`);
  }

  /**
   * Poll until the element exists. Every iteration issues a CDP call so the
   * service worker stays alive (no silent 30s sleep during long waits).
   */
  async waitForElement(selector: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const find = this.buildFindExpr(selector);
    while (Date.now() < deadline) {
      const found = await this.eval<boolean>(`!!(${find})`);
      if (found) return;
      await this.sleep(250);
    }
    throw new Error(`waitForElement: timed out after ${timeoutMs}ms — ${selector}`);
  }

  async waitMs(ms: number): Promise<void> {
    await this.sleep(ms);
  }

  /** Read element text or a specific attribute and return the value. */
  async storeValue(selector: string, attribute?: string): Promise<string> {
    const find = this.buildFindExpr(selector);
    const script = attribute
      ? `(function(){ const el=${find}; return el ? el.getAttribute(${JSON.stringify(attribute)}) : null; })()`
      : `(function(){ const el=${find}; return el ? (el.textContent ?? "").trim() : null; })()`;
    const value = await this.eval<string | null>(script);
    if (value === null) throw new Error(`store: element not found — ${selector}`);
    return value;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a JS expression (no trailing semicolon) that resolves to the target
   * Element or null, using the selector prefix conventions.
   */
  private buildFindExpr(selector: string): string {
    if (selector.startsWith("aria=")) {
      const v = JSON.stringify(selector.slice(5));
      return `document.querySelector('[aria-label="' + CSS.escape(${v}) + '"]')`;
    }
    if (selector.startsWith("testid=")) {
      const v = JSON.stringify(selector.slice(7));
      return `document.querySelector('[data-testid="' + CSS.escape(${v}) + '"]')`;
    }
    if (selector.startsWith("text=")) {
      const v = JSON.stringify(selector.slice(5).toLowerCase());
      return (
        `Array.from(document.querySelectorAll("*")).find(` +
        `e => e.children.length === 0 && (e.textContent ?? "").trim().toLowerCase() === ${v}) ?? null`
      );
    }
    return `document.querySelector(${JSON.stringify(selector)})`;
  }

  private async getRect(selector: string): Promise<Rect> {
    const find = this.buildFindExpr(selector);
    const rect = await this.eval<Rect | null>(`
      (function() {
        const el = ${find};
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);
    if (!rect) throw new Error(`Element not found: ${selector}`);
    if (rect.width === 0 && rect.height === 0) {
      throw new Error(`Element has no visible size: ${selector}`);
    }
    return rect;
  }

  private waitForNavigation(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(listener);
        resolve();
      };

      const timer = setTimeout(() => {
        chrome.debugger.onEvent.removeListener(listener);
        reject(new Error(`Navigation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (
        source: Debuggee,
        method: string,
        params: unknown
      ) => {
        if (source.tabId !== this.target?.tabId) return;
        // Page.loadEventFired is the most reliable signal (requires Page.enable).
        if (method === "Page.loadEventFired") { done(); return; }
        // Lifecycle events as secondary triggers for SPAs / cached navigations.
        if (method === "Page.lifecycleEvent") {
          const p = params as { name: string };
          if (p.name === "load" || p.name === "networkIdle" || p.name === "DOMContentLoaded") {
            done();
          }
        }
      };

      chrome.debugger.onEvent.addListener(listener);
    });
  }

  private async eval<T>(expression: string): Promise<T> {
    const res = await this.send<EvalResult<T>>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      // Allows eval in pages with strict CSP (Chrome 108+, our minimum is 116).
      allowUnsafeEvalBlockedByCSP: true,
    });
    if (res.exceptionDetails) {
      const detail =
        res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text;
      throw new Error(`CDP eval error: ${detail}`);
    }
    return res.result.value;
  }

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.attached || !this.target) {
      throw new Error("CdpAdapter: not attached. Call attach() first.");
    }
    try {
      return (await chrome.debugger.sendCommand(
        this.target,
        method,
        params
      )) as T;
    } catch (err) {
      throw new Error(
        `${method} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
