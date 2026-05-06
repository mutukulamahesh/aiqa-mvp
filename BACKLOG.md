# AIQA — Production Readiness Backlog

> Current alignment with vision: **~55%**  *(updated 2026-05-06)*
> Sprint 1 + Sprint 2 + Phase 2 Healer: **DONE**.
> Remaining: Phase 2 Memory Layer → Phase 3 Coverage → Phase 4 Enterprise → Phase 5-7.

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
> Fully built as `SelectorHealer` + `HealerCache` with multi-selector ranking, LLM healing, confidence calibration, score decay, event sampling, cold/warm reporting. 45 tests. 2026-05-06.

| ID | Story | Status |
|---|---|---|
| 5.1 | `HealerAgent` — when locator fails, pass DOM + screenshot to Claude for repair | [x] |
| 5.2 | Healer history store — persist repairs in `.aiqa/healer-cache.json`, indexed by URL+descriptor | [x] |
| 5.3 | Cached fix — on next run, try stored fix first; multi-selector ranked by score (confidence×10 + successCount×2×decay − failureCount×3 + recencyBoost) | [x] |
| 5.4 | Integrate into `PlaywrightAdapter` — transparent healing on click/fill, retry after heal | [x] |
| 5.5 | Healer report — `getReport()` on `TestRunner`; shows Cold/Warm/Mixed run type, cache hits, LLM calls, healed locators | [x] ⚠️ CLI `run-all` not yet wired to print report |

### EPIC-06 · Memory Layer `[▶ NEXT]`

### EPIC-06 · Memory Layer
| ID | Story | Status |
|---|---|---|
| 6.1 | `MemoryStore` — JSON file per test suite, tracks flakiness score per step across runs | [ ] |
| 6.2 | Flakiness score — increment on fail, decay on pass; flag tests above 0.4 threshold | [ ] |
| 6.3 | Known failure patterns — store root cause + fix suggestion from DebuggerAgent, skip LLM on repeat | [ ] |
| 6.4 | Memory-aware retry — flaky tests get longer wait before retry, uses flakiness score | [ ] |

---

## Phase 3 — Coverage Expansion `[FULL STACK]`
> One YAML to test the whole application

### EPIC-07 · DB Testing Handler
| ID | Story | Status |
|---|---|---|
| 7.1 | `DBHandler` — execute SQL/NoSQL queries as a DSL step (`db: { query: "SELECT..." }`) | [ ] |
| 7.2 | `DBAdapter` interface + PostgreSQL implementation via Knex.js — mirrors PlaywrightAdapter pattern | [ ] |
| 7.3 | Assert on query result — row count, field values, schema shape | [ ] |
| 7.4 | Chained API → DB verification — call API, then assert DB state changed in same test | [ ] |

### EPIC-08 · Flow Control Handlers
| ID | Story | Status |
|---|---|---|
| 8.1 | `WaitHandler` — `wait_for_element`, `wait_ms`, `wait_for_url` steps | [ ] |
| 8.2 | `ConditionHandler` — `if: { variable: x, equals: y }` branching in test flows | [ ] |
| 8.3 | `LoopHandler` — `for_each` over API response array for data-driven steps | [ ] |
| 8.4 | `StoreHandler` — capture page text/attribute into variable (`store: { selector: ..., as: token }`) | [ ] |

### EPIC-09 · LLM Judge Agent
| ID | Story | Status |
|---|---|---|
| 9.1 | `JudgeAgent` — evaluate LLM API responses, score 0–1 per dimension | [ ] |
| 9.2 | `LLMEvalHandler` — DSL step `llm_eval: { prompt: ..., response: ..., criteria: ... }` | [ ] |
| 9.3 | Hallucination detection — flag responses contradicting known facts using RAG context | [ ] |
| 9.4 | Score dimensions: semantic accuracy, tone, completeness, factual accuracy (weighted overall) | [ ] |
| 9.5 | Configurable pass threshold per test — `pass_if_score_above: 0.8` | [ ] |

---

## Phase 4 — Enterprise Integration `[BUSINESS VALUE]`
> Connect QA to the rest of the organisation

### EPIC-10 · Jira Full Integration
| ID | Story | Status |
|---|---|---|
| 10.1 | Full `JiraClient` — read stories, fetch acceptance criteria (skeleton exists in `src/integrations/JiraAdapter.ts`) | [ ] |
| 10.2 | `aiqa jira-sync --project QA --sprint 42` — auto-generate YAML tests from Jira stories | [ ] |
| 10.3 | Auto-create defect on test failure — attach screenshot, logs, step trace | [ ] |
| 10.4 | Xray result sync — push pass/fail outcomes to Jira test execution record | [ ] |

### EPIC-11 · Reporting & Notifications
| ID | Story | Status |
|---|---|---|
| 11.1 | Allure reporter integration alongside existing HTML reporter | [ ] |
| 11.2 | Slack webhook — post run summary on complete or on failure, configurable channel | [ ] |
| 11.3 | Email notification — send HTML report on suite complete via nodemailer + SMTP | [ ] |
| 11.4 | Trend dashboard — pass rate over time, flakiness trends appended to `results/history.json` | [ ] |

### EPIC-12 · Impact Filter
| ID | Story | Status |
|---|---|---|
| 12.1 | Git diff parser — identify changed files per PR (`git diff --name-only origin/main`) | [ ] |
| 12.2 | File → test mapping — which YAML tests cover which app areas (tag-based or path-based) | [ ] |
| 12.3 | `aiqa run-all --impact-only` — skip unaffected tests in CI (target: 40%+ CI time reduction) | [ ] |

---

## Phase 5 — GenAI Testing `[UNIQUE CAPABILITY]`
> Test AI systems the same way we test web apps

### EPIC-13 · AI Application Testing
| ID | Story | Status |
|---|---|---|
| 13.1 | `LLMEvalHandler` — call any LLM API and assert response quality via DSL | [ ] |
| 13.2 | Prompt regression testing — detect output drift between model versions, store baseline | [ ] |
| 13.3 | Agentic workflow testing — multi-step agent decision path validation, assert intermediate states | [ ] |
| 13.4 | Consistency testing — same prompt N times, assert variance below threshold | [ ] |
| 13.5 | RAG validation — assert retrieved context is relevant to query via vector similarity | [ ] |

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

| Phase | Epics | Stories | Target outcome |
|---|---|---|---|
| Sprint 1 — Foundation | 6 | 20 | Bulletproof platform + test case import |
| Sprint 2 — Orchestrator | 1 | 5 | One-command full pipeline |
| Phase 2 — Intelligence | 2 | 9 | Self-healing, memory |
| Phase 3 — Coverage | 3 | 14 | Full-stack testing in one YAML |
| Phase 4 — Enterprise | 3 | 11 | Jira, Allure, CI impact filter |
| Phase 5 — GenAI | 1 | 5 | Test AI systems natively |
| Phase 6 — Vision | 2 | 8 | Selector-free, desktop automation |
| Phase 7 — Scale | 3 | 7 | SaaS product |
| **Total** | **21** | **79** | |

> **Sprint 1 + 2 + Phase 2–4 = production-ready enterprise platform (~49 stories)**
