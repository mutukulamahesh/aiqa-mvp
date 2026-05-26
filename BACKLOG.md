# AIQA — Production Readiness Backlog

> Current alignment with vision: **~99%**  *(updated 2026-05-22)*
> Sprint 1–2 + Phase 2–5 + Pre-Phase 4 hardening + Phase 4 (Product Surface + Enterprise + Knowledge Layer P1+P2+P3) + Phase 5 (GenAI Testing): **DONE**.
> Remaining: Strategic epics (DEX, OSS, LOCAL, MON) + Phase 6-7 (Vision, desktop, agentic).

---

## Active Sprint Scope (agreed 2026-05-01)

> "Make the engine production-safe, then make it feel like a product."

```
Sprint 1 · Foundation Hardening    — config, isolation, retry, CI/CD, test case importer
Sprint 2 · OrchestratorAgent       — thin pipeline coordinator only
```

Everything else is parked until both sprints are stable.

---

## Sprint 1 — Foundation Hardening `[✅ COMPLETE]`
> Make what exists bulletproof. Nothing ships until all four DoD gates pass.

### EPIC-01 · Config & Environment System `[✅ DONE]`

**Definition of Done:** No part of the codebase reads a hardcoded URL or default timeout. If it does → not done.

| ID | Story | Status |
|---|---|---|
| 1.1 | Create `config/environments/dev.yaml`, `staging.yaml`, `prod.yaml` with `baseUrl`, `apiBase`, `timeouts`, feature flags | [x] |
| 1.2 | `ConfigLoader` — reads profile at startup, validates with Zod, throws on missing required fields (fail fast) | [x] |
| 1.3 | `aiqa run --env staging` — profile name passed to CLI, injected into `ExecutionContext` | [x] |
| 1.4 | Audit and remove all hardcoded URLs/timeouts across `src/` — replace with `ctx.config.*` | [x] |
| 1.5 | Secrets via `dotenv` — `.env` for `ANTHROPIC_API_KEY` etc; `doctor` command warns if missing | [x] |

### EPIC-02 · Parallel Execution & Isolation `[✅ DONE]`

**Definition of Done:** Run `--workers 4` with the same test 10 times. Zero flaky results, zero mixed logs, zero wrong screenshots → done.

| ID | Story | Status |
|---|---|---|
| 2.1 | Each worker gets its own `new BrowserContext` + `new Page` — no shared browser state between workers | [x] |
| 2.2 | `AsyncLocalStorage` context wrapping — test id, logs, debug data scoped per worker, never bleed across | [x] |
| 2.3 | No shared mutable state anywhere in `TestRunner`, `StepInterpreter`, or handlers | [x] |
| 2.4 | Stress test: `aiqa run-all --workers 4` running same test 10× — add this as a local validation script | [x] |

### EPIC-03 · Retry & Circuit Breaker `[✅ DONE]`

**Definition of Done:** `retries: 2` in YAML retries on timeout/locator errors only. Suite stops at 5 consecutive failures.

| ID | Story | Status |
|---|---|---|
| 3.1 | Add `retries?: number` to DSL (`TestDefinition`) — default 0 | [x] |
| 3.2 | Retry only on known transient failure types: timeout, locator not found — not on assertion failures | [x] |
| 3.3 | Circuit breaker in `TestRunner` — track consecutive failures, abort suite if threshold (default 5) hit | [x] |
| 3.4 | Log retry attempts clearly: `↺ retry 1/2 — timeout on step 3` | [x] |

### EPIC-04 · CI/CD Pipeline `[✅ DONE]`

**Definition of Done:** Open a PR → Actions runs → HTML report + screenshots visible as artifacts. That's it.

| ID | Story | Status |
|---|---|---|
| 4.1 | `.github/workflows/ci.yml` — install deps, build, run 1–2 smoke tests on every PR | [x] |
| 4.2 | Upload HTML report + screenshots as GitHub Actions artifacts on every run | [x] |
| 4.3 | Nightly scheduled run against a stable test (`cron: '0 2 * * *'`) | [x] |

---

## Sprint 2 — OrchestratorAgent `[✅ COMPLETE]`
> Make it feel like a product. One command, full pipeline.

### Design Rule — Orchestrator is a thin coordinator, not a smart brain

```
✅ What it does          ❌ What it must NOT do
─────────────────────    ──────────────────────────────
1. call Explorer         add business logic
2. call FlowMapper       manipulate DSL
3. call ScenarioGen      make AI decisions
4. call TestRunner       retry internally
5. call ReadinessScorer  embed domain knowledge
6. print summary
```

If logic could live in a sub-agent → it belongs there, not in the Orchestrator.

### EPIC-05 · OrchestratorAgent `[✅ DONE]`

**Definition of Done:** `aiqa orchestrate --url https://app.com` runs the full pipeline end-to-end with no manual steps.

| ID | Story | Status |
|---|---|---|
| 5.1 | `OrchestratorAgent.run(url, env)` — sequential pipeline: Explorer → FlowMapper → ScenarioGenerator → TestRunner → ReadinessScorer | [x] |
| 5.2 | `aiqa orchestrate --url <url> --env <env>` CLI command wired to `OrchestratorAgent` | [x] |
| 5.3 | Progress output at each stage: `[1/5] Exploring...`, `[2/5] Mapping flows...` etc | [x] |
| 5.4 | Post-run summary — try LLM narrative first, fall back to template string if LLM fails | [x] |
| 5.5 | Summary template (fallback): `Explored N pages · Generated M tests · P passed / F failed · Score: X%` | [x] |

### Risks to Watch

| Risk | Signal | Guard |
|---|---|---|
| Over-engineering Orchestrator | Adding decisions, retries, or conditionals inside it | Move any logic to the relevant sub-agent |
| Config leakage | Any hardcoded URL or timeout still in `src/` | EPIC-01 audit gate |
| Silent parallel bugs | Mixed logs, wrong screenshots, flaky steps under load | EPIC-02 stress test gate |

---

## Sprint 1 — EPIC-06 · Test Case Importer `[✅ DONE — 2026-05-01]`
> Bridge for teams with existing Excel/text/Gherkin test documentation. No rewrite needed.

**Definition of Done:** `aiqa import --file test-cases.xlsx --run` reads the file, generates valid YAML via LLM, executes it, and produces an HTML report. Vague steps are flagged with a warning rather than silently skipped.

**New dependency:** `exceljs` npm package for Excel parsing. All other pieces (LLM, DslParser, TestRunner) already exist.

| ID | Story | Status |
|---|---|---|
| 6.1 | `ExcelImporter` — reads `.xlsx`, extracts rows into `{ id, name, precondition, steps, expected }` objects. Configurable column name map. | [x] |
| 6.2 | `TextImporter` — reads plain text and Gherkin `.feature` files, parses `Scenario` / `Given/When/Then` blocks into same shape | [x] |
| 6.3 | `CSVImporter` — reads `.csv` test case tables, same output shape as ExcelImporter | [x] |
| 6.4 | `TestCaseTranslator` — LLM maps natural language steps to AIQA DSL actions. Knows available actions: `navigate`, `click`, `fill`, `assert`, `api`. Flags vague steps with `# WARNING: could not infer assertion` | [x] |
| 6.5 | Validate generated YAML through existing `DslParser` before writing — reject and warn on invalid output | [x] |
| 6.6 | `aiqa import --file <path> --sheet <name> --out <dir>` — generates one YAML file per test case into output dir | [x] |
| 6.7 | `aiqa import --file <path> --run` — import + execute in one command, produce HTML report | [x] |
| 6.8 | Test data handling — blank values in Excel get sensible defaults; note in generated YAML as `# TODO: replace with real test data` | [x] |

**Scenarios this unlocks:**
- Scenario 2 (Java/Selenium team with Excel repo) — import existing docs, run immediately, no rewrite
- Scenario 3 (maintenance project) — import manual test cases, find which ones fail, close gaps

---

## Phase 2 — Intelligence Layer `[IN PROGRESS]`
> What makes AIQA an AI platform, not just a runner

### EPIC-04 · OrchestratorAgent `[✅ DONE — see Sprint 2]`
| ID | Story | Status |
|---|---|---|
| 4.1 | `OrchestratorAgent` — accepts goal, decomposes into sub-agent tasks, routes to Explorer → Generator → Runner | [x] |
| 4.2 | Task dependency graph — sequential vs parallel task execution | [x] |
| 4.3 | `aiqa orchestrate --url https://app.com` — one command runs the full pipeline | [x] |
| 4.4 | Post-run narrative via LLM — "3 critical flows tested, 1 failed" execution summary | [x] |

### EPIC-05 · Self-Healer Agent `[✅ DONE]`
> Fully built: SelectorHealer + HealerCache + contextKey + semantic scoring + role validation + visibility guard + FlowMapper seeding + HealerAnalytics. 283 tests. 2026-05-06.

| ID | Story | Status |
|---|---|---|
| 5.1 | `HealerAgent` — when locator fails, pass DOM + screenshot to Claude for repair | [x] |
| 5.2 | Healer history store — persist repairs in `.aiqa/healer-cache.json`, indexed by URL+descriptor | [x] |
| 5.3 | Cached fix — on next run, try stored fix first; multi-selector ranked by score (confidence×10 + successCount×2×decay − failureCount×3 + recencyBoost) | [x] |
| 5.4 | Integrate into `PlaywrightAdapter` — transparent healing on click/fill, retry after heal | [x] |
| 5.5 | Healer report — analytics block in CLI after every `orchestrate` run; cold/warm/seeded stats | [x] |
| 5.6 | SPA context key — `buildContextKey()` SHA-256 fingerprint; `getValidated()` enforces context match | [x] |
| 5.7 | Semantic scoring + role validation + `validateVisible()` guard — rejects hidden/disabled candidates | [x] |
| 5.8 | FlowMapper seeding — validated selectors embedded directly in generated steps; `getSeedCount()` | [x] |

### EPIC-06 · Memory Layer `[✅ DONE — 2026-05-06]`
| ID | Story | Status |
|---|---|---|
| 6.1 | `MemoryStore` — JSON file per test suite, tracks flakiness score per step across runs | [x] |
| 6.2 | Flakiness score — increment on fail, decay on pass; flag tests above 0.4 threshold | [x] |
| 6.3 | Known failure patterns — store root cause + fix suggestion from DebuggerAgent, skip LLM on repeat | [x] |
| 6.4 | Memory-aware retry — flaky tests get longer wait before retry, uses flakiness score | [x] |

### Healer Analytics `[✅ DONE — 2026-05-06]`
> Turns accumulated healer data into a structured report surfaced after every `orchestrate` run.

| ID | Story | Status |
|---|---|---|
| H.1 | `HealerAnalytics` class — `getTopUnstablePages`, `getMostHealedSelectors`, `getFlakiestSteps` | [x] |
| H.2 | Run log persistence — appends `RunRecord` to `.aiqa/healer-runs.json` after every orchestrate run | [x] |
| H.3 | `getMemoryReuseTrend(lastN)` + `getTotalLLMCallsSaved()` — cumulative LLM savings across runs | [x] |
| H.4 | `static format(report)` — CLI formatter; silent on cold first run, full analytics block from run 2 onward | [x] |
| H.5 | Noise filter — flakiest steps require ≥ 3 uses to suppress 1-failure/1-run false positives | [x] |
| H.6 | Wired into `OrchestratorAgent` + `cli.ts` — `analytics` field on result, printed after summary | [x] |

---

## Phase 3 — Coverage Expansion `[✅ COMPLETE — 2026-05-07]`
> One YAML to test the whole application

### EPIC-07 · DB Testing Handler `[✅ DONE]`
| ID | Story | Status |
|---|---|---|
| 7.1 | `DBHandler` — execute SQL queries as a DSL step (`db: { query: "SELECT..." }`) | [x] |
| 7.2 | `DBAdapter` interface + PostgreSQL implementation via Knex.js — mirrors PlaywrightAdapter pattern | [x] |
| 7.3 | Assert on query result — row count, field values, schema shape | [x] |
| 7.4 | Chained API → DB verification — call API, then assert DB state changed in same test | [x] |

### EPIC-08 · Flow Control Handlers `[✅ DONE]`
| ID | Story | Status |
|---|---|---|
| 8.1 | `WaitHandler` — `wait_for_element`, `wait_ms`, `wait_for_url` steps | [x] |
| 8.2 | `ConditionHandler` — `if: { variable: x, equals: y }` branching in test flows | [x] |
| 8.3 | `LoopHandler` — `for_each` over API response array for data-driven steps (max 100 iterations, depth guard) | [x] |
| 8.4 | `StoreHandler` — capture page text/attribute into variable (`store: { selector: ..., as: token }`) | [x] |

### EPIC-09 · LLM Judge `[✅ DONE]`
| ID | Story | Status |
|---|---|---|
| 9.1 | `JudgeHandler` — `judge:` DSL step: LLM scores a value 0.0–1.0 against natural-language criteria | [x] |
| 9.2 | `pass_if` expression — deterministic pass/fail from score (operators: `>=` `<=` `>` `<`); verdict never delegated to LLM | [x] |
| 9.3 | Per-execution determinism cache — sha256(value+prompt) key; retry reuses cached score without re-calling LLM | [x] |
| 9.4 | `store_as` support — stores `{ score, verdict, reason }` as template variables for downstream steps | [x] |
| 9.5 | Input guards — truncates input at 5 000 chars (LLM notified); throws immediately on empty input | [x] |

---

## Pre-Phase 4 Hardening `[✅ DONE — 2026-05-07]`
> Scalability and concurrency hardening applied before Phase 4 enterprise work begins. No architecture changes — defensive fixes only.

### Pass 1 — Scalability & Concurrency
| ID | Fix | Status |
|---|---|---|
| H4.1 | `ExecutionContext` memory safety — deep-clone stored objects; soft array cap at 1 000 items | [x] |
| H4.2 | `JudgeHandler` determinism cache — sha256-keyed in-memory cache; retry reuses score, no LLM re-call | [x] |
| H4.3 | Atomic writes for `HealerCache`, `MemoryStore`, `HealerAnalytics` — write to `.pid.tmp` then `renameSync` | [x] |
| H4.4 | Knex pool config — `min=2 max=10 acquireTimeout=30s`; pool exhaustion surfaces as clear error message | [x] |

### Pass 2 — Last-Edge Fixes
| ID | Fix | Status |
|---|---|---|
| H4.5 | Lost-update protection — mtime capture at load + re-read + merge-on-conflict for all three file stores | [x] |
| H4.6 | Judge score normalisation before caching — `toFixed(3)` runs once; all consumers read one canonical value | [x] |
| H4.7 | `ExecutionContext` non-serializable guard — throws `"non-serializable value stored via store_as"` instead of silent data loss | [x] |
| H4.8 | DB pool visibility — logs `[DB] pool config: min=2, max=10, workers=<N>` at init via `AIQA_WORKERS` env | [x] |

---

## Phase 4 — Product Surface `[✅ COMPLETE — 2026-05-11]`
> Make AIQA usable beyond the CLI — API layer unlocks Portal, Chrome Extension, and all future integrations

### EPIC-API · REST API Layer `[✅ DONE — 2026-05-11]`
> **Design doc:** `API_LAYER_DESIGN.md`

| ID | Story | Status |
|---|---|---|
| A.1 | `src/server.ts` — Express + WS server, `aiqa serve` CLI command, port 7432 | [x] |
| A.2 | `RunJobStore` — in-memory Map + FIFO concurrency queue (default `os.cpus().length`) | [x] |
| A.3 | Disk persistence — `.aiqa/runs/<runId>/{meta,results,exploration}.json` | [x] |
| A.4 | `POST /api/run` + `POST /api/run-all` + `POST /api/orchestrate` — trigger endpoints | [x] |
| A.5 | `POST /api/explore` + `POST /api/generate` (reads persisted exploration) | [x] |
| A.6 | `POST /api/import` (multipart via multer) + `POST /api/jira-sync` | [x] |
| A.7 | `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/results`, `GET /api/runs/:id/report` | [x] |
| A.8 | `WS /api/runs/:runId/stream` — replay buffer (500 events, 1hr TTL), fan-out to multiple clients | [x] |
| A.9 | `POST /api/runs/:runId/cancel` — graceful cancellation via onEvent flag | [x] |
| A.10 | `GET/PUT /api/tests/*path` — YAML file read/write with path traversal guard | [x] |
| A.11 | Auth middleware (Bearer HTTP + `?token=` WS), CORS for HTTP + WS verifyClient | [x] |
| A.12 | Zod request validation on all endpoints, clear 400 errors | [x] |
| A.13 | `TestRunner.run(test, onEvent?)` — optional callback (only engine touch), WorkerContext wire-up | [x] |
| A.14 | Screenshot serving `GET /api/runs/:id/screenshots/:file` | [x] |

### EPIC-EXT-A · Chrome Extension (API-backed)
> Depends on EPIC-API. Design doc: `CHROME_EXTENSION_DESIGN.md` Track A. Planned for future release.

| ID | Story | Status |
|---|---|---|
| EA.1 | Extension scaffold — Manifest V3, side panel, service worker | [ ] |
| EA.2 | Flow recorder — content script captures click/fill/navigate as YAML | [ ] |
| EA.3 | `POST /api/run` integration — sends recorded YAML, gets runId | [ ] |
| EA.4 | WS live view — step-by-step results in side panel | [ ] |
| EA.5 | Settings page — server URL + API key configuration | [ ] |
| EA.6 | Test library — save/load named tests via `GET/PUT /api/tests` | [ ] |

### EPIC-EXT-B · Chrome Extension (Pure / Zero-setup) `[✅ DONE — 2026-05-11]`
> Independent of EPIC-API. Design doc: `CHROME_EXTENSION_DESIGN.md` Track B.

| ID | Story | Status |
|---|---|---|
| EB.1 | `ChromeDebuggerAdapter` — navigate, click, fill, assert via CDP | [x] |
| EB.2 | AI test generation — page HTML → Claude API → YAML steps | [x] |
| EB.3 | Record mode — captures user flow, replays with visual highlights | [x] |
| EB.4 | Pass/fail result display + chrome.storage persistence | [x] |
| EB.5 | Export as YAML + import from file | [x] |

### EPIC-PORTAL · AIQA Portal (Web UI) `[✅ DONE — 2026-05-11]`
> React + Vite frontend calling the API. Served at port 7432.

| ID | Story | Status |
|---|---|---|
| P.1 | Portal scaffold — React + Vite, `portal/` folder | [x] |
| P.2 | Run history dashboard — `GET /api/runs` table view with status filters | [x] |
| P.3 | Live run view — trigger + WS progress stream, step details, screenshots | [x] |
| P.4 | HTML report embed — iframe from `GET /api/runs/:id/report` | [x] |
| P.5 | YAML test editor — `GET/PUT /api/tests` with syntax highlighting | [x] |
| P.6 | Orchestrate UI — URL input + env vars panel → one-click full pipeline | [x] |

### Stage 1b — Authenticated Re-exploration `[✅ DONE — 2026-05-12]`
> Automatic login + post-login BFS crawl merged into the main exploration before FlowMapper runs.

| ID | Story | Status |
|---|---|---|
| S1b.1 | `AppExplorer.exploreAuthenticated()` — login via Playwright + BFS crawl in shared auth context | [x] |
| S1b.2 | `OrchestratorAgent` Stage 1b — detects login page, extracts credentials, merges post-login pages | [x] |
| S1b.3 | `discoverSpaRoutes()` — intercepts `history.pushState` to find React Router routes from `href="#"` anchors | [x] |
| S1b.4 | Credential resolution — reads from raw env string OR `process.env` (set by API vars panel) | [x] |

---

## Phase 4 — Enterprise Integration `[BUSINESS VALUE]`
> Connect QA to the rest of the organisation

### EPIC-10 · Jira Full Integration `[✅ DONE — 2026-05-19]`
| ID | Story | Status |
|---|---|---|
| 10.1 | Full `JiraClient` — read stories, fetch acceptance criteria; `extractAcceptanceCriteria()` parses ADF + `customfield_10016` | [x] |
| 10.2 | `aiqa generate --jira SCRUM --sprint 42` — filter stories by sprint, generate YAML scenarios | [x] |
| 10.3 | Auto-create defect on test failure — screenshot attached via `attachFile()` multipart upload | [x] |
| 10.4 | Xray result sync — `syncXrayResults()` pushes pass/fail to Jira test execution | [x] |

### EPIC-11 · Reporting & Notifications
| ID | Story | Status |
|---|---|---|
| 11.1 | Allure reporter integration alongside existing HTML reporter | [x] |
| 11.2 | Slack webhook — post run summary on complete or on failure, configurable channel | [x] |
| 11.3 | Email notification — send HTML report on suite complete via nodemailer + SMTP | [x] |
| 11.4 | Trend dashboard — pass rate over time, flakiness trends appended to `results/history.json` | [x] |
| 11.5 | JUnit XML reporter — `--junit <file>` for GitHub Actions / GitLab / Azure DevOps test parsers | [x] |
| 11.6 | HTML report enhancements — SVG trend chart, top-5 flaky heatmap, step duration bars | [x] |

### EPIC-12 · Impact Filter `[✅ DONE — 2026-05-15]`
| ID | Story | Status |
|---|---|---|
| 12.1 | Git diff parser — identify changed files per PR (`git diff --name-only origin/main`) | [x] |
| 12.2 | File → test mapping — which YAML tests cover which app areas (tag-based or path-based) | [x] |
| 12.3 | `aiqa run-all --impact-only` — skip unaffected tests in CI (target: 40%+ CI time reduction) | [x] |

### EPIC-13 · CLI/UX Polish `[✅ DONE — 2026-05-18]`
| ID | Story | Status |
|---|---|---|
| 13.1 | `Spinner` — TTY-aware spinner (no-op in CI), `.unref()` so it never hangs the process | [x] |
| 13.2 | `aiqa list [dir]` — tabular view of all test files with name, tags, step count, path | [x] |
| 13.3 | `aiqa doctor` — hardened health check: Node, Playwright, zod, .env, config, disk space, exit codes | [x] |
| 13.4 | `aiqa config validate [env]` — validates + prints resolved config; actionable error messages | [x] |
| 13.5 | `aiqa completion [shell]` — generates bash/zsh tab-completion scripts | [x] |
| 13.6 | `aiqa init` — interactive prompt when project name omitted; `--base-url` flag | [x] |
| 13.7 | Actionable errors — explore/run failures suggest next steps (`aiqa list`, `aiqa init`) | [x] |

---

## Phase 4 — Knowledge Layer `[✅ COMPLETE — 2026-05-21]`
> Give AIQA organisational memory — tests generated from UI exploration AND historical knowledge

### EPIC-RAG · RAG Knowledge Layer

**Zero-cost stack:** `@xenova/transformers` (local embeddings, no API key) · `vectra` (local JSON vector index, no server)

**Architecture principles:**
- Hybrid retrieval (Phase 1: cosine-only; Phase 2: semantic + recency + severity + source weight)
- Injectable `Chunker` interface (Phase 1: NaiveChunker; Phase 2: AC-aware)
- Injectable `Reranker` interface (Phase 1: cosine; Phase 2: multi-signal HybridReranker)
- `KnowledgeStore.feedback()` — active feedback learning loop from test outcomes
- `relations[]` on every chunk — Knowledge Graph traversal ready for Phase 3
- `KnowledgeRetriever` is standalone — wired into Healer, Judge, FlowMapper, readiness

#### Phase 1 — Jira-only `[✅ DONE — 2026-05-20]`

| ID | Story | Status |
|---|---|---|
| RAG-1 | `KnowledgeChunk`, `RetrievedChunk`, `KnowledgeConfig` types | [x] |
| RAG-2 | `Embedder` — lazy-loads `all-MiniLM-L6-v2` locally; `StubEmbedder` for CI | [x] |
| RAG-3 | `VectorIndex` — wraps `vectra` `LocalIndex`; `add`, `search`, `clear`, `listAll`, `updateConfidence` | [x] |
| RAG-4 | `KnowledgeStore` — combines `IEmbedder` + `VectorIndex`; `ingest`, `retrieve`, `feedback`, `listAll` | [x] |
| RAG-5 | `Chunker` interface + `NaiveChunker` (max 2000 chars) | [x] |
| RAG-6 | `Reranker` interface + `CosineSimilarityReranker` | [x] |
| RAG-7 | `KnowledgeConnector` interface | [x] |
| RAG-8 | `JiraConnector` — stories + defects, ADF → plain text, severity/tags | [x] |
| RAG-9 | `KnowledgeIngester` — runs connectors, deduplicates, writes `meta.json` | [x] |
| RAG-10 | `KnowledgeRetriever` — standalone; returns `[]` gracefully if index missing | [x] |
| RAG-11 | `HealthScorer` — GOOD / WARN / STALE / EMPTY; chunk count + source breakdown | [x] |
| RAG-12 | Config: `knowledge:` block in ConfigLoader Zod schema | [x] |
| RAG-13 | CLI: `aiqa knowledge ingest` | [x] |
| RAG-14 | CLI: `aiqa knowledge status` | [x] |
| RAG-15 | Wire `KnowledgeRetriever` into `FlowMapper.map()` | [x] |
| RAG-16 | Wire `KnowledgeRetriever` into `ScenarioGenerator.generate()` | [x] |
| RAG-17 | `source?: string[]` in `TestDefinition` DSL | [x] |
| RAG-18–21 | Tests: 50+ across Embedder, VectorIndex, KnowledgeStore, JiraConnector, FlowMapper | [x] |
| RAG-22 | Connector stubs: `ConfluenceConnector`, `OpenAPIConnector`, `GitConnector` | [x] |
| RAG-23 | Docs updated | [x] |

#### Phase 2 — Hybrid retrieval + feedback loop `[✅ DONE — 2026-05-21]`

| ID | Story | Status |
|---|---|---|
| RAG2-01 | `HybridReranker` — configurable 4-weight formula: semantic + recency + severity + sourceWeight; score clamped [0,1] | [x] |
| RAG2-02 | `ACChunker` — one chunk per AC bullet; prose preserved via NaiveChunker pass | [x] |
| RAG2-03 | `KnowledgeStore.feedback()` active — pass +0.05 / fail −0.10 / flaky −0.03; TestRunner wired | [x] |
| RAG2-04 | `ConfluenceConnector` — full impl: REST API v1, HTML strip, label tags, pagination via `_links.next` | [x] |
| RAG2-05 | `OpenAPIConnector` — JSON/YAML spec fetch, one chunk per path×method, op.tags | [x] |
| RAG2-06 | `GitConnector` — `git log` + `--name-only` file extraction, conventional-scope tags, lookbackDays | [x] |
| RAG2-07 | `SelectorHealer` + `KnowledgeRetriever` — `fetchDefectContext` injects defect chunks into LLM prompt | [x] |
| RAG2-08 | `JudgeHandler` + `KnowledgeRetriever` — AC context appended; cache key includes AC; system prompt nudge | [x] |
| RAG2-09 | `KnowledgeReadinessScorer` — READY/PARTIAL/MISSING by tag; avgConf ≥ 0.6 threshold; `aiqa knowledge readiness --tag` | [x] |
| RAG2-10 | CLI: multi-connector ingest loop with `--only` flag; per-connector skip + warning | [x] |
| RAG2-11 | Config: `reranker` object (strategy + 4 weight fields); `lookbackDays` on connector config | [x] |
| — | Tests: 701 passing total; 37 new in `rag2-connectors.test.ts` | [x] |

#### Phase 3 — Quality & Trust `[▶ NEXT]`

> Make retrieval auditable and safe. Closes the defect-masking hole and makes AI decisions explainable.

| ID | Story | Est | Status |
|---|---|---|---|
| RAG3-01 | `defect.category: "ui" \| "functional" \| "regression"` on `KnowledgeChunk` — set during ingest; `SelectorHealer` filters to `"ui"` only; `"functional"` defects surface as run report warnings, not healing fuel | S | [ ] |
| RAG3-02 | `scoreBreakdown` in `RetrievedChunk` — HybridReranker preserves sub-scores (semantic, recency, severity, sourceWeight, connectorId); logged at debug level; visible in `judge:` step output and `aiqa knowledge status` | M | [ ] |
| RAG3-03 | Retrieval budget in config — `knowledge.budget.maxChunks` + `knowledge.budget.maxTokensApprox`; enforced in `KnowledgeRetriever.retrieve()`; per-connector-type token estimates (api chunks ~400t, git ~80t, page ~150t) | S | [ ] |
| RAG3-04 | Knowledge Graph foundations — `GraphEnricher` expands retrieved chunks one hop via `relations[]`; `JiraConnector` populates `relations` (story→defect, defect→story) during ingest using Jira issue links API | L | [ ] |

#### Phase 4 — Multi-tenant & permissions (future)
- Permission-aware retrieval — source ACL inherited (required for enterprise SaaS)
- `SemanticChunker` — LLM-assisted boundary detection
- Multi-hop reasoning: story ↔ defect ↔ API ↔ test ↔ production incident

---

## Phase 5 — GenAI Testing `[✅ COMPLETE — 2026-05-22]`
> Test AI systems the same way we test web apps — merged to `main`

### Design decisions (locked before implementation)

**D-1 · Target LLM: named reference, not per-step inline.**
Test YAML uses a `target:` name that resolves to a block in config. This makes tests
portable across environments (staging uses gpt-3.5, prod uses gpt-4o) without touching
test files. Config schema adds a new `llm_targets` map:
```yaml
# config/environments/dev.yaml
llm_targets:
  default:  { provider: mock }
  fast:     { provider: anthropic, model: claude-haiku-4-5-20251001 }
  powerful: { provider: anthropic, model: claude-sonnet-4-6 }
```
YAML test:
```yaml
- llm_eval:
    target: fast                   # resolves via config llm_targets
    prompt: "Translate 'hello' to French"
    ...
```
Inline `provider/model` still accepted as escape hatch for one-off tests, but not the
recommended path. ConfigLoader Zod schema extended with `llm_targets` map.

**D-2 · BaselineStore path: `tests/baselines/` (version-controlled).**
Default path is `tests/baselines/{baseline_key}.json`, NOT `.aiqa/` (which is gitignored).
Baselines are committed alongside tests — CI always has a baseline; first-run-passes
in CI are explicitly opt-in via `AIQA_BASELINE_RECORD=true` env var (record mode).
Normal CI runs always diff against the committed baseline; missing baseline = test error.

**D-3 · Consistency variance metric: max pairwise cosine distance.**
For N responses, compute all N*(N-1)/2 pairwise cosine distances; the failing threshold
is checked against the maximum. This is the most conservative metric — one outlier
response triggers failure. Configurable to `mean` via `variance_metric: max|mean`.
LLM calls are sequential by default; `parallel: true` opt-in per-step with a 3-call
concurrency cap to avoid rate-limit errors in CI.

**D-4 · GEN-03 gated behind a spike.**
`agent_trace:` is held from the first commit. A spike defines the `AgentTrace` interface
and proves both OpenAI Assistants + LangChain traces normalise cleanly without a
third-party lib. If clean → GEN-03 proceeds. If not → Phase 5 ships with custom-schema
only; Assistants/LangChain normalisation moves to Phase 6.

---

### EPIC-GEN · AI Application Testing

**Implementation order:** GEN-01 → GEN-04 → GEN-05 → GEN-02 → GEN-03 (gated)

#### GEN-01 · LLMEvalHandler `[S]`
New `llm_eval:` DSL step. Resolves `target` from `llm_targets` config, calls that LLM,
then judges the response using AIQA's internal judge LLM (same as `judge:` step).

```yaml
- llm_eval:
    target: fast                   # resolved via config.llm_targets
    system: "You are a helpful assistant"
    prompt: "Translate 'hello' to French"
    max_tokens: 100
    assert_quality:
      criteria: "Response is a correct French translation"
      pass_if: ">= 0.8"
    store_as: evalResult           # { response, score, verdict, reason }
```

Files:
- `src/handlers/LLMEvalHandler.ts`
- `src/dsl/types.ts` — add `llm_eval` to `StepAction` union
- `src/config/ConfigLoader.ts` — add `llm_targets` Zod schema
- Refactor `JudgeHandler` to extract `scoreValue(value, criteria, acContext)` as a
  module-level helper; both `JudgeHandler` and `LLMEvalHandler` call it

#### GEN-04 · ConsistencyHandler `[M]`
New `llm_consistency:` DSL step. Runs the same prompt N times (sequential default,
`parallel: true` opt-in with 3-call cap), computes max pairwise cosine distance across
embeddings of all responses, fails if distance exceeds `max_variance`.

```yaml
- llm_consistency:
    target: fast
    prompt: "What is the capital of France?"
    runs: 5
    max_variance: 0.1              # max pairwise cosine distance (default metric)
    variance_metric: max           # max | mean — default max
    assert_all_quality:
      criteria: "Answer correctly names Paris"
      pass_if: ">= 0.9"
    store_as: consistencyResult    # { runs, max_variance_observed, metric, passed, responses[] }
```

Files:
- `src/handlers/ConsistencyHandler.ts`
- `src/ai-testing/VarianceComputer.ts` — pairwise cosine via Embedder; supports max/mean

#### GEN-05 · RagAssertHandler `[S]`
New `rag_assert:` DSL step. Injected with `KnowledgeRetriever` via constructor (same
pattern as `JudgeHandler` in `StepInterpreter`) — no new wiring needed, just add
`new RagAssertHandler(opts.retriever)` to the registry.

```yaml
- rag_assert:
    query: "user authentication acceptance criteria"
    min_chunks: 2
    min_relevance: 0.7
    assert_contains_type: story
    assert_contains_source: "SCRUM-42"
    store_as: ragResult            # { chunks[], passed }
```

Files:
- `src/handlers/RagAssertHandler.ts`

#### GEN-02 · Prompt Regression `[M]`
Extends `llm_eval` with `baseline_key` + `max_drift`. Baseline files live in
`tests/baselines/` (version-controlled). Missing baseline in non-record mode = test error.
Record mode enabled via `AIQA_BASELINE_RECORD=true` env var.

```yaml
- llm_eval:
    target: powerful
    prompt: "Summarise our product in one sentence"
    baseline_key: "product-summary-v1"
    max_drift: 0.15
    store_as: regressionResult     # { response, drift, baseline_response, passed }
```

Files:
- `src/ai-testing/BaselineStore.ts` — reads/writes `tests/baselines/{key}.json`
- `LLMEvalHandler` extended: baseline_key triggers load/store + drift computation

#### GEN-03 · AgentTraceHandler `[L — gated by spike]`
Spike first: define `AgentTrace` interface + confirm OpenAI Assistants and LangChain
trace schemas normalise without third-party parsing library. If clean → implement.
If not → Phase 5 ships with custom-schema only.

```yaml
- agent_trace:
    url: "http://localhost:3001/api/agent"
    method: POST
    body: { message: "Book me a flight to Paris" }
    assert_steps:
      - tool_called: "search_flights"
      - tool_called: "present_options"
    assert_final_response:
      criteria: "Response presents flight options with prices"
      pass_if: ">= 0.8"
    store_as: agentTrace
```

Files (post-spike):
- `src/handlers/AgentTraceHandler.ts`
- `src/ai-testing/TraceParser.ts`

---

| ID | Story | Size | Status |
|---|---|---|---|
| GEN-01 | `llm_eval:` — named target, call LLM, judge quality | S | [x] |
| GEN-04 | `llm_consistency:` — N runs, max pairwise cosine variance | M | [x] |
| GEN-05 | `rag_assert:` — KnowledgeRetriever assertion step | S | [x] |
| GEN-02 | Prompt regression — BaselineStore in tests/baselines/, drift via Embedder | M | [x] |
| GEN-03 | `agent_trace:` spike — schema + normalizers proven clean; deferred (injectable transport needed) | L | [x] spike |

---

---

## Strategic Gap Plan `[OSS ADOPTION + MARKET GAPS]`
> Addresses 8 market gaps and 8 OSS adoption blockers from strategic review (2026-05-21).
> These run in parallel with product phases — not a replacement for them.

### EPIC-DEX · Developer Experience & Adoption `[HIGH PRIORITY]`
Fix the friction that kills adoption before a developer sees any value.

**Agreed delivery order (2026-05-22):**
1. README messaging ✅ → 2. DEX-03 Docker ✅ → 3. DEX-07 Shell script ✅ → 4. DEX-06 Python wrapper ✅ → 5. DEX-05 README quickstart ✅ → 6. LOCAL-02/04 Ollama doctor + privacy mode ✅ → 7. MON-01 Scheduled runs ✅ → 8. DEX-08/09/10 GitHub Action + Maven/Gradle → 9. DEX-11/12 REST API clients → 10. DEX-13/14 IDE extensions (after REST API client exists)

| ID | Story | Blocker | Status |
|---|---|---|---|
| DEX-01 | `OllamaLLMProvider` — local LLM, no API key, data never leaves machine | #1 API key, #6 sensitive data | [x] |
| DEX-02 | `npx aiqa demo` command — runs against a public app with mock LLM, zero config | #1 API key, #5 feature overwhelm | [ ] |
| DEX-03 | Official Docker image — Node + Playwright pre-installed; `docker run -v $(pwd)/tests:/tests aiqa/aiqa run /tests/login.yaml` | #2 Node.js only, #4 air-gapped CI | [x] |
| DEX-04 | "Add AIQA to existing Playwright project" guide — AIQA as enhancement, not replacement | #7 existing Cypress/PW tests | [ ] |
| DEX-05 | Progressive README — 30-second quickstart first, full feature list behind a link | #5 feature overwhelm | [x] |
| DEX-06 | Python wrapper — `pip install aiqa-runner` shells out to Node CLI; thin, honest, no re-implementation | #2 Node.js only | [x] |
| DEX-07 | Shell script installer — `curl -fsSL https://get.aiqa.dev \| sh` installs Node + AIQA silently; targets Linux/macOS CI | #4 air-gapped CI, #2 Node.js only | [x] |
| DEX-08 | GitHub Actions native action — `uses: aiqa/aiqa-action@v1`; no install step in CI at all | CI teams | [x] |
| DEX-09 | Maven plugin — `mvn aiqa:run`; Java enterprise teams; shells out to Docker or Node CLI | #2 Node.js only (Java shops) | [x] |
| DEX-10 | Gradle plugin — `./gradlew aiqaRun`; Spring Boot / Android teams | #2 Node.js only (Java shops) | [x] |
| DEX-11 | REST API language-native Python client — `pip install aiqa-client` calls AIQA REST API; no Node required at all | advanced, air-gapped | [x] |
| DEX-12 | REST API language-native Java client — Maven artifact calling AIQA REST API | advanced, Java enterprise | [x] |
| DEX-13 | VS Code extension MVP — right-click YAML → run, live results panel, inline failure highlighting, YAML autocomplete; depends on DEX-11 REST API client | IDE integration | [x] |
| DEX-14 | JetBrains plugin — same feature set as VS Code extension; targets IntelliJ IDEA, PyCharm, WebStorm | IDE integration (Java/Python shops) | [x] |

### EPIC-OSS · Open Source Community & Trust `[MEDIUM PRIORITY]`
The engineering quality is invisible until you dig in. Make it visible upfront.

| ID | Story | Blocker | Status |
|---|---|---|---|
| OSS-01 | `CHANGELOG.md` — semantic versioning, entry per release with migration notes | #3 one contributor | [ ] |
| OSS-02 | `CONTRIBUTING.md` — local dev setup, test conventions, PR checklist | #3 one contributor | [ ] |
| OSS-03 | Publish open-core business model in README — "Core: forever free. Cloud: hosted execution for teams" | #8 monetisation fear | [ ] |
| OSS-04 | GitHub Discussions enabled + pinned "Roadmap & Q3 2026 goals" thread | #3 no community signals | [ ] |
| OSS-05 | Readiness Score badge — `[![AIQA Readiness](badge-url)](report-url)` embeddable in repo READMEs | marketing | [ ] |

### EPIC-LOCAL · Local-First & Privacy Mode `[HIGH PRIORITY]`
Unlock enterprise teams that block external API calls.

| ID | Story | Gap | Status |
|---|---|---|---|
| LOCAL-01 | `OllamaLLMProvider` — done above | #6 sensitive data | [x] |
| LOCAL-02 | `aiqa doctor` Ollama check — detects running Ollama instance + pulled models | DX | [x] |
| LOCAL-03 | "Data stays on-prem" documentation section — explicit about what leaves the machine and when | #6 sensitive data | [x] |
| LOCAL-04 | Config: `privacy_mode: true` — blocks all outbound LLM calls, forces local-only | #6 sensitive data | [x] |

### EPIC-MON · Synthetic Monitoring `[MEDIUM PRIORITY]`
DataDog alternative at near-zero cost.

| ID | Story | Gap | Status |
|---|---|---|---|
| MON-01 | `aiqa schedule "*/5 * * * *" tests/smoke/` — cron-triggered recurring test runs | #7 synthetic monitoring | [x] |
| MON-02 | `--alert-webhook <url>` — POST JSON payload to Slack/Teams/PagerDuty on failure | #7 synthetic monitoring | [x] |
| MON-03 | Uptime history in `results/` — rolling 30-day pass/fail log per test file | #7 synthetic monitoring | [x] |

---

## Phase 6 — Vision & Desktop `[SELECTOR-FREE TESTING]`
> Works on any UI with no DOM access

### EPIC-14 · Vision Agent
| ID | Story | Status |
|---|---|---|
| 14.1 | `VisionAgent` — screenshot → Claude Vision → detected elements, builds object repository | [ ] |
| 14.2 | OCR pass — Tesseract for text positions, open-source, no API cost | [ ] |
| 14.3 | `SmartLocatorEngine` — LLM-assisted locator healing, integrates with HealerAgent (EPIC-05) | [ ] |
| 14.4 | Visual regression — screenshot diff across runs, flag changes above N% pixel threshold | [ ] |
| 14.5 | Object repository — auto-maintained element library per app URL (`object-repository/web/<url>.json`) | [ ] |

### EPIC-15 · Desktop Automation
| ID | Story | Status |
|---|---|---|
| 15.1 | `DesktopAdapter` — WinAppDriver for Windows native apps, mirrors PlaywrightAdapter interface | [ ] |
| 15.2 | Vision fallback for desktop — when WinAppDriver fails, use VisionAgent | [ ] |
| 15.3 | `DesktopHandler` — `desktop_click`, `desktop_fill`, `desktop_assert` DSL steps | [ ] |

---

## Phase 7 — Platform & Scale `[PRODUCT]`
> From tool to SaaS platform

### EPIC-16 · Multi-Language Support
| ID | Story | Status |
|---|---|---|
| 16.1 | Python runner adapter — execute AIQA YAML tests from Python via gRPC bridge or subprocess | [ ] |
| 16.2 | Java runner adapter — same approach as Python | [ ] |

### EPIC-17 · No-Code UI
| ID | Story | Status |
|---|---|---|
| 17.1 | Web dashboard — view test results, run history, flakiness trends (React + local API) | [ ] |
| 17.2 | Visual test builder — drag-and-drop step composer that generates YAML | [ ] |
| 17.3 | Run dashboard — live progress view during execution via WebSocket streaming | [ ] |

### EPIC-18 · Cloud & SaaS
| ID | Story | Status |
|---|---|---|
| 18.1 | Distributed execution — remote workers via Redis queue | [ ] |
| 18.2 | Scheduled runs — cron-triggered via platform UI | [ ] |
| 18.3 | Multi-tenant — team isolation, API keys, usage tracking | [ ] |

---

## Totals

| Phase | Epics | Stories | Status | Target outcome |
|---|---|---|---|---|
| Sprint 1 — Foundation | 6 | 20 | ✅ DONE | Bulletproof platform + test case import |
| Sprint 2 — Orchestrator | 1 | 5 | ✅ DONE | One-command full pipeline |
| Phase 2 — Intelligence | 2 | 9 | ✅ DONE | Self-healing, memory |
| Phase 3 — Coverage | 3 | 13 | ✅ DONE | Full-stack testing in one YAML |
| Pre-Phase 4 Hardening | — | 8 | ✅ DONE | Concurrency safety + production hardening |
| Phase 4 — Product Surface | 4 | 30 | ✅ DONE | API layer + Chrome Extension + Portal |
| Phase 4 — Enterprise | 4 | 20 | ✅ DONE | Jira full ✅, reports ✅, CI impact filter ✅, CLI polish ✅ |
| Phase 4 — Knowledge Layer P1 | 1 | 23 | ✅ DONE | RAG Phase 1 — Jira, embeddings, FlowMapper wiring |
| Phase 4 — Knowledge Layer P2 | 1 | 11 | ✅ DONE | RAG Phase 2 — hybrid reranker, all connectors, healer+judge wiring |
| Phase 4 — Knowledge Layer P3 | 1 | 4 | ✅ DONE | RAG Phase 3 — explainability, defect masking fix, budget, graph |
| Phase 5 — GenAI | 1 | 5 | ✅ DONE | Test AI systems natively — llm_eval, llm_consistency, rag_assert, baseline regression |
| Strategic — DEX | 1 | 12 | ▶ ACTIVE | Language barrier elimination: README ✅, Docker, Shell, Python wrapper, GitHub Action, Maven/Gradle, REST clients |
| Strategic — OSS | 1 | 5 | ⬜ | Community, changelog, open-core model |
| Strategic — LOCAL | 1 | 4 | ▶ ACTIVE | Privacy mode, Ollama doctor, local-only config |
| Strategic — MON | 1 | 3 | ⬜ | Synthetic monitoring, alerts |
| Phase 6 — Vision | 2 | 8 | ⬜ | Selector-free, desktop automation |
| Phase 7 — Scale | 3 | 7 | ⬜ | SaaS product |
| **Total** | **31+** | **175+** | | |

**Active:** Strategic DEX (language barrier elimination) + LOCAL (privacy mode).
**Next session:** DEX-03 Docker image → DEX-07 Shell script → DEX-06 Python wrapper.
