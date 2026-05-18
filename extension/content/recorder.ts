/**
 * recorder.ts — captures user interactions and forwards them to the service
 * worker as RecordedEvent messages. The service worker normalises them into
 * DSL steps and broadcasts to the panel.
 *
 * Activated on demand: the service worker sends { type: "record:start" } /
 * { type: "record:stop" } to this content script via chrome.tabs.sendMessage.
 */

import { RecordedEvent, SelectorDescriptor } from "../shared/types";

let recording = false;

// ---------------------------------------------------------------------------
// Message listener (SW → content script)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "record:start" && !recording) {
    recording = true;
    attachListeners();
  } else if (msg?.type === "record:stop" && recording) {
    recording = false;
    detachListeners();
  }
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

function handleClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // Anchor clicks — record the destination URL, not the click selector.
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (anchor && anchor.href) {
    const event: RecordedEvent = {
      type:      "navigate",
      selector:  { css: "" },
      url:       anchor.href,
      timestamp: Date.now(),
    };
    chrome.runtime.sendMessage({ type: "recorded:event", event });
    return;
  }

  if (!isInteractive(target)) return;

  // Skip clicks inside shadow DOM or iframes that we can't inspect
  if (target.tagName === "IFRAME") {
    chrome.runtime.sendMessage({
      type: "recorder:warning",
      message: "iframe interaction — not captured",
    });
    return;
  }

  const selector = buildSelector(target);
  const event: RecordedEvent = {
    type:      "click",
    selector,
    timestamp: Date.now(),
  };
  chrome.runtime.sendMessage({ type: "recorded:event", event });
}

// Fires on blur after the user has filled a form field.
let lastFillTarget: EventTarget | null = null;
let lastFillValue  = "";

function handleInput(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target || !("value" in target)) return;
  lastFillTarget = target;
  lastFillValue  = target.value;
}

function handleBlur(e: FocusEvent): void {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target || target !== lastFillTarget || !("value" in target)) return;
  if (!lastFillValue) { lastFillTarget = null; return; }

  const selector = buildSelector(target as HTMLElement);
  const event: RecordedEvent = {
    type:      "fill",
    selector,
    value:     lastFillValue,
    timestamp: Date.now(),
  };
  chrome.runtime.sendMessage({ type: "recorded:event", event });
  lastFillTarget = null;
  lastFillValue  = "";
}

function attachListeners(): void {
  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("blur",  handleBlur,  true);
}

function detachListeners(): void {
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("blur",  handleBlur,  true);
}

// ---------------------------------------------------------------------------
// Selector building — fallback chain per the plan:
// ARIA label → data-testid → visible text → CSS selector
// ---------------------------------------------------------------------------

function buildSelector(el: HTMLElement): SelectorDescriptor {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return { ariaLabel };

  const testId = el.getAttribute("data-testid");
  if (testId) return { testId };

  // Visible text — only for leaf elements and interactive elements
  const text = el.textContent?.trim();
  if (text && text.length <= 80 && el.children.length === 0) {
    return { text };
  }

  // CSS fallback — basic selector, least preferred
  const css = buildCssSelector(el);
  if (css !== el.tagName.toLowerCase()) {
    // Flag CSS selectors so the panel can warn the user
    return { css };
  }
  return { css };
}

const MAX_SELECTOR_DEPTH = 10;

function buildCssSelector(el: HTMLElement, depth = 0): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${name}"]`;

  const type = el.getAttribute("type");
  if (type) return `${tag}[type="${type}"]`;

  // nth-child as last resort — guarded against shadow DOM elements where
  // indexOf returns -1 (producing invalid :nth-child(0)).
  const parent = el.parentElement;
  if (parent && depth < MAX_SELECTOR_DEPTH) {
    const index = Array.from(parent.children).indexOf(el) + 1;
    if (index < 1) return tag; // el not in parent.children (e.g. shadow DOM)
    return `${buildCssSelector(parent, depth + 1)} > ${tag}:nth-child(${index})`;
  }
  return tag;
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    ["a", "button", "input", "select", "textarea", "label"].includes(tag) ||
    el.getAttribute("role") === "button" ||
    el.hasAttribute("onclick") ||
    el.tabIndex >= 0
  );
}
