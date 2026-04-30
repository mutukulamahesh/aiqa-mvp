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
  screenshot(filePath: string): Promise<void>;
}
