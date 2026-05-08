# AIQA Chrome Extension — Design Brief

> Status: Pre-design — pending API layer completion (2026-05-08)
> Goal: Let non-technical users test AI-built web apps instantly from the browser — no CLI, no YAML, no setup.
>
> **Build order:** API layer first → Chrome extension after. Two parallel tracks exist (see below).

---

## Problem

Everyone is building apps with AI. Most of those builders are non-technical — they can't write test scripts or use a CLI. But their apps still break. AIQA as a CLI solves this for engineers; the Chrome extension solves it for everyone else.

---

## Core User Flow

1. User opens their AI-built web app in Chrome
2. Clicks the AIQA extension icon (side panel opens)
3. Either:
   - **AI mode**: Types "test that I can sign up and reach the dashboard" → Claude reads the page → generates steps → replays them
   - **Record mode**: User clicks through the flow → extension captures it → can replay immediately
4. Visual step-by-step replay with highlighting
5. Pass / fail result shown inline — no terminal needed

---

## Architecture: Two Parallel Tracks

The original design discussion (2026-05-06) confirmed that the extension needs an API backend to run Playwright. Both tracks are now planned and will be built after the API layer.

| Track | Architecture | User | Status |
|---|---|---|---|
| **Track A — API-backed** | Extension (UI/recorder) → AIQA API server → Playwright engine | Power users, developers, teams with local server | Build after API layer |
| **Track B — Pure extension** | Extension only, `chrome.debugger` CDP replaces Playwright | Non-technical users, zero setup | Build in parallel, independent |

### Track A — API-backed (primary)
```
Chrome Extension (side panel UI + flow recorder)
        ↓  POST /api/run { content: "<yaml>" }
AIQA API server (localhost:7432)
        ↓  onEvent callback
Playwright engine (full power: healer, memory, judge)
        ↓  WS /api/runs/:runId/stream
Extension shows live step results
```
- Records user flow → sends YAML to local AIQA server
- Full Playwright power: healer, memory, parallel, headless
- Shares the same API used by the Portal
- Requires AIQA server running locally

### Track B — Pure extension (zero-setup)
```
Chrome Extension only
  chrome.debugger CDP → drives the active tab directly
  Service worker → calls Anthropic API for AI test generation
  Content script → records interactions, injects highlights
```
- No local server, no install beyond the extension
- `chrome.debugger` replaces Playwright for the active tab
- Best for the "random builder" use case

---

## Technical Foundation

### Chrome APIs Used

| API | Purpose |
|---|---|
| `chrome.debugger` | Attaches CDP to the active tab — drives clicks, fills, navigation |
| `chrome.sidePanel` | Persistent UI alongside the page (doesn't block the page) |
| `chrome.storage.local` | Persist saved tests and run history |
| `chrome.alarms` | Keepalive heartbeat for Manifest V3 service worker |
| Content script | Record user interactions, inject step highlights |

### How Each Step Type Maps

| AIQA DSL step | Chrome Extension mechanism |
|---|---|
| `navigate` | CDP `Page.navigate` |
| `click` | CDP `Input.dispatchMouseEvent` |
| `fill` | CDP `Input.dispatchKeyEvent` |
| `assert: text` | CDP `Runtime.evaluate` → read DOM text |
| `assert: url` | CDP `Target.getTargetInfo` |
| `assert: visible` | CDP `Runtime.evaluate` → `getBoundingClientRect` |
| `wait_for_element` | CDP `Runtime.evaluate` in poll loop |
| `wait_ms` | `setTimeout` in service worker |
| `api` | `fetch()` from service worker |
| `judge` | `fetch()` to Anthropic API from service worker |
| `store` | `Runtime.evaluate` → capture element text/attr |
| `if` / `for_each` | Pure logic — no CDP needed |

### What Does NOT port (and why it's OK)

| Feature | Why it won't port | Target user impact |
|---|---|---|
| `db:` step | No Node.js / Knex in browser | Non-technical users don't need DB access |
| Headless / parallel runs | Requires controlling browser from outside | Users watch the test run — that's a feature |
| File system test storage | No `fs` module | Use `chrome.storage` + export-to-YAML button |

---

## Known Constraints

### Debug Banner
When `chrome.debugger` is attached, Chrome shows a persistent yellow bar:
> *"AIQA is debugging this browser"*

Cannot be removed — Chrome enforces this for user trust. Acceptable for a testing tool.

### Service Worker Lifecycle (Manifest V3)
Service workers sleep after ~30s inactivity. Fix: `chrome.alarms` sends a heartbeat ping every 25 seconds during an active test run.

---

## Proposed Folder Structure

```
extension/
  manifest.json          # MV3 manifest
  background/
    service-worker.ts    # Orchestrates test runs, calls Anthropic API
    CdpAdapter.ts        # Replaces PlaywrightAdapter — drives browser via CDP
    TestRunner.ts        # Adapted from src/execution/TestRunner.ts
    LLMClient.ts         # Fetch-based Anthropic API client
  content/
    recorder.ts          # Captures click/fill/navigate events
    highlighter.ts       # Visual step highlighting during replay
  panel/
    index.html           # Side panel UI shell
    App.tsx              # React UI — main panel
    components/
      TestInput.tsx      # "What do you want to test?" input
      StepList.tsx       # Live step-by-step progress view
      ResultView.tsx     # Pass/fail summary
      HistoryView.tsx    # Saved tests and past runs
  shared/
    types.ts             # Shared types (StepAction, TestResult, etc.)
    dsl/                 # DslParser.ts — reused as-is (no Node deps)
```

---

## MVP Scope (Phase 1)

- [ ] Side panel UI scaffolding
- [ ] `CdpAdapter` — navigate, click, fill, assert (text + url + visible), wait_for_element, wait_ms
- [ ] Content script recorder — captures user flow as YAML steps
- [ ] AI test generation — send page HTML → Claude → steps rendered in panel
- [ ] Replay with visual highlighting (outline active element per step)
- [ ] Pass / fail result display

## Phase 2

- [ ] Save tests to `chrome.storage`, named test library
- [ ] Export test as YAML (download)
- [ ] Import YAML from file
- [ ] Run history with timestamps
- [ ] Jira defect push (reuse `JiraAdapter` compiled to browser)

## Phase 3

- [ ] `api:` and `judge:` step support
- [ ] `if:` / `for_each:` flow control
- [ ] Share test via URL (encode YAML in URL params)
- [ ] "Fix it" button — on failure, ask Claude to suggest a selector fix

---

## Open Design Questions (to resolve before building)

1. **API key handling** — where does the user put their Anthropic key? Extension options page? Or proxy through a hosted endpoint?
2. **Side panel vs popup** — side panel stays open while navigating; popup closes. Side panel is better for this use case but requires Chrome 114+.
3. **Recording fidelity** — do we capture raw CSS selectors, ARIA labels, or visible text? Visible text + ARIA is more resilient.
4. **Multi-page tests** — user navigates to a new URL mid-test. CDP debugger follows the tab, so this should work. Needs verification.
5. **Iframe handling** — AI-built apps often embed iframes. CDP can attach to sub-frames. Scope for Phase 2.

---

## Relationship to Existing AIQA CLI

The extension is a **separate product surface**, not a replacement. Long-term:

- CLI: engineers, CI/CD, headless, parallel
- Extension: non-technical users, instant testing, browser-native
- Shared: DSL format, YAML test files (export/import between both)
- Future: extension generates YAML → user drops into CI pipeline when they're ready to automate
