# AIQA — Sprint 1 Progress Report

> Branch: `phase1` · Started: 2026-05-01 · Last updated: 2026-05-04
> Platform alignment at sprint start: **~35%** of vision

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

## Pending — Sprint 1 Remaining

| EPIC | Title | Status |
|---|---|---|
| EPIC-04 | CI/CD Pipeline (GitHub Actions) | ⬜ Next |
| EPIC-06 | Test Case Importer (Excel/CSV/Gherkin) | ⬜ |

## Sprint 2

| EPIC | Title | Status |
|---|---|---|
| EPIC-05 | OrchestratorAgent | ⬜ Parked until Sprint 1 done |

---

## Notes for Presentation

- EPIC-02 is the critical infrastructure investment — it makes everything else reliable under load
- The `AsyncLocalStorage` approach is the same pattern used by Node.js APM tools (Datadog, New Relic) for distributed tracing — we're using it for test isolation
- 8-worker parallelism with zero resource leaks means the runner is already more reliable than most open-source parallel test runners
- Every test has a unique `testId` — this becomes the hook for future features: healer history, memory store, flakiness scoring all reference by testId
