# AIQA — Progress Report

> Branch: `main` · Started: 2026-05-01 · Last updated: 2026-05-18
> Platform alignment: **~93%** of vision  ·  Sprint 1 + Sprint 2 + Phase 2 + Phase 3 + Pre-Phase 4 hardening + Phase 4 Product Surface + EPIC-12 + EPIC-3 + EPIC-5: **DONE**

---

## Sprint 1 Goal

> "Make the engine production-safe, then make it feel like a product."

Two sprints scoped:
- **Sprint 1** — Foundation Hardening (EPICs 01–06)
- **Sprint 2** — OrchestratorAgent (EPIC-05)

---

## EPIC-01 — Config & Environment System ✅ DONE

### What was built

| File | Purpose |
|---|---|
| `config/environments/dev.yaml` | Local dev profile — localhost URLs, headless off, 1 worker |
| `config/environments/staging.yaml` | CI/staging — remote URLs, headless on, 4 workers, longer timeouts |
| `config/environments/prod.yaml` | Production — prod URLs, headless on, 4 workers, max timeouts |
| `src/config/ConfigLoader.ts` | Zod-validated loader — fails fast on bad config, secrets check |

### Key behaviour

- `aiqa --env staging run-all` — profile selected at CLI entry, injected before any command runs
- All commands show `[env: staging]` in their header — no ambiguity about which config is active
- `checkSecrets()` runs on every command — warns immediately if `ANTHROPIC_API_KEY` is missing
- `ExecutionContext` exposes `{{ env.base }}` and `{{ env.api }}` as resolvable template variables in YAML tests

### Definition of Done — verified

| Gate | Result |
|---|---|
| Zero hardcoded URLs anywhere in `src/` | ✅ Full audit — all replaced with `cfg()` calls |
| Zero hardcoded timeouts anywhere in `src/` | ✅ All flow through `config.timeouts.action / navigation / api` |
| `aiqa --env staging` injects correct profile | ✅ Confirmed — `[env: staging]` in output header |
| Zod validation catches bad config at startup | ✅ Throws with field-level error messages before any test runs |
| `.env` secrets loaded and warned if missing | ✅ `⚠️  Missing secret: ANTHROPIC_API_KEY` displayed correctly |

### Files changed
- `config/environments/dev.yaml` — new
- `config/environments/staging.yaml` — new
- `config/environments/prod.yaml` — new
- `src/config/ConfigLoader.ts` — new (112 lines)
- `src/execution/ExecutionContext.ts` — updated: accepts `EnvConfig`, exposes `env.*` variables
- `src/cli.ts` — updated: global `--env` flag, `preAction` hook, `cfg()` wired into all commands

---

## EPIC-02 — Parallel Execution & Isolation ✅ DONE

### What was built

| File | Purpose |
|---|---|
| `src/execution/WorkerContext.ts` | `AsyncLocalStorage` store per test — buffers all output, flushes atomically |
| `src/runner/TestRunner.ts` | Refactored: `run()` wraps `_run()` in `workerStorage.run()`, flushes after |
| `src/handlers/UIActionHandler.ts` | `console.log` → `wwrite()` — output routed through worker buffer |
| `src/handlers/AssertionHandler.ts` | `console.log` → `wwrite()` |
| `src/handlers/APIActionHandler.ts` | `console.log` → `wwrite()` |
| `scripts/stress-test.sh` | DoD gate — runs N copies of same test with M workers |

### Key behaviour

- Every test run is wrapped in `AsyncLocalStorage` with a unique `testId`
- All `console.log` / `process.stdout.write` calls inside handlers route to a per-worker log buffer
- When a test completes, its entire output block is flushed atomically to stdout — zero interleaving possible
- Screenshot filenames include `testId` — `{safeName}-{testId}-step-N-fail.png` — guaranteed unique across parallel workers
- `TestResult` now carries `testId` field for traceability in reports

### Bug fixed during EPIC-02

| Bug | Root cause | Fix |
|---|---|---|
| Screenshot collision in parallel runs | Filename was `{safeName}-step-N-fail.png` — same for all workers on same-named test | Added `testId` to filename |
| `flushWorker()` called outside ALS context | `AsyncLocalStorage.getStore()` returns `undefined` after `workerStorage.run()` exits | Flush directly from `store` reference instead |

---

## EPIC-02 — Verification Results

### DoD Gate — Stress Test (10 runs, 4 workers)

```
bash scripts/stress-test.sh 4 10 tests/example.yaml
```

| Metric | Result |
|---|---|
| Tests run | 10 |
| Passed | 10 |
| Failed | 0 |
| Interleaved log lines | 0 |
| Mixed step output | 0 |
| Chromium processes after | 0 |

**Verdict: DoD PASSED** ✅

---

### Gold Standard Check 1 — 50% Pass / 50% Fail (4 workers)

```
10 tests: 5 pass + 5 fail · --workers 4 · --headless
```

| Metric | Expected | Actual |
|---|---|---|
| Tests passed | 5 | 5 ✅ |
| Tests failed | 5 | 5 ✅ |
| Screenshots created | 5 (failures only) | 5 ✅ |
| Screenshots for passing tests | 0 | 0 ✅ |
| Log blocks clean (no mixing) | Yes | Yes ✅ |
| Screenshot filenames unique | Yes | Yes ✅ |

Sample screenshot names produced:
```
fail_bad_assert-1777674193708-bbkwfd-step-2-fail.png
fail_bad_assert-1777674193754-tjrvn0-step-2-fail.png
fail_bad_assert-1777674193756-omx1va-step-2-fail.png
fail_bad_assert-1777674193757-s82s65-step-2-fail.png
fail_bad_assert-1777674204691-d4ulmh-step-2-fail.png
```

---

### Gold Standard Check 2 — High Worker Count (8 workers, 12 tests)

```
12 tests · --workers 8 · --headless
```

| Metric | Result |
|---|---|
| Tests run | 12 |
| Passed | 12 |
| Failed | 0 |
| Total duration | **9,405 ms** |
| Chromium processes after | 0 |
| Race conditions observed | None |
| Performance degradation | None |

**Throughput:** 12 browser sessions launched, run, and closed cleanly in ~9.4s at 8-way parallelism.

---

### Gold Standard Check 3 — Long-Running Test + Short Tests (4 workers)

```
1 long test (10 steps, 3 domains) + 6 short tests (2 steps each) · --workers 4
```

| Metric | Result |
|---|---|
| Tests run | 7 |
| Passed | 7 |
| Total duration | **6,487 ms** |
| Worker starvation | None — short tests completed while long test ran |
| Timeout misbehavior | None |
| Output order | Short tests flushed first, long test flushed last (correct) |
| Chromium processes after | 0 |

**Key observation:** Long test ran on its own worker concurrently with 6 short tests. No blocking, no starvation. The atomic flush meant the long test's complete 10-step block appeared after the short tests — exactly correct behaviour.

---

## EPIC-02 — Full Isolation Audit

| Concern | Verified by | Status |
|---|---|---|
| Screenshot uniqueness | Gold standard check 1 — 5 unique filenames for 5 parallel failures | ✅ |
| Browser context per test | Code audit — `new PlaywrightAdapter()` per `_run()` call → own `browser.newContext()` + `newPage()` | ✅ |
| Resource cleanup | Live check — `pgrep chromium` = 0 after every run | ✅ |
| Log grouping | All three gold standard checks — zero interleaved lines observed | ✅ |
| Unique test IDs | Visible in every test block header and every screenshot filename | ✅ |
| Shared mutable state | Code audit — `interpreter`, `debugger` are `readonly`, created per `TestRunner` instance which is created per test | ✅ |

---

## Platform Metrics — End of Sprint 1 (EPICs 01–02)

| Metric | Before Sprint | After EPIC-01 | After EPIC-02 |
|---|---|---|---|
| Source files | 22 | 23 | 25 |
| Total lines of code | ~1,900 | ~2,050 | ~2,456 |
| Hardcoded URLs in `src/` | Several | **0** | **0** |
| Hardcoded timeouts in `src/` | Several | **0** | **0** |
| Parallel workers tested | 4 | 4 | **8** |
| Log interleaving risk | High | High | **Zero** |
| Screenshot collision risk | Present | Present | **Eliminated** |
| Resource leaks confirmed | Unknown | Unknown | **None** |
| Env profiles | 0 | **3** | 3 |
| Config validation | None | **Zod (fail-fast)** | Zod (fail-fast) |
| Test IDs for traceability | No | No | **Yes** |

---

## EPIC-03 — Retry & Circuit Breaker ✅ DONE

### What was built

| File | Purpose |
|---|---|
| `src/dsl/types.ts` | `retries?: number` added to `TestDefinition` |
| `src/dsl/DslParser.ts` | Parses `retries:` from YAML with floor/max(0) guard |
| `src/config/ConfigLoader.ts` | `circuitBreaker: number` added to execution schema |
| `config/environments/*.yaml` | All three profiles updated with `circuitBreaker: 5` |
| `src/runner/TestRunner.ts` | Full rewrite: `isRetryable()`, `_runWithRetry()`, `_attempt()`, `retryCount` in result |
| `src/cli.ts` | `--circuit-breaker <n>` flag, slot runner with `consecutiveFails`/`circuitOpen`/`skippedByCircuit` |

### Key behaviour

- Each test carries `retries?: number` — parsed from YAML, default 0
- `isRetryable()` classifies failures: transient (timeout, net::ERR_*, locator) vs deterministic (assertXxx:, HTTP status)
- Deterministic failures return immediately — never retry
- Transient failures loop up to `retries` times, logging `↺ retry N/M — <error class> on step N`
- Each retry spawns a fresh browser context (via `_attempt()`) — clean slate
- Screenshot filenames include `-attemptN` suffix on retries for traceability
- Circuit breaker: shared `consecutiveFails` counter increments on failure, resets to 0 on any pass
- When `consecutiveFails >= cbThreshold`: prints `⚡ Circuit breaker open`, skips all remaining tests
- Summary line shows `Retried: N` and `(N skipped by circuit breaker)` when non-zero

### Definition of Done — verified (live tests, 2026-05-04)

| Gate | Test | Result |
|---|---|---|
| Transient failures retry up to N times | `retry_test.yaml` (retries: 2) hitting port 9999 → `net::ERR_CONNECTION_REFUSED` | ✅ `↺ retry 1/2` and `↺ retry 2/2` logged, 3 total attempts |
| Assertion failures do NOT retry | `assert_noretry.yaml` (retries: 2) with impossible `assertTextVisible` | ✅ Zero `↺ retry` lines — returned immediately after first failure |
| Circuit breaker stops suite at N consecutive failures | 7 failing tests, `--circuit-breaker 3`, `--workers 1` | ✅ `⚡ Circuit breaker open — 3 consecutive failures`, `4 skipped by circuit breaker` in summary |
| Env config `circuitBreaker` field used as default | No `--circuit-breaker` flag — reads from YAML profile | ✅ All three profiles carry `circuitBreaker: 5` |
| `retries` parsed cleanly from YAML | Test file with `retries: 2` | ✅ Header shows `Retry: up to 2x on transient failures` |

### Files changed
- `src/dsl/types.ts` — `retries?` field added
- `src/dsl/DslParser.ts` — parses `retries` with safety guard
- `src/config/ConfigLoader.ts` — `circuitBreaker` in execution schema
- `config/environments/dev.yaml` — `circuitBreaker: 5`
- `config/environments/staging.yaml` — `circuitBreaker: 5`
- `config/environments/prod.yaml` — `circuitBreaker: 5`
- `src/runner/TestRunner.ts` — full rewrite (~220 lines)
- `src/cli.ts` — circuit breaker option + slot runner + summary

---

## Platform Metrics — End of Sprint 1 (EPICs 01–03)

| Metric | After EPIC-02 | After EPIC-03 |
|---|---|---|
| Source files | 25 | 25 (no new files — augmented existing) |
| Retry capability | ❌ None | ✅ Per-test configurable |
| Circuit breaker | ❌ None | ✅ Configurable threshold |
| Error classification | ❌ None | ✅ Transient vs deterministic |
| Suite resilience | Runs all tests regardless of cascading failures | Stops automatically after N consecutive failures |
| Config coverage | Env URLs + timeouts + execution | + `circuitBreaker` threshold |

---

## EPIC-04 — CI/CD Pipeline ✅ DONE

### What was built

| File | Purpose |
|---|---|
| `.github/workflows/aiqa.yml` | GitHub Actions — runs full suite on push/PR, smoke gate on PR |
| `Jenkinsfile` | Declarative Jenkins pipeline with env matrix, artifact publish |
| `package.json` `test:ci` script | One-liner CI entry point for local and pipeline use |

### Key behaviour

- **GitHub Actions** triggers on push to `main`/`phase1` and all PRs to `main`
- Environment matrix supports `staging` (and `prod` when uncommented)
- Uploads HTML report, JSON results, and failure screenshots as run artifacts (30-day retention)
- **Smoke gate job** runs tag-filtered subset (`--tags smoke`) on every PR after the full suite passes
- `concurrency` block cancels in-flight runs on new pushes to the same ref — no queue pile-up
- **Jenkins** pipeline is parameterised: `ENVIRONMENT`, `WORKERS`, `CIRCUIT_BREAKER`, `TAGS`
- `publishHTML` renders the AIQA HTML report directly in the Jenkins UI
- `cleanWs` purges `node_modules` only on aborted builds — preserves artifacts on pass/fail
- `ANTHROPIC_API_KEY` injected via `credentials('anthropic-api-key')` — never echoed in logs
- Both pipelines exit non-zero on any test failure (wired through `process.exit(failed > 0 ? 1 : 0)`)

### Definition of Done — verified

| Gate | Result |
|---|---|
| Non-zero exit on test failure propagates to CI | ✅ `process.exit(failed > 0 ? 1 : 0)` already wired in CLI |
| HTML report uploaded as artifact | ✅ `upload-artifact` + `publishHTML` steps |
| Screenshots uploaded on failure | ✅ GitHub `if: failure()` block; Jenkins always-archive |
| Secret never hardcoded | ✅ GitHub `secrets.ANTHROPIC_API_KEY`; Jenkins `credentials()` binding |
| Smoke gate runs tag filter on PR | ✅ Separate `smoke` job with `--tags smoke --workers 2` |
| Jenkins pipeline parameterised | ✅ `ENVIRONMENT`, `WORKERS`, `CIRCUIT_BREAKER`, `TAGS` params |
| npm `test:ci` script available | ✅ Runs staging suite headless, workers=4, out=results |

---

## Pending — Sprint 1 Remaining

| EPIC | Title | Status |
|---|---|---|
| EPIC-04 | CI/CD Pipeline (GitHub Actions + Jenkins) | ✅ DONE |
| EPIC-06 | Test Case Importer (Excel/CSV/Gherkin) | ✅ DONE |

---

## EPIC-06 — Test Case Importer ✅ DONE

### What was built

| File | Purpose |
|---|---|
| `src/importers/types.ts` | `RawTestCase`, `ColumnMap`, `ImportResult` interfaces |
| `src/importers/ExcelImporter.ts` | Reads `.xlsx`/`.xls` via `exceljs`, auto-detects column headers |
| `src/importers/CSVImporter.ts` | Parses `.csv` with RFC-4180 quoted-field support, no extra deps |
| `src/importers/TextImporter.ts` | Parses Gherkin `.feature` (Given/When/Then) + plain text blocks |
| `src/importers/TestCaseTranslator.ts` | Maps natural-language steps → AIQA DSL YAML; LLM when key present, heuristic fallback always available |
| `src/importers/ImportOrchestrator.ts` | Routes by file extension, writes YAML files, returns `ImportResult[]` |
| `src/cli.ts` | `aiqa import` command: `--file`, `--sheet`, `--out`, `--tags`, `--run` |
| `src/dsl/DslParser.ts` | Added `parseTestDefinition(yaml)` for string-based validation |

### Key behaviour

- `aiqa import --file test-cases.xlsx --out tests/` — generates one YAML per row, flags vague steps
- `aiqa import --file login.feature --run` — import + execute in one command with HTML report
- `--sheet "Sprint 5"` — targets a specific Excel sheet
- `--tags smoke,regression` — injects tags into every generated YAML
- Gherkin `Background:` steps are prepended to every `Scenario`
- Vague/unmappable steps emit `# WARNING: could not map step — "..."` in YAML (visible, not silent)
- Blank values get `# TODO: replace with real test data` comment
- Every generated YAML is validated through `DslParser` before writing — invalid output is flagged, not silently written
- Heuristic translator strips Gherkin "I " subject prefix automatically

### Definition of Done — verified

| Gate | Result |
|---|---|
| `.feature` import: 2 scenarios, 0 warnings, both validated | ✅ Live test passed |
| `.csv` import: 2 test cases, 0 warnings, both validated | ✅ Live test passed |
| Vague steps flagged with WARNING comment | ✅ Confirmed in output |
| DslParser rejects invalid generated YAML | ✅ `validated: false` surfaced in summary |
| `--run` executes generated tests + HTML report | ✅ Wired via TestRunner + HTMLReporter |
| `exceljs` added to dependencies | ✅ `package.json` updated |
| TypeScript: zero type errors | ✅ `tsc --noEmit` clean |

---

## Sprint 2

| EPIC | Title | Status |
|---|---|---|
| EPIC-05 | OrchestratorAgent | ⬜ Parked until Sprint 1 done |

---

---

## Healer Safety Fixes — Pre-EPIC-06 ✅ DONE

Three targeted safety fixes applied before the Memory Layer epic to harden the healer under real-world conditions.

### Fix 1 — Visibility + Interactability Guard

After a selector passes semantic scoring and role validation, AIQA now verifies the element is actually visible and enabled on the page before returning it. Hidden or disabled elements are rejected and the event log records a `rejected` event.

| File | Change |
|---|---|
| `src/healer/SelectorHealer.ts` | `validateVisible()` — calls `locator.isVisible()` + `locator.isEnabled()` in parallel; both must pass |

### Fix 2 — Safe Context Fallback Ordering

When `contextFilter()` has no entries matching the current SPA context key, the fallback set is now sorted deterministically by confidence desc → lastUsed desc instead of returning raw unordered data.

| File | Change |
|---|---|
| `src/healer/HealerCache.ts` | `contextFilter()` fallback path returns `[...entries].sort(...)` |

### Fix 3 — Selector Lifecycle State

Cache entries now carry `status: "provisional" | "validated"`. A freshly healed selector starts as `provisional`. After 3 confirmed successes it is promoted to `validated` and receives a +5 score bonus during future lookups. Old cache files without the field are migrated transparently.

| File | Change |
|---|---|
| `src/healer/HealerCache.ts` | `status` field on `CacheEntry`; `markSuccess()` promotes at ≥3; `scoreEntry()` applies bonus; `migrate()` defaults old entries to `provisional` |

### Tests — 70/70 passing after safety fixes

New describe blocks added to `tests/healer/healer.test.ts`:
- `SelectorHealer — visibility + interactability` (3 tests)
- `HealerCache — context fallback ordering` (1 test)
- `HealerCache — lifecycle state` (4 tests)

---

## Multi-LLM Provider Support ✅ DONE

AIQA previously hardcoded Anthropic. This work makes the LLM layer pluggable — users configure their own provider via `.env` and the YAML environment profile. Zero code changes required to switch.

### What was built

| File | Purpose |
|---|---|
| `src/llm/OpenAILLMProvider.ts` | Handles OpenAI and NVIDIA (OpenAI-compatible API) via native `fetch` — zero extra npm deps |
| `src/llm/GeminiLLMProvider.ts` | Handles Google Gemini via native `fetch` — uses `system_instruction` + `contents` wire format |
| `src/llm/FallbackLLMProvider.ts` | Chains providers in order; retries on transient errors; warns on degradation; fails fast on auth/bad-request errors |
| `src/llm/LLMProvider.ts` | Rewritten — `ProviderName`, `LLMConfig`, `createLLMProvider()` factory with env auto-detection |
| `src/llm/AnthropicLLMProvider.ts` | Added optional `model` param; includes `raw` in response |
| `src/config/ConfigLoader.ts` | `llm` section added to Zod schema; `checkSecrets()` updated per active provider |
| `config/environments/dev.yaml` | `llm.provider: mock` |
| `config/environments/staging.yaml` | `llm.provider: anthropic, fallback: [mock]` |
| `config/environments/prod.yaml` | `llm.provider: anthropic, fallback: [mock]` |

### Provider selection — resolution order

```
1. Explicit LLMConfig argument (passed from YAML config at CLI startup)
2. LLM_PROVIDER env var  +  optional LLM_FALLBACK (comma-separated names)
3. Auto-detect: ANTHROPIC_API_KEY → OPENAI_API_KEY → NVIDIA_API_KEY → GEMINI_API_KEY
4. MockLLMProvider  (no keys, no explicit config)
```

### Supported providers

| Provider | Env var | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Claude — requires `@anthropic-ai/sdk` |
| `openai` | `OPENAI_API_KEY` | GPT-4o-mini default |
| `nvidia` | `NVIDIA_API_KEY` | OpenAI-compatible endpoint — `meta/llama-3.1-8b-instruct` default |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` default |
| `mock` | — | Rule-based, always available |

### 5 Safety Properties

| Risk | Fix |
|---|---|
| Response shape leaks | All providers return normalized `{ content, model, raw? }` — callers never see provider wire format |
| Prompt format drift | `LLMRequest.{system, userMessage}` is the single canonical format; each provider translates internally |
| Blind fallback on auth errors | `isRetryableError()` — HTTP 4xx (except 429) and `not installed` are non-retryable; fail immediately without masking |
| Silent degradation | `console.warn("[LLM] Degraded — primary failed, using fallback: <name>")` when chain advances |
| Cost/latency awareness | Documented as future work — model-per-task selection (healer vs generator vs judge) is out of scope now |

### Tests — 183/183 passing after multi-LLM work

`tests/llm/providers.test.ts` — 32 tests across 4 describe blocks:
- `FallbackLLMProvider` (10): name, first-succeeds, fallthrough on retryable, all-fail aggregate, empty chain, 429/500 retryable, 401/400 non-retryable, degradation warning
- `OpenAILLMProvider` (7): name detection (openai/nvidia), request format, content + raw field, HTTP error, empty choices, NVIDIA endpoint
- `GeminiLLMProvider` (6): name, request format, content + raw field, HTTP error, empty candidates, custom model
- `createLLMProvider` (9): mock default, auto-detect all 4 providers, env override, fallback chain, explicit config precedence

---

---

## EPIC-06 — Memory Layer ✅ DONE

Cross-run QA memory: flakiness scoring per step + cached DebuggerAgent diagnoses that skip the LLM on repeat failures.

### What was built

| File | Purpose |
|---|---|
| `src/memory/types.ts` | `KnownPattern`, `StepMemory`, `MemoryData` — shared data contracts |
| `src/memory/MemoryStore.ts` | Core store: flakiness scoring, pattern cache, persistence, eviction |
| `src/agents/DebuggerAgent.ts` | Checks `getKnownPattern()` before LLM call; stores result after |
| `src/agents/types.ts` | `from_memory?: boolean` added to `DebugResult` |
| `src/runner/TestRunner.ts` | Tracks outcomes per step; applies extra wait on flaky steps; passes `memCtx` to debugger |
| `src/cli.ts` | Creates `MemoryStore` at suite start; prints memory report after run |

### Key behaviour

**Flakiness scoring**
- On fail: `score += 0.2 × (1 − score)` — asymptotically approaches 1.0
- On pass: `score ×= 0.8` — exponential decay
- Score ≥ 0.4 → step is flagged as flaky

**Memory-aware retry wait** (proportional to score)
| Score range | Extra wait before retry |
|---|---|
| ≥ 0.8 | 3 000 ms |
| ≥ 0.6 | 2 000 ms |
| ≥ 0.4 | 1 000 ms |
| < 0.4 | 0 ms |

**Known-pattern cache**
- First LLM diagnosis per step key is stored; reuse skips the LLM entirely
- `llmCallsSaved` counter surfaced in memory report
- `[memory]` badge in runner output when cached diagnosis is returned
- First-seen wins; subsequent `storePattern` calls for the same key are no-ops

**Diagnosis trust / auto-invalidation**
- `failuresSinceDiagnosis` counter increments on each failure while a cached pattern exists
- Resets to 0 on pass (pattern was actionable)
- At `DIAGNOSIS_INVALIDATION_THRESHOLD` (5) consecutive failures the pattern is evicted → next failure triggers a fresh LLM call

**Growth cap**
- Store evicts the oldest entry (by `lastUpdated`) when `MAX_STEP_ENTRIES` (500) is reached
- Constructor accepts `maxEntries` override for tests

**Persistence**
- `results/memory.json` per project — loaded at suite start, saved after each test failure + at suite end
- `MemoryStore(undefined)` → in-memory only; `save()` is a no-op (used in tests)

### Constants (exported)

| Constant | Value | Meaning |
|---|---|---|
| `FLAKINESS_THRESHOLD` | 0.4 | Minimum score to be reported as flaky |
| `DIAGNOSIS_INVALIDATION_THRESHOLD` | 5 | Consecutive fails before a cached diagnosis is evicted |
| `MAX_STEP_ENTRIES` | 500 | Hard cap on tracked steps; oldest evicted beyond this |

### Definition of Done — verified

| Gate | Result |
|---|---|
| Score formula: 0 → 3 fails → ≥ 0.4 | ✅ `0 → 0.2 → 0.36 → 0.49` |
| Score caps at 1.0 after many fails | ✅ 50-fail loop stays ≤ 1.0 |
| Pass after fail decays score by 20% | ✅ `before × 0.8` confirmed |
| `extraWaitMs` returns correct tier | ✅ 1000/2000/3000ms for score bands |
| Known pattern returned on second failure | ✅ `getKnownPattern()` returns cached result; `hitCount` increments |
| Pattern evicted after 5 consecutive fails | ✅ Diagnosis invalidation test passing |
| Store never exceeds maxEntries cap | ✅ Growth cap test passing |
| Persistence round-trip | ✅ Save → load restores scores + patterns |

### Tests — 34 tests in `tests/memory/memory.test.ts`

- `makeStepKey` (2)
- `MemoryStore — flakiness scoring` (6)
- `MemoryStore — extraWaitMs` (4)
- `MemoryStore — getFlakySteps` (3)
- `MemoryStore — known patterns` (4)
- `MemoryStore — getReport` (4)
- `MemoryStore — persistence` (5)
- `MemoryStore — diagnosis invalidation` (3)
- `MemoryStore — growth cap` (2)

---

## Platform Metrics — After EPIC-06

| Metric | After Multi-LLM | After EPIC-06 |
|---|---|---|
| Test suites | 8 | **9** |
| Tests passing | 183 | **217** |
| Cross-run memory | ❌ None | ✅ Per-step flakiness scores |
| Repeat LLM calls on known failures | ❌ Every failure | ✅ Cached; `llmCallsSaved` tracked |
| Flaky step visibility | ❌ None | ✅ Scored + reported after suite |
| Memory file | — | `results/memory.json` |
| Diagnosis trust | — | Auto-evicted after 5 consecutive failures |
| Memory growth | — | Hard-capped at 500 entries |

---

## EPIC-05 — Healer Elite Refinements ✅ DONE

Three targeted improvements that harden the healer under real-world SPA conditions.

### What was built

| File | Purpose |
|---|---|
| `src/healer/contextKey.ts` | `buildContextKey(page)` — SHA-256 hash of page title + visible headings; stable SPA context fingerprint |
| `src/healer/HealerCache.ts` | `contextKey?` field on `CacheEntry`; `getValidated()` enforces context match; `contextFilter()` fallback ordering |
| `src/healer/SelectorHealer.ts` | Semantic scoring, role validation, `validateVisible()` guard, log-level control |
| `src/agents/FlowMapper.ts` | Reads validated selectors from `HealerCache` and seeds them into generated steps (`getSeedCount()`) |
| `src/agents/OrchestratorAgent.ts` | Creates shared `HealerCache` + `HealerAnalytics`, records run after each orchestrate, returns analytics |

### Key behaviour

**SPA Context Key**
- Each cache entry optionally carries a `contextKey` — SHA-256 of page title + h1/h2 text
- `get()` / `getAll()` prefer entries whose `contextKey` matches; entries without a key always pass (backward compat)
- `getValidated()` is strict — never returns a selector stored under a different SPA state (safe for code generation)
- Fallback path (no matching entries): sorted by confidence desc → lastUsed desc, never random

**Semantic Scoring + Visibility Guard**
- After selector match, `validateVisible()` calls `locator.isVisible()` + `locator.isEnabled()` in parallel
- Hidden or disabled candidates are rejected and logged as `rejected` events
- Role validation runs after semantic scoring — ARIA role must match expected element type

**Selector Lifecycle (status field)**
- `provisional` — freshly healed, not yet confirmed
- `validated` — promoted after 3 confirmed successes; earns +5 score bonus on future lookups
- Migration in `migrate()` transparently upgrades old cache files

**FlowMapper seeding**
- Before generating steps, FlowMapper calls `cache.getValidated()` per descriptor
- If a known-good selector exists, it's embedded directly as a CSS target (skips healer strategies 3/4)
- `getSeedCount()` returns the number of steps seeded in the last `map()` call — surfaced in CLI output

### New tests

| Suite | Tests | What's covered |
|---|---|---|
| `tests/healer/contextKey.test.ts` | New | `buildContextKey` determinism, stability, uniqueness |
| `tests/agents/flow-mapper-cache.test.ts` | New | FlowMapper seeding — cold cache, warm cache, seed count |
| `tests/healer/healer.test.ts` | +18 | Visibility guard, context fallback ordering, lifecycle state |

---

## Healer Analytics Layer ✅ DONE

Turns accumulated healer data into a structured analytics report surfaced after every `orchestrate` run.

### What was built

| File | Purpose |
|---|---|
| `src/healer/HealerAnalytics.ts` | `HealerAnalytics` class — 5 metric methods, run log persistence, CLI formatter |
| `tests/healer/healer-analytics.test.ts` | 32 tests across 6 describe blocks |

### Metrics collected

| Metric | Method | How ranked |
|---|---|---|
| Memory reuse trend | `getMemoryReuseTrend(lastN)` | Last N runs in order; each run shows seeded count or "cache cold" |
| Total LLM calls saved | `getTotalLLMCallsSaved()` | Sum of `seededSelectors` across all runs |
| Top unstable pages | `getTopUnstablePages(topN)` | Ranked by failure count desc, then failure rate |
| Most healed selectors | `getMostHealedSelectors(topN)` | Ranked by total heal attempts desc; shows `heals: N  success: X%` |
| Flakiest steps | `getFlakiestSteps(topN)` | Ranked by failure rate desc; requires ≥ 3 uses (noise filter) |

### Persistence

- Run records appended to `.aiqa/healer-runs.json` after every orchestrate run (dry-run or full)
- `recordRun()` writes `{ runId, timestamp, url, seededSelectors, testsPassed, testsFailed }`
- File is created on first write; missing file returns empty list (no crash)

### Analytics polish applied

| Refinement | Change |
|---|---|
| Label clarity | `uses` → `heals:` in Most healed selectors output — aligns with user mental model |
| Noise filter | Flakiest steps now requires `uses ≥ 3` — prevents 1-failure/1-run entries from showing 100% flaky |

### CLI output (after `orchestrate`)

```
━━━ Healer Analytics ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LLM calls saved   : 8  (across 2 runs)

   Memory reuse trend  (last 2 runs)
   ──────────────────────────────────────────────
   Run 1  [app.com/login]  cache cold
   Run 2  [app.com/login]  4 seeded  ·  4 heals avoided

   Most healed selectors
   ──────────────────────────────────────────────
   1. email_input           heals:   5  success: 80%  [/login]

   Top unstable pages
   ──────────────────────────────────────────────
   1. /checkout                              2/5 failed (40%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Output is suppressed entirely on the first cold run (no data yet).

### Tests — `tests/healer/healer-analytics.test.ts`

| Describe block | Tests |
|---|---|
| `HealerAnalytics — run log` | 5 |
| `HealerAnalytics — getTopUnstablePages` | 6 |
| `HealerAnalytics — getMostHealedSelectors` | 5 |
| `HealerAnalytics — getFlakiestSteps` | 4 |
| `HealerAnalytics — getReport` | 2 |
| `HealerAnalytics.format` | 7 |

---

## Platform Metrics — After Healer Analytics

| Metric | After EPIC-06 Memory | After Healer Analytics |
|---|---|---|
| Test suites | 9 | **12** |
| Tests passing | 217 | **283** |
| Healer analytics | ❌ None | ✅ 5 metric collections |
| LLM call savings tracked | ❌ None | ✅ Cumulative across all runs |
| Flaky selector visibility | ❌ None | ✅ Per-page, per-descriptor, per-entry |
| Run history | ❌ None | ✅ `.aiqa/healer-runs.json` |
| CLI analytics output | ❌ None | ✅ After every `orchestrate` run |

---

---

## Phase 3 — Coverage Expansion ✅ DONE

### EPIC-07 — DB Testing Handler ✅ DONE

| File | Purpose |
|---|---|
| `src/db/DBAdapter.ts` | Generic `DBAdapter` interface — `query(sql, params)`, `close()` |
| `src/db/KnexDBAdapter.ts` | PostgreSQL via Knex — configurable pool, exhaustion guard |
| `src/db/MockDBAdapter.ts` | In-memory mock — deterministic fixtures for unit tests |
| `src/db/DBAdapterFactory.ts` | Selects real vs mock based on `DB_URL` env var |
| `src/handlers/DBActionHandler.ts` | `db:` step — execute SQL, assert row count, assert field values, `store_as` |

### Key behaviour

- `db: { query: "...", assert_rows: N }` — asserts exact row count
- `db: { query: "...", assert_field: { status: "completed" } }` — asserts a field in the first row
- `db: { query: "...", store_as: result }` — stores result rows for downstream `{{ result[0].field }}` access
- Parameterised queries via `params: [...]` — safe from SQL injection
- Knex pool: `min=2, max=10, acquireTimeout=30s`; pool exhaustion surfaces as a clear error
- `KnexDBAdapter.close()` is idempotent — safe to call multiple times

### Tests — `tests/db/db.test.ts` (32 tests)

- `DBActionHandler — assert_rows` (4)
- `DBActionHandler — assert_field` (5)
- `DBActionHandler — store_as` (4)
- `DBActionHandler — params` (3)
- `DBActionHandler — error handling` (4)
- `KnexDBAdapter — pool` (4)
- `DBAdapterFactory` (4)
- `MockDBAdapter` (4)

---

### EPIC-08 — Flow Control Handlers ✅ DONE

| File | Purpose |
|---|---|
| `src/handlers/WaitHandler.ts` | `wait_for_element` · `wait_ms` · `wait_for_url` |
| `src/handlers/ConditionHandler.ts` | `if: { variable, equals, steps }` branching |
| `src/handlers/LoopHandler.ts` | `for_each: { over, as, steps }` — max 100 iterations, depth guard |
| `src/handlers/StoreHandler.ts` | `store: { selector, as }` — capture text/attribute into variable |
| `src/execution/DepthGuard.ts` | Recursion depth limiter shared by `if` and `for_each` |

### Key behaviour

- `wait_for_element` accepts a bare selector string or `{ selector, timeout }` object
- `if` branches run the full sub-step list only when the variable equals the expected value
- `for_each` exposes the current item as `{{ item_var }}` with dot-notation access
- Loop hard-cap: `MAX_ITERATIONS = 100` — throws `"exceeded maxIterations"` rather than hanging
- Depth guard prevents `if` inside `if` inside `for_each` from stack-overflowing

### Tests — `tests/flow-control/` (120 tests across 4 suites)

---

### EPIC-09 — LLM Judge ✅ DONE

| File | Purpose |
|---|---|
| `src/handlers/JudgeHandler.ts` | `judge:` step — LLM scoring, determinism cache, `pass_if` evaluation |

### Key behaviour

- `judge: { value, prompt, pass_if, store_as }` — evaluates `value` against natural-language `prompt`
- LLM returns `{ score: 0.0–1.0, reason: "..." }`; `pass_if` expression (`score >= 0.7` etc.) is evaluated locally
- Per-execution determinism cache: `sha256(value + "\x00" + prompt)` → `{ score, reason }` — retries never re-call the LLM
- Score normalised to 3 decimal places before caching — all consumers read one canonical value
- `store_as` stores `{ score, verdict, reason }` — accessible as `{{ result.score }}` etc.
- Input > 5 000 chars is truncated (LLM notified); empty input throws immediately

### Tests — `tests/judge/` (61 tests)

- `JudgeHandler — basic scoring` (8)
- `JudgeHandler — pass_if operators` (12)
- `JudgeHandler — determinism cache` (8)
- `JudgeHandler — store_as` (6)
- `JudgeHandler — input guards` (7)
- `JudgeHandler — LLM error handling` (6)
- `parsePassIf` (8)
- `applyOp` (6)

---

## Platform Metrics — After Phase 3

| Metric | After Healer Analytics | After Phase 3 |
|---|---|---|
| Test suites | 12 | **16** |
| Tests passing | 283 | **444** |
| DB testing | ❌ None | ✅ PostgreSQL via Knex, `assert_rows`, `assert_field` |
| Flow control | Partial | ✅ wait · if · for_each · store (depth guarded) |
| LLM judge | ❌ None | ✅ 0.0–1.0 scoring, deterministic `pass_if`, `store_as` |
| Step types total | 8 | **13** |

---

## Pre-Phase 4 Hardening ✅ DONE

### Pass 1 — Scalability & Concurrency (2026-05-07)

Four defensive fixes to harden parallel execution before Phase 4 enterprise work begins.

| Fix | File | What changed |
|---|---|---|
| `ExecutionContext` memory safety | `src/execution/ExecutionContext.ts` | `storeClamp()` deep-clones via JSON round-trip; trims arrays > 1 000 items; rejects non-serializable values |
| `JudgeHandler` determinism cache | `src/handlers/JudgeHandler.ts` | `sha256(value + prompt)` → `{ score, reason }` map; retry hits cache instead of re-calling LLM |
| Atomic writes | `HealerCache`, `MemoryStore`, `HealerAnalytics` | Write to `<file>.<pid>.tmp` then `fs.renameSync()` — POSIX-atomic, prevents partial reads by concurrent workers |
| Knex pool config + exhaustion guard | `src/db/KnexDBAdapter.ts` | `min=2, max=10, acquireTimeoutMillis=30_000`; timeout + pool regex → clear "pool exhausted" error |

### Pass 2 — Last-Edge Fixes (2026-05-07)

| Fix | File | What changed |
|---|---|---|
| Lost-update (write-skew) protection | `HealerCache`, `MemoryStore`, `HealerAnalytics` | Capture `mtimeMs` at load; re-check before write; if changed, re-read + merge with our changes before saving |
| Judge score normalised before caching | `src/handlers/JudgeHandler.ts` | `Number(parsed.score.toFixed(3))` runs once; cache stores the normalised value; every consumer reads the same number |
| Non-serializable guard | `src/execution/ExecutionContext.ts` | `JSON.stringify` wrapped in try/catch; throws `"non-serializable value stored via store_as"` instead of silent truncation |
| DB pool visibility log | `src/db/KnexDBAdapter.ts` | Logs `[DB] pool config: min=2, max=10, workers=<N>` at init; `N` from `AIQA_WORKERS` env (default `?`) |

### Merge strategies per file store

| Store | Conflict resolution |
|---|---|
| `HealerCache` | Union URLs→descriptors→entries by selector; keep entry with higher `successCount + failureCount` |
| `MemoryStore` | Union step keys; keep step with higher `runCount`; `llmCallsSaved = Math.max(base, overlay)` |
| `HealerAnalytics` | Re-read fresh list, append our `RunRecord` only if `runId` not already present |

---

## Notes for Presentation

- EPIC-02 is the critical infrastructure investment — it makes everything else reliable under load
- The `AsyncLocalStorage` approach is the same pattern used by Node.js APM tools (Datadog, New Relic) for distributed tracing — we're using it for test isolation
- 8-worker parallelism with zero resource leaks means the runner is already more reliable than most open-source parallel test runners
- Every test has a unique `testId` — this becomes the hook for future features: healer history, memory store, flakiness scoring all reference by testId
- Healer Analytics gives the demo moment: run twice, watch LLM calls drop, see which pages are flakiest

---

## Phase 4 — Product Surface ✅ DONE (2026-05-11)

### EPIC-API — REST + WebSocket API Layer ✅ DONE

Built a full API server (`src/server.ts`) that powers both the portal and external integrations.

| File | Purpose |
|---|---|
| `src/server.ts` | Express + WS server — `aiqa serve` CLI command, port 7432, serves portal static files |
| `src/api/router.ts` | Route registration — health unauthenticated, all others behind auth middleware |
| `src/api/middleware/auth.ts` | Bearer token (HTTP header) + `?token=` (WS query param) |
| `src/api/middleware/cors.ts` | CORS policy for local + remote portal access |
| `src/api/routes/runTriggers.ts` | `POST /api/run|run-all|orchestrate|explore|generate|import|jira-sync` with Zod validation |
| `src/api/routes/runs.ts` | `GET /api/runs`, `/runs/:id`, `/runs/:id/results|report` |
| `src/api/routes/tests.ts` | `GET/PUT /api/tests/*path` — YAML read/write with path traversal guard |
| `src/api/routes/screenshots.ts` | `GET /api/runs/:id/screenshots/:file` — static file serving |
| `src/api/routes/cancel.ts` | `POST /api/runs/:id/cancel` — graceful job cancellation |
| `src/api/routes/health.ts` | `GET /api/health` — unauthenticated health check |
| `src/api/ws/runStream.ts` | WS fan-out: 500-event replay buffer, 1hr TTL, late-subscriber catch-up |
| `src/api/jobs/RunJob.ts` | Job lifecycle — `queued → running → passed/failed/error/cancelled` |
| `src/api/jobs/RunJobStore.ts` | In-memory store + FIFO concurrency queue (default: CPU count workers) |

### Key API behaviours

- All trigger endpoints (`run`, `orchestrate`, etc.) accept `vars: Record<string,string>` — env vars injected via `withEnv()` for the duration of the job (e.g. `USERNAME`, `PASSWORD` for auth crawls)
- Responses are job objects: `{ runId, status: "queued" }` — poll via REST or subscribe via WebSocket
- WS stream buffers up to 500 events; a late subscriber receives the full replay before live events begin
- Screenshot files served directly from `.aiqa/runs/:id/screenshots/` via static middleware
- Disk persistence in `.aiqa/runs/<runId>/` — survives server restart for results browsing

---

### EPIC-EXT-B — Pure Chrome Extension ✅ DONE

A zero-setup Chrome extension (Track B) — no AIQA server required. Uses Chrome's CDP API instead of Playwright.

**How it works:** Install (load unpacked from `chrome-ext/`), open any web app, click the AIQA icon, and either record a user flow or type a natural-language goal. The extension generates and replays steps entirely within the browser.

| Capability | Implementation |
|---|---|
| Browser automation | `ChromeDebuggerAdapter` — CDP navigate, click, fill, assert |
| AI test generation | Page HTML → Claude API → YAML steps |
| Record mode | Content script captures click/fill/navigate; replay with visual highlights |
| Results | Pass/fail shown inline in side panel |
| Persistence | `chrome.storage.local` for saved tests across sessions |
| Export/import | Export test as YAML, import from `.yaml` file |

**Navigation resilience fixes applied:**
- Same-URL navigation retry (back/forward cache hit)
- Cached page reload on `net::ERR_CACHE_MISS`
- `--dry-run` flag for CLI orchestrate (explore + generate without running)

---

### EPIC-PORTAL — Web Portal ✅ DONE

A React + Vite frontend served at the same port as the API server (`aiqa serve`).

| Page | What it provides |
|---|---|
| **Dashboard** | Recent run summary cards — pass rate, score, duration trends |
| **Tests** | File tree of YAML tests; click to view, edit inline with syntax highlighting, save via `PUT /api/tests` |
| **Runs** | Paginated run history with status filter chips; `effectiveStatus` used for accurate filter counts |
| **RunDetail** | Full step-by-step progress with per-step duration, error messages, failure screenshots, and an embedded HTML report iframe |
| **Orchestrate** | URL input + `EnvVarPanel` (credential key=value pairs) → `POST /api/orchestrate` → live WS stream |

**Portal polish applied (review pass):**
- `ErrorBoundary` component wraps each page — crashes don't take down the whole app
- Navigation guard prevents leaving mid-run without confirmation
- Cancel button wired to `POST /api/runs/:id/cancel`
- WS auto-reconnect on disconnect — banner suppressed after 500ms to avoid flicker on fast reconnects
- Screenshots directory created per orchestrate run — paths relative to the run's folder
- `300ms` wait before failure screenshot to allow error UI to render

**Orchestrator improvements landed during portal work:**
- Real CSS selectors in generated YAML (instead of hallucinated button labels)
- YAML-safe quoting via `JSON.stringify` for target values containing special characters
- Variable credentials — `username`/`password` templated into generated auth steps
- `element_not_visible` assertion — confirms login form is gone after successful auth
- Single-port server — portal static files served from the API server (no separate dev server in production)

---

### Stage 1b — Authenticated Re-exploration ✅ DONE (2026-05-12)

After the anonymous BFS crawl, if a login page is found and credentials are available, AIQA logs in and crawls the authenticated portion of the app, merging discovered pages into the exploration before FlowMapper runs.

**Architecture:**

```
Stage 1a:  Anonymous BFS  (existing)
           ↓ finds login page with password input
Stage 1b:  Authenticated BFS  (new)
           ↓ login → shared BrowserContext → BFS post-login pages
           ↓ merge new pages into exploration
Stage 2+:  FlowMapper, Generator, Runner see full page set
```

**Key implementation details:**

| Detail | Implementation |
|---|---|
| Shared session | `browser.newContext()` → all pages in context share cookies + localStorage |
| SPA route discovery | Intercepts `history.pushState` during simulated `a[href="#"]` clicks to find React Router routes |
| Session break detection | If any crawled page redirects back to login URL → stop (session expired) |
| Credential resolution | Reads from raw env string OR `process.env` (set by API's `withEnv(body.vars)`) |
| Non-fatal | Auth crawl failure (wrong creds, no redirect) logs a warning and continues with anonymous pages |
| SauceDemo result | 1 anonymous page → 3 pages after auth crawl (login + `/inventory.html` + `/inventory-item.html`) |

**Known limitation:** Apps that use `window.location.href = ...` for navigation (instead of `<a href>` or `history.pushState`) won't have those routes discovered. Most enterprise apps with proper anchor tags are not affected.

---

## Platform Metrics — After Phase 4

| Metric | After Pre-Phase 4 Hardening | After Phase 4 |
|---|---|---|
| Platform access | CLI only | CLI + **REST API** + **Web Portal** + **Chrome Extension** |
| API endpoints | 0 | **14 REST + 1 WS stream** |
| Portal pages | 0 | **5 (Dashboard, Tests, Runs, RunDetail, Orchestrate)** |
| Auth crawl | Anonymous only | **Anonymous + authenticated BFS merge** |
| Alignment with vision | ~72% | **~90%** |
| Step types | 13 | **14** (`element_not_visible` added) |

---

## EPIC-12 — Impact Filter ✅ DONE (2026-05-15)

Runs only tests affected by the current git diff — cuts CI time on PRs that touch a subset of the app.

### What was built

| File | Purpose |
|---|---|
| `src/impact/GitDiffParser.ts` | Runs `git diff --name-only origin/main`, parses output into changed-file list |
| `src/impact/ImpactMapper.ts` | Maps changed files → affected YAML tests via tag-matching and path-prefix matching |
| `src/cli.ts` | `--impact-only` and `--changed-files` flags on `run-all`; prints skipped test count |

### Key behaviour

- `aiqa run-all --impact-only` — diffs current branch vs `origin/main`, maps changed files to test tags, skips unrelated tests
- `--changed-files a.ts,b.ts` — bypass git diff; pass changed files directly (for CI environments that expose this list natively)
- Tests tagged with an area that matches a changed path prefix are included; all others are skipped
- If no tests match the diff, all tests run (safe fallback — never returns an empty suite)
- Prints `[impact] Running N/M tests matched to N changed files` before the suite

### Tests — `tests/impact/`

- `GitDiffParser` (12 tests): parse output, empty diff, error handling
- `ImpactMapper` (17 tests): tag mapping, path prefix matching, fallback, edge cases

---

## EPIC-3 (Reports Polish) ✅ DONE (2026-05-18)

Upgraded the reporting layer with CI-standard JUnit XML and richer HTML reports.

### What was built

| File | Purpose |
|---|---|
| `src/reporters/JUnitReporter.ts` | Produces xUnit-compatible XML: `<testsuites>` → `<testsuite errors="0" timestamp>` → `<testcase classname=testId>` with `<failure>` elements; time in seconds |
| `src/reporters/TrendTracker.ts` | Added `TestRunSummary` + `testResults?` (backward-compat) to `TrendRecord`; exported `topFlakyTests()` |
| `src/reporters/HTMLReporter.ts` | SVG pass-rate trend chart (self-contained, no CDN); top-5 flaky tests heatmap; CSS step-duration bars |
| `src/cli.ts` | `--junit <file>` flag on `run` and `run-all`; reads trend history before HTML generation; appends `testResults` per-test data to history record |

### Key behaviour

- `--junit results/junit.xml` — CI picks up the file natively; no plugin required
- Trend chart shows last 20 runs as an SVG polyline with Y-axis labels (LPAD=34 ensures labels aren't clipped)
- Heatmap shows top-5 tests by fail count across history with proportional bars — hidden on first run
- `classname` in JUnit uses `testId` (stable slug) not `testName`, enabling per-file grouping in Xray / Zephyr
- All attributes required by GitHub Actions / Azure DevOps test parsers: `errors="0"`, `timestamp` ISO

### Tests — `tests/reporters/junit-reporter.test.ts` (14 tests)

Covers XML structure, counts, time in seconds, escaping, empty results, `errors`/`timestamp` attributes, `classname=testId`.

---

## EPIC-5 (CLI/UX Polish) ✅ DONE (2026-05-18)

Made the CLI feel like a first-class product: spinner, new utility commands, hardened doctor, shell completion.

### What was built

| File | Purpose |
|---|---|
| `src/utils/Spinner.ts` | TTY-aware spinner — `start/stop/succeed/fail`; no-op in CI/pipes; `.unref()` so it never hangs the process |
| `src/cli.ts` | 6 UX improvements (see below) |

### CLI improvements

| Feature | Command | Description |
|---|---|---|
| Test file listing | `aiqa list [dir]` | Tabular view: name (36 chars, truncated), tags (26 chars), step count, file path; parse errors shown as a row |
| Hardened doctor | `aiqa doctor` | Playwright check via spinner; checks zod, .env, config file, disk space (`spawnSync` not `execSync`); exits 1 on critical issues |
| Config validation | `aiqa config validate [env]` | Calls `resetConfig()` + `loadConfig(env)`, prints all resolved values; actionable error with fix suggestion |
| Shell completion | `aiqa completion [shell]` | Generates bash or zsh completion scripts; errors with "Unsupported shell" for anything else |
| Interactive init | `aiqa init [project]` | Project name now optional — interactive readline prompt when omitted; `--base-url` flag |
| Actionable errors | `run`, `explore` | Parse errors show relative path + `aiqa list` hint; "no tests" suggests `aiqa init` |

### Tests — `tests/cli/cli-ux.test.ts` (14 tests — all in-process, no subprocess overhead)

Spinner (4), DslParser integration (4), completion script logic (3), init folder/YAML structure (3).

---

## Platform Metrics — After EPIC-12 + EPIC-3 + EPIC-5

| Metric | After Phase 4 | Now (2026-05-18) |
|---|---|---|
| Tests passing | ~500 | **572** |
| CI output formats | HTML only | HTML + **JUnit XML** |
| CI time reduction | — | **`--impact-only`** (40%+ target) |
| Report features | Pass/fail cards | + **trend chart** + **heatmap** + **duration bars** |
| CLI commands | 11 | **15** (+ list, doctor, config validate, completion) |
| Shell completion | ❌ None | ✅ bash + zsh |
| Spinner UX | ❌ Raw output | ✅ TTY-aware spinner in explore + doctor |
| Vision alignment | ~90% | **~93%** |
