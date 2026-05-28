# AIQA Real-World Test Plan — EPIC-RWT

**Version:** 1.1  
**Effective after:** EPIC-15 Desktop Automation complete  
**Blocks:** Phase 7 Scale (no Phase 7 work starts until this plan completes and is signed off)  
**Methodology:** STLC (Software Testing Life Cycle)  
**Owner:** QA Lead / Mahesh Mutukula

---

## Why this plan exists

All 1018 AIQA unit tests run against stubs and mocks. The PlaywrightAdapter, VisionAgent, OcrEngine, and all CLI commands have never been exercised against a live web app, real API, or real database. This plan closes that gap before AIQA is positioned for production use or offered to external teams.

This is not a regression suite — it is a **validation audit**: does AIQA actually work on real systems the same way its unit tests claim it does?

---

## STLC Phase 1 — Requirement Analysis

### Objectives
- Confirm every AIQA feature has a real-world testable equivalent
- Identify gaps where no suitable public target application exists
- Define acceptance criteria for each feature area

### Feature inventory

| Feature area | DSL steps / commands | Real test target identified |
|---|---|---|
| Web navigation | `navigate:`, `click:`, `fill:`, `assert_*` | SauceDemo, DemoQA |
| Selector healing | Auto-triggered on broken selectors | SauceDemo (will intentionally break selectors) |
| LLM judge | `judge:` | SauceDemo checkout with Anthropic live key |
| API testing | `api:` | JSONPlaceholder, Petstore Swagger |
| Database testing | `db:` | Local PostgreSQL (Northwind schema) |
| GenAI — llm_eval | `llm_eval:` | Claude API + OpenAI API (live keys) |
| GenAI — llm_consistency | `llm_consistency:` | Claude API (live key) |
| GenAI — rag_assert | `rag_assert:` | AIQA Portal knowledge base |
| Vision — vision_assert | `vision_assert:` | SauceDemo, DemoQA |
| Vision — visual_snapshot | `visual_snapshot:` | SauceDemo product listing page |
| Self-healing (SmartLocator) | Triggered by selector failure | DemoQA dynamic elements page |
| RAG knowledge | `aiqa knowledge ingest`, `readiness` | AIQA Jira (SCRUM project) |
| REST API server | `aiqa serve` + Portal | AIQA Portal at localhost:7432 |
| Jira integration | `aiqa jira-sync` | aiqajira.atlassian.net SCRUM project |
| CLI commands | `doctor`, `score`, `uptime`, `badge` | Local environment |
| Security headers | HTTP response assertions | JSONPlaceholder, Petstore |
| Performance | Wall-clock step timing | SauceDemo (50-product page load) |

### Acceptance criteria (global)
- Each feature area has at least one end-to-end YAML test that passes against a live target
- No test may rely on a stub or mock (unless the feature under test IS the stub, e.g., StubVisionAgent)
- Security checklist complete for the REST API surface
- Performance baselines captured for later regression

---

## STLC Phase 2 — Test Planning

### Test scope

**In scope:**
- All web automation DSL steps against real web apps
- API testing against public APIs (JSONPlaceholder, Petstore)
- Database testing against local PostgreSQL
- GenAI steps against live LLM APIs (Claude, OpenAI)
- Vision steps against real browser screenshots
- Self-healing triggered by intentionally broken selectors
- REST API server functional and security testing
- CLI command validation on real environment
- Jira sync against real Jira instance
- E2E regression from YAML → execution → report → Jira defect

**Out of scope (for EPIC-RWT):**
- Load testing at scale (>10 concurrent users) — Phase 7
- AIQA SaaS multi-tenant isolation — Phase 7
- Desktop automation (EPIC-15 owns that)
- Production infrastructure (no prod Kubernetes, no SSL termination testing)

### Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **LLM non-determinism** — `judge:`, `SelectorHealer`, `VisionAgent` all produce variable outputs across runs | **High** | **High** | Use `provider: mock` for all deterministic cycles (smoke, functional DB/healing); isolate live-key LLM tests to integration cycle only; use score-range assertions (`pass_if: ">= 0.7"` not `== 1.0`); add `retries: 1` on LLM steps; never assert on exact response text |
| Anthropic / OpenAI API rate limits | Medium | High | Use separate billing keys; run LLM tests last; add `wait_ms:` between llm_eval runs |
| SauceDemo / DemoQA downtime | Low | Medium | Use two fallback targets per feature area |
| Tesseract OCR accuracy on dynamic pages | Medium | Medium | Accept ≥ 70% word-level accuracy on English text |
| Jira API quota | Low | Low | SCRUM project has no quota at hobby tier |
| Local PostgreSQL not running | Medium | High | RWT-03 environment setup step validates this before any DB test runs |
| pixelmatch baseline drift on CI | Medium | Medium | Commit baselines to repo; regenerate if runner resolution changes |

### Entry criteria (before any test execution begins)
- [ ] EPIC-15 merged to main, tsc clean, all tests passing
- [ ] `.env` contains live `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`
- [ ] PostgreSQL running locally with Northwind schema loaded
- [ ] `aiqa serve` starts clean on port 7432
- [ ] `aiqa doctor` shows all green (including Ollama probe if local LLM in scope)
- [ ] Visual baselines do not exist yet (fresh baseline capture in smoke cycle)

### Exit criteria (before Phase 7 can start)
- [ ] All 14 RWT stories marked complete
- [ ] Zero P1/P2 defects open
- [ ] Jira defects created for all P3+ findings found during RWT
- [ ] Performance baselines committed to `tests/perf-baselines/`
- [ ] Security checklist signed off (see Phase 6 Security cycle)
- [ ] `aiqa score` on the real-world test suite returns ≥ 80

---

## STLC Phase 3 — Test Case Development

Test YAML files live in `tests/real-world/` (not committed until EPIC-RWT starts). Each story below maps to one or more YAML files.

### Story × Cycle traceability matrix (L2)

`●` = primary exercise in this cycle  `○` = re-run as part of full suite in regression

| Story | Smoke | Functional | Integration | Perf | Security | Regression |
|---|---|---|---|---|---|---|
| RWT-01 Environment validation | ● | | | | | ○ |
| RWT-02 Web smoke (SauceDemo) | ● | | | | | ○ |
| RWT-03 API CRUD (JSONPlaceholder) | ● | | | | | ○ |
| RWT-04 Database (PostgreSQL) | | ● | | | | ○ |
| RWT-05 Selector healing | | ● | | | | ○ |
| RWT-06 LLM judge | | ● | | | | ○ |
| RWT-07 llm_eval (live Claude) | | ● | | | | ○ |
| RWT-08 llm_consistency | | ● | | | | ○ |
| RWT-09 vision_assert | | ● | | | | ○ |
| RWT-10 visual_snapshot | | ● | | | | ○ |
| RWT-11 RAG + Jira ingest | | | ● | | | ○ |
| RWT-12 Orchestrator E2E | | | ● | ● | | ○ |
| RWT-13 Jira sync (defect creation) | | | ● | | | ○ |
| RWT-14 CLI + portal validation | | | | ● | ● | ○ |

**Coverage notes:**
- Vision Agent (RWT-09, RWT-10) is exercised only from functional cycle onward — smoke uses `provider: mock`
- Security cycle focuses on RWT-14 (REST API surface) and cross-cuts RWT-04 (SQL injection via `db:`) and RWT-07 (path traversal via `baseline_key`)
- Performance cycle covers RWT-12 (orchestrator wall-clock) and RWT-14 (`aiqa run-all` timing)

### RWT-01 — Environment setup validation

**File:** `tests/real-world/rwt-01-environment.yaml`

```yaml
name: RWT-01 Environment validation
tags: [rwt, setup]
steps:
  - api:
      method: GET
      url: "https://jsonplaceholder.typicode.com/posts/1"
      assert_status: 200
  - api:
      method: GET
      url: "https://petstore.swagger.io/v2/pet/findByStatus?status=available"
      assert_status: 200
  - api:
      method: GET
      url: "http://localhost:7432/api/health"
      assert_status: 200
```

### RWT-02 — Web automation smoke test

**File:** `tests/real-world/rwt-02-web-smoke.yaml`

```yaml
name: RWT-02 SauceDemo login and product page
tags: [rwt, smoke, web]
steps:
  - navigate: "https://www.saucedemo.com"
  - fill:
      target: "[data-test='username']"
      value: "standard_user"
  - fill:
      target: "[data-test='password']"
      value: "secret_sauce"
  - click: "[data-test='login-button']"
  - assert_url_contains: "/inventory.html"
  - assert_element_visible: ".inventory_list"
  - assert_text_visible: "Products"
```

### RWT-03 — API testing (JSONPlaceholder CRUD)

**File:** `tests/real-world/rwt-03-api-crud.yaml`

```yaml
name: RWT-03 JSONPlaceholder CRUD
tags: [rwt, api]
steps:
  - api:
      method: GET
      url: "https://jsonplaceholder.typicode.com/posts/1"
      assert_status: 200
  - api:
      method: POST
      url: "https://jsonplaceholder.typicode.com/posts"
      body: { title: "AIQA test", body: "rwt validation", userId: 1 }
      assert_status: 201
  - api:
      method: PUT
      url: "https://jsonplaceholder.typicode.com/posts/1"
      body: { id: 1, title: "updated", body: "updated body", userId: 1 }
      assert_status: 200
  - api:
      method: DELETE
      url: "https://jsonplaceholder.typicode.com/posts/1"
      assert_status: 200
```

### RWT-04 — Database testing (PostgreSQL Northwind)

**File:** `tests/real-world/rwt-04-database.yaml`

```yaml
name: RWT-04 PostgreSQL Northwind queries
tags: [rwt, database]
steps:
  - db:
      query: "SELECT COUNT(*) AS cnt FROM customers"
      assert_rows: 1
  - db:
      query: "SELECT customer_id, company_name FROM customers WHERE country = ?"
      params: ["Germany"]
      assert_rows: 11
  - db:
      query: "SELECT order_id FROM orders WHERE customer_id = ?"
      params: ["ALFKI"]
      assert_rows: 6
```

### RWT-05 — Self-healing selectors (SauceDemo intentional break)

**File:** `tests/real-world/rwt-05-selector-healing.yaml`

Tests that SelectorHealer successfully repairs a deliberately broken selector using fallback strategies. The test uses a descriptor that doesn't match CSS directly, forcing the healer to run.

```yaml
name: RWT-05 Selector healing on SauceDemo
tags: [rwt, healing]
steps:
  - navigate: "https://www.saucedemo.com"
  - fill:
      target: "username field"     # descriptor — healer must find it
      value: "standard_user"
  - fill:
      target: "password field"
      value: "secret_sauce"
  - click: "login button"
  - assert_url_contains: "/inventory.html"
```

### RWT-06 — LLM judge on real checkout flow

**File:** `tests/real-world/rwt-06-llm-judge.yaml`

```yaml
name: RWT-06 LLM judge on SauceDemo checkout
tags: [rwt, llm, judge]
steps:
  - navigate: "https://www.saucedemo.com"
  - fill:
      target: "[data-test='username']"
      value: "standard_user"
  - fill:
      target: "[data-test='password']"
      value: "secret_sauce"
  - click: "[data-test='login-button']"
  - click: "[data-test='add-to-cart-sauce-labs-backpack']"
  - click: "[data-test='shopping-cart-link']"
  - store:
      from: ".summary_info"
      as: cartSummary
  - judge:
      prompt: "Does the cart show exactly one item with a valid price?"
      value: "${cartSummary}"
      pass_if: ">= 0.8"
```

### RWT-07 — GenAI llm_eval (live Anthropic API)

**File:** `tests/real-world/rwt-07-llm-eval.yaml`

```yaml
name: RWT-07 llm_eval against Claude live
tags: [rwt, genai, llm_eval]
steps:
  - llm_eval:
      target: fast
      prompt: "What is the capital of France? Answer in one word."
      assert_quality:
        criteria: "Response is exactly or contains the word Paris"
        pass_if: "score >= 0.9"
      baseline_key: rwt-capital-france
      max_drift: 0.1
      store_as: evalResult
```

### RWT-08 — GenAI llm_consistency (variance check)

**File:** `tests/real-world/rwt-08-llm-consistency.yaml`

```yaml
name: RWT-08 llm_consistency factual question
tags: [rwt, genai, consistency]
steps:
  - llm_consistency:
      target: fast
      prompt: "Name the three primary colors of light."
      runs: 5
      assert_variance:
        max: 0.15
        metric: max
      store_as: consistencyResult
```

### RWT-09 — Vision assert on SauceDemo

**File:** `tests/real-world/rwt-09-vision-assert.yaml`

```yaml
name: RWT-09 vision_assert login button detection
tags: [rwt, vision]
steps:
  - navigate: "https://www.saucedemo.com"
  - vision_assert:
      description: "login button"
      confidence: 0.7
      store_as: loginBtn
  - click: "${loginBtn.selector}"
```

### RWT-10 — Visual snapshot baseline and compare

**File:** `tests/real-world/rwt-10-visual-snapshot.yaml`

Two-run test: first run with `update: true` captures baseline; second run (re-run same file without `update`) compares.

```yaml
name: RWT-10 SauceDemo inventory visual snapshot
tags: [rwt, visual]
steps:
  - navigate: "https://www.saucedemo.com"
  - fill:
      target: "[data-test='username']"
      value: "standard_user"
  - fill:
      target: "[data-test='password']"
      value: "secret_sauce"
  - click: "[data-test='login-button']"
  - visual_snapshot:
      name: saucedemo-inventory
      max_diff_percent: 2
      sensitivity: 0.1
```

### RWT-11 — RAG knowledge (ingest SCRUM + assert)

**File:** `tests/real-world/rwt-11-rag-assert.yaml`

Requires `aiqa knowledge ingest` to have been run with SCRUM connector active.

```yaml
name: RWT-11 rag_assert on SCRUM knowledge
tags: [rwt, rag]
steps:
  - rag_assert:
      query: "user authentication login acceptance criteria"
      min_chunks: 1
      min_score: 0.5
      store_as: ragResult
```

### RWT-12 — E2E orchestration (explore → generate → run)

**Command-level test — not a YAML file.** Validates the full pipeline:

```
aiqa orchestrate --url https://www.saucedemo.com --headless
```

Expected outcomes:
- FlowMapper produces at least 2 flows (login, inventory browse)
- Generator produces at least 2 YAML test files in `tests/generated/`
- Test runner executes them and produces an HTML report
- `aiqa score` on the generated tests returns ≥ 70

### RWT-13 — Jira sync (failure → defect creation)

**Command-level test.** After a forced failure in RWT-02 (temporarily break an assertion), run:

```
aiqa run-all tests/real-world/ --jira-sync
```

Expected outcomes:
- At least one Jira defect created in SCRUM project
- Defect contains step name, selector, error message, screenshot attachment

### RWT-14 — CLI and portal validation

**Checklist — manual + automated:**

```
aiqa doctor              → all checks green
aiqa score               → ≥ 80 on real-world suite
aiqa uptime tests/real-world/  → bar chart shows last run
aiqa badge               → SVG file generated, badge score visible
aiqa serve               → portal accessible at localhost:7432
```

Portal UI checklist:
- [ ] Dashboard shows latest run results
- [ ] Run history visible with correct pass/fail counts
- [ ] WebSocket live stream fires during `run-all`
- [ ] Settings page loads without error

---

## STLC Phase 4 — Test Environment Setup

### Prerequisites checklist

| Item | How to verify | Owner |
|---|---|---|
| Node 20 + dependencies installed | `node --version`, `npm ci` | Dev machine |
| PostgreSQL running | `psql -c "SELECT 1"` | Dev machine |
| Northwind schema loaded | `psql aiqa_rwt -c "\dt"` — expect ≥ 10 tables | Dev machine |
| `.env` has live API keys | `aiqa doctor` shows LLM provider reachable | Dev machine |
| `ANTHROPIC_API_KEY` has **vision-model scope** | Key must allow `claude-sonnet-4-6` vision calls (base64 PNG input), not text-only — verify by running `aiqa run tests/real-world/rwt-09-vision-assert.yaml` | Dev machine |
| tesseract.js WASM pre-warmed | First `vision_assert:` step downloads ~25MB to `.aiqa/tesseract-cache/` — run once manually or pre-warm in setup: `ts-node -e "require('./src/vision/OcrEngine').OcrEngine; process.exit()"` | Dev machine (needs outbound internet) |
| `aiqa serve` starts clean | `curl localhost:7432/api/health` → 200 | Dev machine |
| Playwright browsers installed | `npx playwright install chromium` | Dev machine |
| SCRUM Jira project accessible | `curl -u email:token .../rest/api/3/project/SCRUM` → 200 | Dev machine |
| Visual baselines cleared | `rm -rf .aiqa/visual-baselines/` | Dev machine before RWT-10 first run |

> **Vision cost note:** Use `StubVisionAgent` (via `provider: mock` config) in smoke and functional cycles. Switch to live `VisionAgent` only in the integration cycle (RWT-09, RWT-10). Each live `vision_assert:` step makes one Claude Vision API call — 10-step desktop or vision tests cost ~10 calls each.

### PostgreSQL setup (Northwind)

```bash
createdb aiqa_rwt
psql aiqa_rwt < scripts/northwind.sql   # add this script in RWT-03 story
```

### Data isolation strategy (M3)

Six cycles run against the same `aiqa_rwt` database. To prevent state accumulation from causing false failures:

- **Strategy: self-cleaning tests.** All `db:` steps in RWT stories use read-only Northwind data (SELECT only). Any INSERT/UPDATE/DELETE steps must include a compensating cleanup step in the same YAML file (within an `if: failed` block or as a teardown step).
- **Fallback before regression cycle.** Before Cycle 6, restore a clean Northwind snapshot: `psql aiqa_rwt < scripts/northwind.sql` (script is idempotent — drops and recreates all tables). This guarantees regression cycle starts from known state.
- **No shared mutable schema.** Each RWT story that needs writable state creates a dedicated table (prefix `rwt_`) and drops it at the end of the test. The Northwind tables are never mutated.

### Config file for real-world tests

`config/environments/rwt.yaml`:
```yaml
llm:
  provider: anthropic        # live API
  model: claude-haiku-4-5-20251001
  fallback: []

knowledge:
  enabled: true
  indexPath: .aiqa/knowledge-rwt
  topK: 5
  connectors:
    - type: jira
      projectKey: SCRUM

jira:
  baseUrl: https://aiqajira.atlassian.net
  projectKey: SCRUM
  email: mmk.mutu@gmail.com

database:
  host: localhost
  port: 5432
  name: aiqa_rwt
  user: postgres
```

---

## STLC Phase 5 — Test Execution

### Cycle 1 — Smoke (RWT-01, RWT-02, RWT-03)

**Goal:** Confirm environment is reachable and basic execution works.  
**Run command:** `aiqa run-all tests/real-world/smoke/ --env rwt`  
**Pass criteria:** All 3 smoke tests green, zero errors in console.

### Cycle 2 — Functional (RWT-04 through RWT-10)

**Goal:** Every feature area works end-to-end on a real target.

| Story | Area | Expected result |
|---|---|---|
| RWT-04 | DB | Query returns correct row counts matching Northwind spec |
| RWT-05 | Selector healing | Healer repairs descriptor-based selectors; test passes |
| RWT-06 | LLM judge | Judge scores ≥ 0.8 on valid checkout state |
| RWT-07 | llm_eval | Quality score ≥ 0.9; baseline committed for future drift |
| RWT-08 | llm_consistency | Variance ≤ 0.15 across 5 runs of factual question |
| RWT-09 | Vision assert | Login button detected with confidence ≥ 0.7 |
| RWT-10 | Visual snapshot | Baseline captured; second run passes (diff ≤ 2%) |

**Run command:** `aiqa run-all tests/real-world/functional/ --env rwt`

### Cycle 3 — Integration (RWT-11, RWT-12, RWT-13)

**Goal:** Components work together across system boundaries.

| Story | Integration | Expected result |
|---|---|---|
| RWT-11 | RAG + Jira | rag_assert retrieves chunks from real SCRUM data |
| RWT-12 | Orchestrator E2E | Full explore → generate → run pipeline on SauceDemo |
| RWT-13 | Jira sync | Defect created in SCRUM with step details |

### Cycle 4 — Performance

**Goal:** Capture wall-clock baselines for key operations. Run before security so any performance issues (memory leaks, worker contention, slow queries) are identified and stable before auth/injection checks.

| Scenario | Target | How to measure |
|---|---|---|
| SauceDemo login + inventory load | < 5 s | `wait_ms` timing + HTML report step times |
| llm_eval single call (Haiku) | < 10 s | Step duration in report |
| `aiqa knowledge ingest` (SCRUM 50 issues) | < 60 s | CLI wall clock |
| `aiqa run-all` on 10 real-world tests | < 90 s | CLI wall clock |
| Visual snapshot compare (inventory page) | < 2 s | Step duration in report |

Baseline file: `tests/perf-baselines/rwt-perf-baseline.json` — committed to repo after first run.

### Cycle 5 — Security

**Scope:** AIQA REST API server (`aiqa serve`) + public endpoint behavior. Run after performance so the system is stable and any resource-exhaustion vulnerabilities are distinguishable from performance issues.

| Check | Method | Expected result |
|---|---|---|
| No default credentials in API | `curl localhost:7432/api/runs` without auth | Returns data (dev) — document this is dev-only; confirm prod needs auth layer |
| No path traversal in BaselineStore | `api:` step with `baseline_key: "../../etc/passwd"` | Error thrown, no file read |
| No path traversal in `store:` | YAML `store` with `as: "../../evil"` | Stored in scoped map only, not filesystem |
| XSS in HTML reporter | Inject `<script>alert(1)</script>` as test name | HTML reporter escapes output |
| SQL injection in `db:` | `params: ["1; DROP TABLE orders; --"]` | Parameterized query, no injection |
| WebSocket auth | Connect to `ws://localhost:7432` without session | In dev: open. Document that `aiqa serve --auth` is Phase 7 story |

### Cycle 6 — Regression (full suite re-run)

After all cycles above are green:

1. Run `npx jest --no-coverage` — confirm all 972+ unit tests still pass
2. Run `aiqa run-all tests/real-world/ --env rwt` — confirm all 14 stories still pass
3. Run `aiqa score` — confirm ≥ 80
4. Confirm zero new Jira defects opened automatically (all assertions passing)

---

## STLC Phase 6 — Test Cycle Closure

### Sign-off definition (L3)

Phase 7 is unblocked **only** when ALL of the following measurable conditions are met:

| Condition | Pass threshold |
|---|---|
| All 6 execution cycles completed | 6/6 — no cycle skipped or partial |
| Real-world story pass rate | ≥ 95% (≥ 14/14 stories, or 13/14 with one P3-only failure) |
| Open P1/P2 defects | 0 |
| `aiqa doctor` green | All checks pass on bare Node 20 and inside Docker container |
| Performance cycle: `aiqa run-all` on 14 RWT tests | < 120 s wall-clock |
| `aiqa score` on real-world suite | ≥ 80 |
| Security checklist | All 6 checks documented (pass or acknowledged risk) |

If any condition is not met, Phase 7 remains blocked. Partial sign-off ("we'll fix it in Phase 7") is not accepted.

### Closure checklist

- [ ] All 14 RWT stories marked complete in BACKLOG.md
- [ ] All 6 sign-off conditions met (table above)
- [ ] All Jira defects found during RWT triaged: P1/P2 fixed, P3/P4 logged for Phase 7
- [ ] Performance baselines committed to `tests/perf-baselines/`
- [ ] Visual baselines committed to `.aiqa/visual-baselines/`
- [ ] Security findings documented in `docs/security-findings-rwt.md`
- [ ] CHANGELOG.md updated with [1.7.0-rwt] entry
- [ ] BACKLOG.md EPIC-RWT marked ✅ DONE
- [ ] Memory file `project_backlog.md` updated
- [ ] Phase 7 formally unblocked

### Metrics to record

| Metric | Target | Actual (fill on completion) |
|---|---|---|
| Total stories completed | 14/14 | |
| Defects found | ≥ 1 expected | |
| P1/P2 defects | 0 open at closure | |
| Real-world test pass rate | ≥ 95% | |
| AIQA score (real-world) | ≥ 80 | |
| LLM API cost (RWT run) | Log for budget planning | |

### Lessons-learned template

After EPIC-RWT closure, capture:

1. Which features worked exactly as expected on real apps?
2. Which features needed fixing after hitting real-world conditions?
3. Which mock assumptions were wrong?
4. What new AIQA features are now obviously needed (feed to Phase 7 backlog)?

---

## Defect severity guide

| Severity | Definition | Example |
|---|---|---|
| P1 — Blocker | Feature completely unusable on real target | PlaywrightAdapter throws on every real page |
| P2 — Critical | Feature works on some targets, fails on others | Vision assert fails on all DomQ pages |
| P3 — Major | Feature works but produces wrong results | LLM judge gives 0.5 on clearly correct output |
| P4 — Minor | Feature works, UX rough | HTML report line wraps badly on long selector names |

---

*This document is owned by EPIC-RWT. Update the completion dates in Phase 5 as each cycle finishes.*
