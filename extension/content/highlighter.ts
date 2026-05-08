/**
 * highlighter.ts — outlines the active element during test replay.
 *
 * The service worker sends { type: "highlight", selector: string } before
 * each step and { type: "highlight:clear" } when the step completes.
 */

const OVERLAY_ID = "aiqa-highlight-overlay";

// Selector parsing matches CdpAdapter.buildFindExpr conventions.
function findElement(selector: string): Element | null {
  if (selector.startsWith("aria=")) {
    return document.querySelector(`[aria-label="${CSS.escape(selector.slice(5))}"]`);
  }
  if (selector.startsWith("testid=")) {
    return document.querySelector(`[data-testid="${CSS.escape(selector.slice(7))}"]`);
  }
  if (selector.startsWith("text=")) {
    const text = selector.slice(5);
    return (
      Array.from(document.querySelectorAll("*")).find(
        (e) => e.children.length === 0 && e.textContent?.trim() === text
      ) ?? null
    );
  }
  return document.querySelector(selector);
}

function getOrCreateOverlay(): HTMLElement {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position: fixed",
      "pointer-events: none",
      "box-sizing: border-box",
      "border: 2px solid #1a73e8",
      "background: rgba(26, 115, 232, 0.08)",
      "border-radius: 3px",
      "z-index: 2147483647",
      "transition: all 0.12s ease",
      "display: none",
    ].join(";");
    document.documentElement.appendChild(overlay);
  }
  return overlay as HTMLElement;
}

function highlight(selector: string): void {
  const el = findElement(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const overlay = getOrCreateOverlay();
  overlay.style.top    = `${rect.top}px`;
  overlay.style.left   = `${rect.left}px`;
  overlay.style.width  = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = "block";
}

function clearHighlight(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) (overlay as HTMLElement).style.display = "none";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "highlight" && typeof msg.selector === "string") {
    highlight(msg.selector);
  } else if (msg?.type === "highlight:clear") {
    clearHighlight();
  }
});
