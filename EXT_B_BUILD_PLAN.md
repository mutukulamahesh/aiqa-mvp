# EPIC-EXT-B — Pure Chrome Extension Build Plan

> Status: Pre-build (open questions resolved, architecture reviewed)
> Track: B (zero-setup, no API dependency)
> Parallel track: EPIC-EXT-A (API-backed extension) — separate, starts after this

---

## What we're building

A standalone Chrome extension that lets non-technical users test their web app directly from the browser — no CLI, no local server, no YAML knowledge required.

Two modes:
- **AI mode** — user describes the flow in plain English → Claude generates steps → extension replays them
- **Record mode** — user clicks through the app → extension captures the flow → replay immediately

---

## Architecture

```
Chrome Extension (MV3)
│
├── content/recorder.ts        ← captures user interactions on the page
├── content/highlighter.ts     ← outlines active element during replay
│
├── background/service-worker.ts  ← orchestrates runs, calls Anthropic API
├── background/CdpAdapter.ts      ← drives the tab via chrome.debugger CDP
├── background/TestRunner.ts      ← adapted engine (no Node deps)
├── background/LLMClient.ts       ← fetch()-based Anthropic API client
│
└── panel/                     ← chrome.sidePanel UI (React)
    ├── App.tsx
    └── components/
        ├── TestInput.tsx       ← "what do you want to test?" prompt
        ├── StepList.tsx        ← live step-by-step progress + per-step errors
        ├── ResultView.tsx      ← pass / fail summary
        └── HistoryView.tsx     ← saved tests + past runs (Phase 2)
```

No AIQA server. No Playwright. `chrome.debugger` CDP replaces Playwright for the active tab.

---

## Relationship to existing AIQA codebase

### Reused
| File | How |
|------|-----|
| `src/dsl/DslParser.ts` | Referenced via TypeScript path alias or workspace package — **not copied** (a copy will drift when the DSL evolves) |
| YAML test format (DSL) | Identical — tests are portable between CLI and extension |

### Re-implemented for the browser
| AIQA engine | Extension equivalent |
|-------------|---------------------|
| `PlaywrightAdapter` | `CdpAdapter.ts` — same step contract, CDP calls instead of Playwright |
| `src/runner/TestRunner.ts` | `background/TestRunner.ts` — same logic, no Node deps |
| LLM calls via Anthropic SDK | `LLMClient.ts` — plain `fetch()` to `api.anthropic.com` |
| `fs` / file storage | `chrome.storage.local` |

### Not in scope (MVP)
- `SelectorHealer` — omitted
- `MemoryStore` — omitted
- `db:` steps — no Knex in browser
- Headless / parallel runs — user watches the run; that's the UX

---

## Open questions — RESOLVED

| # | Decision |
|---|----------|
| Q1 | **Options page + `chrome.storage.local`** for the API key. Use `chrome.storage.session` for the in-memory working copy (cleared on browser close). Options page UI must document that the key survives browser restarts in plaintext. |
| Q2 | **ARIA label → `data-testid` → visible text → CSS selector** fallback chain. CSS selector is last resort and flagged with a warning in the recorded output. Pure CSS breaks on redeploy; pure text fails on dynamic content. |
| Q3 | **Chrome 114+** (sidePanel). Popup closes on navigation — fatal for a test runner. Chrome 114 is ~3 years old; negligible real-world impact. |
| Q4 | **`waitForNavigation()` primitive in `CdpAdapter` from day one.** CDP session is tab-scoped; navigation within the same tab reuses the session, but `Page.navigate` fires `Page.lifecycleEvent` events and the adapter must wait for `load`/`networkIdle` before issuing the next CDP command. Retrofitting this later is painful. |
| Q5 | **Ignore iframes in MVP.** `recorder.ts` must detect iframe clicks and emit a visible `"iframe interaction — not captured"` warning rather than silently dropping the event. |

---

## Step type coverage (CdpAdapter)

| DSL step | CDP mechanism | Notes |
|----------|---------------|-------|
| `navigate` | `Page.navigate` + `waitForNavigation()` | Always wait for load/networkIdle after |
| `click` | `Input.dispatchMouseEvent` | |
| `fill` | `Runtime.evaluate` (set `.value` + dispatch `input` event) | Key events break React/Vue controlled inputs. `Input.insertText` as fallback for frameworks that need real key events. |
| `assert: text` | `Runtime.evaluate` → DOM text | See CSP note below |
| `assert: url` | `Target.getTargetInfo` | |
| `assert: visible` | `Runtime.evaluate` → `getBoundingClientRect` | |
| `wait_for_element` | `Runtime.evaluate` poll loop — **must issue a CDP call each iteration** to keep the service worker alive | |
| `wait_ms` | `setTimeout` in service worker | |
| `api` | `fetch()` from service worker | |
| `judge` | `fetch()` to Anthropic API | |
| `store` | `Runtime.evaluate` → capture text/attr | |
| `if` / `for_each` | Pure logic — no CDP needed | |

---

## Architecture decisions (from review)

### CDP attach/detach lifecycle

`chrome.debugger.attach` fails if DevTools or another extension is already attached. Required from day one:

1. **Before attach**: check if already attached; surface a user-readable error if blocked
2. **`chrome.debugger.onDetach` listener**: handles DevTools opening mid-run and stealing the session — mark run as errored, unlock the UI
3. **Explicit detach** on: run complete, run cancel, extension unload (service worker `beforeunload`)

Failure to handle this will cause the extension to silently lock on first real use.

### Service worker keep-alive

`chrome.alarms` heartbeat (every 25s) keeps the worker alive during idle periods. But a `wait_for_element` poll loop that only uses `setTimeout` (no CDP traffic) can still let the worker sleep if the poll interval exceeds 30s. Rule: **every `wait_for_element` iteration must issue at least one CDP call** (the `Runtime.evaluate` check itself counts). The alarm is a safety net, not a substitute.

### `Runtime.evaluate` and Content Security Policy

Many production apps have strict CSP that blocks script injection. Mitigations:
- Use `Runtime.evaluate` with `allowUnsafeEvalBlockedByCSP: true` (Chrome 108+)
- If the target page blocks eval entirely, fall back to injecting a content script (which runs in the extension's isolated world, not the page's)

This is not a corner case. Add the fallback to `CdpAdapter` from the start.

### `fill` — correct primitive

**Do not use `Input.dispatchKeyEvent` character-by-character.** It breaks React/Vue controlled inputs because they intercept `keydown`, not the value setter.

Correct approach:
```
Runtime.evaluate → element.value = "..."; element.dispatchEvent(new Event('input', {bubbles: true}));
```
`Input.insertText` as secondary fallback for frameworks that require real key events.

### Content script ↔ service worker message protocol

`recorder.ts` emits raw DOM events. The service worker normalizes them to DSL steps. This keeps the recorder thin and independently testable.

Message schema:
```typescript
// recorder.ts → service worker
interface RecordedEvent {
  type:      "click" | "fill" | "navigate" | "submit";
  selector:  SelectorDescriptor;  // { ariaLabel?, testId?, text?, css? }
  value?:    string;               // for fill
  url?:      string;               // for navigate
  timestamp: number;
}
```

Channel: `chrome.runtime.sendMessage` for one-shot events (recorder → SW). `chrome.tabs.connect` port for the live replay feedback stream (SW → panel).

### Page HTML size guard (AI generation)

`document.documentElement.outerHTML` on a complex SPA can be 2–5MB. Instead, send:
- `document.body.innerText` (visible text)
- All form elements (label + input pairs)
- ARIA landmarks

Cap at ~50KB before sending to Claude. Add a warning in the panel if the page is truncated.

---

## Manifest permissions

Required in `manifest.json` before writing a line of implementation code:

```json
{
  "permissions": ["debugger", "activeTab", "sidePanel", "storage", "alarms"],
  "host_permissions": ["https://api.anthropic.com/*"],
  "side_panel": { "default_path": "panel/index.html" }
}
```

Note: `debugger` permission is what triggers the yellow debug banner in Chrome — cannot be removed.

---

## Extension CSP

MV3 extensions have a strict default CSP that blocks `eval`. React in dev mode uses `eval`; the panel build must be **production mode**. esbuild production builds are eval-free — stay in prod mode for all builds including local dev of the extension.

---

## `chrome.storage` key schema (design in Phase 1, UI in Phase 2)

Define the schema now to avoid painful data migrations later:

```typescript
// chrome.storage.local
{
  "aiqa:tests": SavedTest[],      // { name, yaml, savedAt }
  "aiqa:runs":  RunRecord[],      // { runId, testName, status, steps, timestamp }
  "aiqa:config": { apiKey: string }  // from options page
}

// chrome.storage.session (cleared on browser close)
{
  "aiqa:activeKey": string   // working copy of API key
}
```

---

## Known constraints

**Debug banner** — Chrome shows a persistent yellow bar when `chrome.debugger` is attached:
> *"AIQA is debugging this browser"*
Cannot be removed. Acceptable for a testing tool.

**Service worker sleep** — MV3 service workers sleep after ~30s inactivity.
Fix: `chrome.alarms` heartbeat every 25s + CDP calls inside all poll loops.

---

## MVP scope (Phase 1)

- [ ] Manifest V3 scaffold + permissions + esbuild config (Chrome 114+)
- [ ] `CdpAdapter.ts` — attach/detach lifecycle, CDP guard, `onDetach` handler
- [ ] `CdpAdapter.ts` — navigate + `waitForNavigation()`, click, fill (value setter), assert (text/url/visible), `wait_for_element`, `wait_ms`
- [ ] CSP fallback in `CdpAdapter` (`allowUnsafeEvalBlockedByCSP` + content script fallback)
- [ ] `background/TestRunner.ts` — step-by-step execution with event emission
- [ ] `DslParser` integration — reference `src/dsl/`, parse YAML in service worker
- [ ] Content script recorder — raw DOM events → message to service worker → DSL steps; iframe warning
- [ ] Content script highlighter — outlines active element during replay
- [ ] Side panel UI — TestInput, StepList (per-step pass/fail + inline error), ResultView
- [ ] `LLMClient.ts` — fetch-based Anthropic API client with page HTML size guard
- [ ] AI test generation — visible DOM extraction → Claude → steps in panel
- [ ] `chrome.storage` key schema (even if HistoryView comes in Phase 2)
- [ ] Options page — API key entry, plaintext storage warning

## Phase 2

- [ ] HistoryView — saved tests + run history using Phase 1 storage schema
- [ ] Export test as YAML (download button)
- [ ] Import YAML from file
- [ ] Jira defect push (reuse `JiraAdapter`)

## Phase 3

- [ ] `api:` and `judge:` step support
- [ ] `if:` / `for_each:` flow control
- [ ] "Fix it" button — on failure, ask Claude to suggest a selector fix
- [ ] Share test via URL (YAML encoded in params)

---

## Folder structure

```
extension/
  manifest.json
  background/
    service-worker.ts
    CdpAdapter.ts
    TestRunner.ts
    LLMClient.ts
  content/
    recorder.ts
    highlighter.ts
  panel/
    index.html
    App.tsx
    components/
      TestInput.tsx
      StepList.tsx       ← per-step pass/fail + inline error messages
      ResultView.tsx
      HistoryView.tsx    ← Phase 2
    options.html         ← API key entry
    Options.tsx
  shared/
    types.ts             ← RecordedEvent, SelectorDescriptor, StepResult, etc.
  build/                 ← esbuild output (gitignored)
  tsconfig.json          ← separate from root tsconfig (browser target, no Node types)
  package.json           ← separate deps (React, esbuild)
```

---

## Build pipeline

- **Bundler**: esbuild (production mode always — no eval)
- **Target**: `chrome` (not Node)
- **Entry points**: `service-worker.ts`, `recorder.ts`, `highlighter.ts`, `panel/index.tsx`, `panel/options.tsx`
- **Output**: `extension/build/` — load as unpacked extension in Chrome
- **`src/dsl/`**: referenced via TypeScript `paths` alias, not copied

---

## Build order

1. Manifest + esbuild config + permissions — load "hello world" side panel in Chrome
2. `CdpAdapter.ts` skeleton — attach/detach/guard/`onDetach` lifecycle only
3. `CdpAdapter.ts` step primitives — navigate + `waitForNavigation()`, click, fill, assert
4. `background/TestRunner.ts` — execute a hardcoded YAML test end-to-end
5. `DslParser` integration — parse YAML test in the service worker
6. Side panel UI scaffold — TestInput triggers hardcoded run → StepList shows events with per-step status
7. `LLMClient.ts` + AI generation — visible DOM extraction (size-guarded) → Claude → steps
8. Content script recorder — raw event capture → service worker normalization → DSL display
9. Content script highlighter — visual feedback during replay
10. Options page — API key entry with plaintext storage warning
11. Pass / fail polish + ResultView
