# AIQA API Layer — Design Document (Post-Review)

> Status: Approved for build (2026-05-08)  
> Review: 14 issues identified and resolved — see "Review Resolutions" section.  
> Principle: New door into the existing engine. Core engine untouched except one backward-compatible callback.

---

## What This Is

A new `src/server.ts` entry point that exposes the AIQA engine as a REST + WebSocket API.  
The same functions the CLI calls — nothing more.

```
CLI        →  TestRunner / OrchestratorAgent / AppExplorer
API server →  same TestRunner / OrchestratorAgent / AppExplorer  (engine unchanged)
```

---

## The One Engine Touch

**File:** `src/runner/TestRunner.ts`  
**Change:** Add optional `onEvent` callback to `TestRunner.run()`

```typescript
// Before
async run(test: TestDefinition): Promise<TestResult>

// After
async run(test: TestDefinition, onEvent?: (e: RunEvent) => void): Promise<TestResult>
```

- CLI passes nothing → behaviour **identical** to today
- API passes a callback → real-time step events emitted to the RunJob buffer
- `WorkerContext` receives the callback on the `WorkerStore` and calls it from `wwrite`/`wlog`

This is the only change to any existing engine file. Everything else (OrchestratorAgent, handlers, DSL, healer, memory) is untouched.

**RunEvent shape:**
```typescript
type RunEvent =
  | { event: "step";        index: number; action: string; target?: string }
  | { event: "step_result"; index: number; passed: boolean; durationMs: number; error?: string; screenshotUrl?: string }
  | { event: "test_done";   testName: string; passed: boolean; durationMs: number }
  | { event: "log";         message: string }
  | { event: "done";        status: "passed" | "failed" | "error"; summary: RunSummary }
  | { event: "error";       message: string }
```

---

## Technology Stack

| Concern | Choice |
|---|---|
| HTTP server | `express` ^4.18 |
| WebSocket | `ws` ^8.16 |
| Cross-origin | `cors` ^2.8 |
| File upload (import) | `multer` ^1.4 |
| Validation | `zod` (already in project) |
| Run IDs | `crypto.randomUUID()` (Node built-in, no new dep) |

**Total new runtime deps: 4** — express, ws, cors, multer.

---

## Run Lifecycle

Every operation returns a `runId` immediately. Client polls or streams.

```
1.  POST /api/run  { content: "..." }
          ↓
2.  Server creates RunJob { runId: uuid, status: "queued" }
    → writes job metadata to .aiqa/runs/<runId>/meta.json
          ↓
3.  Returns { runId } immediately (HTTP 202)
          ↓
4.  Client opens  WS /api/runs/<runId>/stream
          ↓
5.  Job dequeued when concurrency slot is free
          ↓
6.  Engine runs — onEvent callback emits to RunJob event buffer
    → buffer replays to all connected WS clients
          ↓
7.  On complete:
    → results written to .aiqa/runs/<runId>/results.json
    → job status updated in .aiqa/runs/<runId>/meta.json
    → WS emits { event: "done" }, connections closed cleanly
```

---

## Concurrency Control

```
AIQA_MAX_WORKERS  =  os.cpus().length  (default)
```

- `RunJobStore` maintains an active set and a FIFO queue
- When a slot frees, the next queued job starts automatically
- Returns HTTP 202 immediately regardless — client is never blocked

```typescript
class RunJobStore {
  private active = new Map<string, RunJob>();   // currently running
  private queue:   RunJob[] = [];               // waiting for a slot
  readonly maxConcurrent = parseInt(process.env.AIQA_MAX_WORKERS ?? "") || os.cpus().length;
}
```

---

## Persistence

**Two-tier:**

| Tier | What | TTL |
|---|---|---|
| Memory | `Map<runId, RunJob>` — fast access for active/recent jobs | 1 hour from completion |
| Disk | `.aiqa/runs/<runId>/` — survives restarts | Never auto-deleted |

**Disk layout per run:**
```
.aiqa/runs/<runId>/
  meta.json          ← status, type, timestamps, summary, screenshotsDir
  results.json       ← full TestResult[] / OrchestratorResult
  exploration.json   ← ExplorationResult (explore runs only — required by /generate)
  report.html        ← generated HTML report (if applicable)
  screenshots/       ← PNG files referenced in step_result events
```

**On server start:** scan `.aiqa/runs/` and reload recent `meta.json` files into memory (last 100, sorted by start time).

**Job store eviction:** after 1 hour in memory, evict from Map — disk persists. `GET /api/runs/:runId` falls back to disk read if not in memory.

---

## WebSocket — Live Streaming

```
WS /api/runs/:runId/stream[?token=<api-key>]
```

**Authentication:** `?token=<api-key>` query param (WebSocket API cannot send custom headers in the browser). Checked in `ws.Server` `verifyClient` callback, not in Express middleware.

**Late-connection replay:** `RunJob` maintains an internal event buffer. New subscribers receive all buffered events first, then live events. Buffer cap: **500 events per run**, TTL: **1 hour**.

**Multiple subscribers:** any number of clients can connect to the same `runId` stream simultaneously (Portal live view + Chrome extension + developer terminal all at once).

**Connection lifecycle:**
```
client connects
  → server replays buffered events
  → server emits live events as they arrive
  → server emits { event: "done" } or { event: "error" }
  → server closes connection cleanly
```

**If client disconnects mid-run:** run continues unaffected.

**Event protocol** (newline-delimited JSON over WS):
```jsonc
{ "event": "step",        "index": 0, "action": "navigate", "target": "/login" }
{ "event": "step_result", "index": 0, "passed": true, "durationMs": 210 }
{ "event": "step",        "index": 1, "action": "fill", "target": "#email" }
{ "event": "step_result", "index": 1, "passed": false, "error": "Element not found",
  "screenshotUrl": "/api/runs/abc123/screenshots/step-1.png" }
{ "event": "test_done",   "testName": "Login smoke", "passed": false, "durationMs": 4100 }
{ "event": "done",        "status": "failed", "summary": { "passed": 0, "failed": 1, "total": 1 } }
```

---

## Authentication

| Context | Auth |
|---|---|
| `localhost` (no `AIQA_API_KEY` set) | Open — no auth required |
| Remote / cloud | HTTP: `Authorization: Bearer <key>` header |
| WebSocket | `?token=<key>` query param |
| Chrome extension | Key stored in `chrome.storage.sync`, sent as `?token=` |
| Portal | Key from server env var |

Single env var: `AIQA_API_KEY`. If unset → open access (local dev mode).

---

## CORS

**HTTP:** Express `cors` middleware.  
**WebSocket:** `verifyClient` callback in `ws.Server` checks `Origin` header independently.

Both read from the same `AIQA_ALLOWED_ORIGINS` env var (comma-separated list).  
Default when unset: `*` (local dev).

```
AIQA_ALLOWED_ORIGINS=http://localhost:3001,chrome-extension://*,https://portal.aiqa.io
```

---

## Security: File System Sandbox

All endpoints that touch the filesystem (`/api/tests`, `/api/runs/:id/report`, `/api/runs/:id/screenshots`) are guarded by:

```typescript
function safeResolvePath(base: string, userInput: string): string {
  const resolved = path.resolve(base, userInput);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new ApiError(400, "Invalid path — outside project root");
  }
  return resolved;
}
```

This is **mandatory, not optional** — applied before any filesystem read or write.

---

## Request Validation (Zod)

All request bodies validated with Zod before reaching route handlers. Clear 400 errors on failure.

```typescript
const RunRequestSchema = z.object({
  content:  z.string().optional(),
  file:     z.string().optional(),
  env:      z.string().default("dev"),
  headless: z.boolean().default(true),
  tags:     z.array(z.string()).optional(),
}).refine(d => d.content || d.file, { message: "Either 'content' or 'file' is required" });

const OrchestrateRequestSchema = z.object({
  url:      z.string().url(),
  env:      z.string().default("dev"),
  outDir:   z.string().optional(),
  headless: z.boolean().default(true),
});
```

---

## Inline YAML Handling

When `POST /api/run` receives `content` (raw YAML string):

```typescript
// Use parseTestDefinition() directly — no temp files, no cleanup
import { parseTestDefinition } from "../dsl/DslParser";
const testDef = parseTestDefinition(body.content);
runner.run(testDef, onEvent);
```

`parseTestDefinition()` already exists in `DslParser.ts` — written exactly for this use case.

---

## Run Cancellation

```
POST /api/runs/:runId/cancel
```

1. If job is **queued** → remove from queue, mark `"cancelled"` immediately
2. If job is **running** → set a cancellation flag on the RunJob; the `onEvent` callback checks this flag after each step and throws `CancelledError`; `TestRunner` surfaces it as a test failure; job marked `"cancelled"`
3. If job is **complete** → returns 409 Conflict

```json
{ "runId": "abc123", "status": "cancelled" }
```

---

## All Endpoints

### Core

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server status, version, uptime |
| `GET` | `/api/runs` | List recent runs (query: `?limit=20&type=run-all`) |
| `GET` | `/api/runs/:runId` | Job status + summary (falls back to disk) |
| `GET` | `/api/runs/:runId/results` | Full results JSON |
| `GET` | `/api/runs/:runId/report` | Serve HTML report |
| `GET` | `/api/runs/:runId/screenshots/:file` | Serve screenshot PNG |
| `WS`  | `/api/runs/:runId/stream` | Live event stream |
| `POST`| `/api/runs/:runId/cancel` | Cancel a queued or running job |

### Run triggers

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/run` | Single test (inline YAML or file path) |
| `POST` | `/api/run-all` | Full test suite |
| `POST` | `/api/orchestrate` | Full pipeline from URL |
| `POST` | `/api/explore` | Exploration only |
| `POST` | `/api/generate` | Generate tests from a prior explore run |
| `POST` | `/api/import` | Import Excel/CSV/Gherkin (multipart) |
| `POST` | `/api/jira-sync` | Push run results to Jira |

### Test file management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tests` | List YAML files (query: `?dir=tests/`) |
| `GET` | `/api/tests/*path` | Read a YAML file |
| `PUT` | `/api/tests/*path` | Save a YAML file (Portal builder) |

---

## Special Behaviours

### `POST /api/generate` — requires persisted exploration
Reads `explorationId` (a prior `runId`) from `.aiqa/runs/<explorationId>/exploration.json`.  
Works across server restarts. Returns 404 if exploration file not found.

### `POST /api/jira-sync` — reads from disk
Loads results from `.aiqa/runs/<resultsId>/results.json`.  
Works even if the job was evicted from the in-memory store.

### `GET /api/tests` — sandboxed
Restricted to project root. Same `safeResolvePath` guard as file writes.

---

## Start Command

New `serve` subcommand added to `cli.ts` (one-liner — calls `startServer()`):

```bash
aiqa serve --port 7432 --env staging
```

Default port: **7432** (avoids conflicts with common dev servers).  
Configurable via `--port` flag or `AIQA_PORT` env var.

---

## File Structure

```
src/
  server.ts                   ← entry point: starts Express + WS server, new CLI "serve" command
  api/
    router.ts                 ← mounts all route groups onto Express app
    routes/
      health.ts               ← GET /health
      runs.ts                 ← GET /runs, GET /runs/:id, GET /runs/:id/results, GET /runs/:id/report
      runTriggers.ts          ← POST /run, /run-all, /orchestrate, /explore, /generate, /import, /jira-sync
      cancel.ts               ← POST /runs/:id/cancel
      tests.ts                ← GET /api/tests, GET/PUT /api/tests/*path
      screenshots.ts          ← GET /runs/:id/screenshots/:file
    ws/
      runStream.ts            ← WS /runs/:runId/stream — replay buffer + live fan-out
    middleware/
      auth.ts                 ← Bearer token check for HTTP routes
      cors.ts                 ← CORS config for HTTP + exports allowlist for WS verifyClient
      validate.ts             ← Zod validation wrapper
      sandbox.ts              ← safeResolvePath — filesystem guard
    jobs/
      RunJob.ts               ← shape: id, type, status, meta, event buffer, cancel flag
      RunJobStore.ts          ← Map<runId, RunJob>, concurrency queue, disk reload on start
    persistence/
      runPersistence.ts       ← write/read .aiqa/runs/<runId>/{meta,results,exploration}.json
```

---

## What Does NOT Change

| File | Status |
|---|---|
| `src/cli.ts` | Untouched (new `serve` command appended at bottom) |
| `src/runner/TestRunner.ts` | **One addition only:** optional `onEvent?` param on `run()` |
| `src/execution/WorkerContext.ts` | **One addition only:** store `onEvent` on `WorkerStore`, call from `wwrite` |
| `src/agents/OrchestratorAgent.ts` | Untouched |
| `src/agents/AppExplorer.ts` | Untouched |
| All step handlers | Untouched |
| DSL / DslParser | Untouched |
| Healer / Memory / Judge | Untouched |

---

## How Each Future Surface Uses This API

### Chrome Extension (API-backed)
1. Records user flow → builds YAML string
2. `POST /api/run` `{ content: "<yaml>" }` → `{ runId }`
3. Opens `WS /api/runs/:runId/stream?token=<key>`
4. Shows live steps in side panel
5. On `done` → displays pass/fail summary

### Pure Chrome Extension (standalone)
- Does **not** use this API
- Built separately, uses `chrome.debugger` CDP
- Parallel track, independent codebase

### AIQA Portal
- `GET /api/runs` → history dashboard
- `POST /api/run-all` → trigger suite
- `WS /api/runs/:runId/stream` → live progress view
- `GET /api/runs/:runId/report` → embed HTML report in iframe
- `GET/PUT /api/tests/*path` → in-browser YAML editor
- `POST /api/orchestrate` → one-click full pipeline from URL input

### Future integrations
- **GitHub Actions** → `POST /api/run-all` + poll `GET /api/runs/:runId`
- **MCP server** → thin wrapper calling these same REST endpoints
- **Slack bot** → `POST /api/orchestrate` on slash command

---

## Review Resolutions (all 14)

| # | Issue | Resolution |
|---|---|---|
| 1 | Streaming requires engine touch | Optional `onEvent` callback on `TestRunner.run()` + `WorkerStore` — backward-compatible |
| 2 | WS late-connection race | RunJob buffers up to 500 events, 1hr TTL — late clients replay from start |
| 3 | WS auth gap (no headers) | `?token=<api-key>` query param, checked in `ws.Server.verifyClient` |
| 4 | Path traversal is a blocker | `safeResolvePath()` mandatory on all filesystem endpoints |
| 5 | `/generate` needs persisted exploration | Exploration result written to `.aiqa/runs/<runId>/exploration.json` at run end |
| 6 | Concurrency cap unspecified | Default `os.cpus().length`, configurable via `AIQA_MAX_WORKERS` |
| 7 | Job store TTL/cleanup | 1hr TTL in memory, last 100 on reload, full results always on disk |
| 8 | CORS for WS not covered by cors package | Separate `verifyClient` callback reads same `AIQA_ALLOWED_ORIGINS` list |
| 9 | screenshotsDir not stored | Captured in RunJob at creation time, stored in `meta.json` |
| 10 | Inline YAML path unspecified | `parseTestDefinition(content)` directly — no temp files |
| 11 | runId format undefined | `crypto.randomUUID()` — no new dep |
| 12 | Port 3000 collision | Default port **7432**, `--port` flag + `AIQA_PORT` env var |
| 13 | jira-sync needs stored results | Reads `.aiqa/runs/<resultsId>/results.json` from disk |
| 14 | GET /api/tests also needs sandbox | Same `safeResolvePath` guard applied |
