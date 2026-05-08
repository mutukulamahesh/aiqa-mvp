/**
 * AdapterActions — the contract that all browser adapters must fulfill.
 * The handlers call these methods; the Playwright adapter implements them.
 */
export interface AdapterActions {
  navigate(url: string): Promise<void>;
  click(locator: string): Promise<void>;
  fill(locator: string, value: string): Promise<void>;
  assertTextVisible(text: string): Promise<void>;
  assertUrlContains(substring: string): Promise<void>;
  assertElementVisible(locator: string): Promise<void>;
  screenshot(filePath: string): Promise<void>;
  /** Returns the browser's actual current URL (after redirects). */
  currentUrl(): Promise<string>;
  /** Wait until a CSS selector is visible on the page. */
  waitForSelector(selector: string, timeout?: number): Promise<void>;
  /** Wait until the current URL contains the given substring. */
  waitForUrl(substring: string): Promise<void>;
  /** Return the inner text of the first matching element. */
  getElementText(selector: string): Promise<string>;
  /** Return an attribute value from the first matching element; empty string if absent. */
  getElementAttribute(selector: string, attribute: string): Promise<string>;
}
