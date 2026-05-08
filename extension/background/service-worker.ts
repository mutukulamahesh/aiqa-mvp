/**
 * AIQA service worker — orchestrates CDP-driven test runs and AI generation.
 *
 * Message protocol (panel → SW):
 *   { type: "run:smoke" }                        run hardcoded smoke test
 *   { type: "run:yaml", yaml: string }           run a YAML test string
 *   { type: "generate", prompt: string }         generate YAML from page + prompt
 *     → responds { ok: true, yaml } | { ok: false, error }
 *
 * Event stream (SW → panel) via port named "aiqa:run":
 *   StepEvent objects emitted by TestRunner
 */

import { CdpAdapter } from "./CdpAdapter";
import { TestRunner, StepEvent } from "./TestRunner";
import { TestDefinition } from "../../src/dsl/types";
import { parseTestDefinition } from "../../src/dsl/DslParser";
import { LLMClient } from "./LLMClient";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Keepalive heartbeat — MV3 service workers sleep after ~30s inactivity.
// The alarm fires every ~24s to keep the worker alive during active runs.
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { /* intentional no-op */ });

// ---------------------------------------------------------------------------
// Hardcoded smoke test (Step 4) — replaced by YAML parsing in Step 5
// ---------------------------------------------------------------------------

const SMOKE_TEST: TestDefinition = {
  name: "Smoke — example.com",
  steps: [
    { action: "navigate", target: "https://example.com" },
    { action: "assert",   kind: "text",  value: "Example Domain" },
    { action: "assert",   kind: "url",   value: "example.com" },
  ],
};

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

const cdp = new CdpAdapter();

// Notify the panel if DevTools steals the CDP session mid-run.
cdp.onDetach((reason) => {
  broadcast({ kind: "run:done", status: "failed", steps: [] } as StepEvent);
  console.warn("AIQA: CDP session detached —", reason);
});

async function startRun(def: TestDefinition, tabId: number): Promise<void> {
  try {
    await cdp.attach(tabId);
  } catch (err) {
    broadcast({
      kind: "run:done",
      status: "failed",
      steps: [
        {
          index: 0,
          label: "attach",
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      ],
    } as StepEvent);
    return;
  }

  const runner = new TestRunner(cdp, (event) => {
    broadcast(event);
    // Highlight the active element in the page during replay
    if (event.kind === "step:start") {
      const step = def.steps[event.index];
      const selector = "target" in step ? (step as { target: string }).target
        : "selector" in step ? (step as { selector: string }).selector
        : null;
      if (selector) sendHighlight(tabId, selector);
    } else if (event.kind === "step:pass" || event.kind === "step:fail") {
      sendHighlightClear(tabId);
    }
  });

  try {
    await runner.run(def);
  } finally {
    sendHighlightClear(tabId);
    await cdp.detach();
  }
}

// ---------------------------------------------------------------------------
// Message handler (panel → SW)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "run:smoke") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      startRun(SMOKE_TEST, tab.id);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "run:yaml" && typeof msg.yaml === "string") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      let def: TestDefinition;
      try {
        def = parseTestDefinition(msg.yaml);
      } catch (err) {
        broadcast({
          kind: "run:done",
          status: "failed",
          steps: [{
            index: 0,
            label: "parse",
            status: "failed",
            error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          }],
        } as StepEvent);
        return;
      }
      startRun(def, tab.id!);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "generate" && typeof msg.prompt === "string") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      handleGenerate(msg.prompt, tab.id!).then(
        (yaml)  => sendResponse({ ok: true, yaml }),
        (err)   => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    });
    return true; // keep message channel open for async sendResponse
  }

  // Recording mode
  if (msg?.type === "record:start") {
    recordedSteps = [];
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "record:start" });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "record:stop") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "record:stop" });
    });
    if (recordedSteps.length > 0) {
      broadcast({ kind: "recorded:yaml", yaml: stepsToYaml(recordedSteps) });
    }
    recordedSteps = [];
    sendResponse({ ok: true });
    return false;
  }

  // Recorded events from content script — accumulate for YAML export on stop
  if (msg?.type === "recorded:event") {
    const step = normalizeRecordedEvent(msg.event);
    if (step) recordedSteps.push(step);
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Recorder normalization (RecordedEvent → DSL selector string)
// ---------------------------------------------------------------------------

import type { RecordedEvent, SelectorDescriptor } from "../shared/types";

let recordedSteps: Array<Record<string, unknown>> = [];

function selectorToString(sel: SelectorDescriptor): string {
  if (sel.ariaLabel) return `aria=${sel.ariaLabel}`;
  if (sel.testId)    return `testid=${sel.testId}`;
  if (sel.text)      return `text=${sel.text}`;
  return sel.css ?? "";
}

function normalizeRecordedEvent(
  event: RecordedEvent
): Record<string, unknown> | null {
  const target = selectorToString(event.selector);
  switch (event.type) {
    case "click":
      return { action: "click", target };
    case "fill":
      return { action: "fill", target, value: event.value ?? "" };
    case "navigate":
      return { action: "navigate", target: event.url ?? "" };
    default:
      return null;
  }
}

function stepsToYaml(steps: Array<Record<string, unknown>>): string {
  const lines = ["test:", "  name: Recorded test", "  steps:"];
  for (const step of steps) {
    const { action, target, value } = step as {
      action: string; target?: string; value?: string;
    };
    if (action === "navigate") {
      lines.push(`    - navigate: ${JSON.stringify(target)}`);
    } else if (action === "click") {
      lines.push(`    - click: ${JSON.stringify(target)}`);
    } else if (action === "fill") {
      lines.push(`    - fill:`);
      lines.push(`        target: ${JSON.stringify(target)}`);
      lines.push(`        value: ${JSON.stringify(value ?? "")}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Highlight helpers — send to the highlighter content script
// ---------------------------------------------------------------------------

function sendHighlight(tabId: number, selector: string): void {
  chrome.tabs.sendMessage(tabId, { type: "highlight", selector }).catch(() => {});
}

function sendHighlightClear(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: "highlight:clear" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/**
 * Executed in the page context by chrome.scripting.executeScript.
 * Must be a standalone function — no closures, no imports.
 */
function extractPageContext(): { context: string; truncated: boolean; url: string } {
  const MAX = 50_000;
  const bodyText = (document.body as HTMLElement).innerText ?? "";
  const forms = Array.from(
    document.querySelectorAll<HTMLElement>("input, textarea, select, button")
  )
    .map((el) => {
      const label =
        el.getAttribute("aria-label") ||
        (el as HTMLInputElement).placeholder ||
        document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ||
        "";
      return `${el.tagName.toLowerCase()} ${el.getAttribute("type") ?? ""} ${label}`.trim();
    })
    .filter(Boolean)
    .join("\n");

  const raw = `URL: ${location.href}\n\nPage text:\n${bodyText}\n\nForm elements:\n${forms}`;
  return { context: raw.slice(0, MAX), truncated: raw.length > MAX, url: location.href };
}

const SYSTEM_PROMPT = `You are a test automation assistant. Generate AIQA YAML tests.

YAML format:
test:
  name: <name>
  steps:
    - navigate: <url>
    - click: <selector>       # aria=Label | testid=ID | text=Visible | CSS
    - fill:
        target: <selector>
        value: <text>
    - assert:
        text: <visible text>
    - assert:
        url: <url substring>
    - assert:
        visible: <selector>
    - wait_for_element: <selector>
    - wait_ms: <milliseconds>

Output ONLY the raw YAML. No explanation. No markdown code fences.`;

async function handleGenerate(prompt: string, tabId: number): Promise<string> {
  const stored = await chrome.storage.local.get("aiqa:config") as
    Record<string, { apiKey?: string }>;
  const apiKey = stored["aiqa:config"]?.apiKey;
  if (!apiKey) {
    throw new Error(
      "No API key configured. Open AIQA Options (extension icon → right-click → Options) to add your Anthropic key."
    );
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func:   extractPageContext,
  });
  const { context, truncated, url } = result.result as ReturnType<typeof extractPageContext>;

  const llm = new LLMClient(apiKey);
  const userMessage =
    `Page URL: ${url}${truncated ? " (content truncated at 50 KB)" : ""}\n\n` +
    `Page context:\n${context}\n\n` +
    `Generate a test that: ${prompt}`;

  return llm.complete(
    [{ role: "user", content: userMessage }],
    { system: SYSTEM_PROMPT, maxTokens: 1024 }
  );
}

// ---------------------------------------------------------------------------
// Port-based event broadcast to the panel
// ---------------------------------------------------------------------------

const ports = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "aiqa:run") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

function broadcast(event: StepEvent): void {
  for (const port of ports) {
    try {
      port.postMessage(event);
    } catch {
      ports.delete(port);
    }
  }
}
