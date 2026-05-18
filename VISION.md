# AIQA — Platform Vision & Roadmap

## One-Line Summary

A plug-and-play, AI-powered QA platform that unifies all testing — traditional and AI-driven — into a single intelligent, extensible system.

---

## The Problem

Enterprise QA today is fragmented:

- Separate tools for web, desktop, API, database, and AI testing
- No shared memory or learning between runs
- Manual effort to generate, maintain, and debug tests
- No native support for validating LLM outputs or agentic systems
- High onboarding cost for each new application or team

The result is slow feedback loops, brittle test suites, and QA that can't keep pace with modern software — especially AI-powered software.

---

## The Vision

AIQA is a **unified QA execution engine** — one platform that handles every layer of testing through a single config-driven interface, with AI at the core rather than bolted on.

It is designed to be:

- **Plug-and-play** — minimal setup, works with any application type
- **Config-driven** — YAML/JSON drives everything, no hardcoding
- **AI-native** — LLMs and agents are first-class citizens, not integrations
- **Self-learning** — memory of past failures informs future runs
- **Language-agnostic** — works across TypeScript, Python, Java via adapters

---

## Core Capabilities (Full Vision)

### 1. Autonomous Test Generation
Accepts a URL and credentials. Automatically explores the application, identifies pages and user flows, generates test scenarios, executes them, and produces a **production readiness score**.

### 2. Config-Driven Execution
Every test is expressed in YAML. No test code to write or maintain. Easy to onboard new applications by editing a config file.

### 3. Multi-Layer Testing Support
| Layer | Capability |
|---|---|
| Web | Browser automation via Playwright / Selenium |
| API | REST/GraphQL calls, chained requests, response assertions |
| Database | SQL/NoSQL query validation, data integrity checks |
| Desktop | Native app automation via OCR, vision, accessibility APIs |
| LLM / GenAI | Output validation, hallucination detection, consistency scoring |
| Agentic AI | Multi-step agent workflow testing, decision path validation |

### 4. Intelligent Object Detection
Captures screenshots, extracts UI elements using OCR and vision models, and automatically builds and maintains an object repository. Works for web, desktop, and dynamic UIs that change frequently.

### 5. Enterprise Integration
Connects to Jira and Xray to:
- Analyse user stories and acceptance criteria
- Auto-generate test scenarios from requirements
- Sync test results and raise defects automatically

### 6. AI Debugging
When a test fails, an AI agent classifies the failure, identifies root cause, suggests a fix, and stores the pattern for future reference. Over time, known failures are resolved from memory without calling an LLM.

### 7. Memory-Driven Self-Learning
Every run updates a persistent memory layer. The system learns which locators are fragile, which tests are flaky, which flows change frequently, and adjusts its behaviour accordingly.

### 8. Smart Execution Engine
Handles orchestration, parallel execution, retry with memory-aware backoff, circuit breaking on repeated failures, and per-test trace isolation for clean parallel runs.

---

## Architecture Principles

### Core + Plugin Model
```
┌─────────────────────────────────────────┐
│              AIQA Core                  │
│  DSL Parser → StepInterpreter → Runner  │
│         ExecutionContext                │
│         HandlerRegistry                 │
└────────────┬────────────────────────────┘
             │ registers
    ┌────────┴──────────────────────────┐
    │           Plugins / Handlers      │
    │  UIActionHandler                  │
    │  APIActionHandler                 │
    │  AssertionHandler                 │
    │  DBHandler           (planned)    │
    │  LLMEvalHandler      (planned)    │
    │  DesktopHandler      (planned)    │
    └───────────────────────────────────┘
             │ uses
    ┌────────┴──────────────────────────┐
    │           Adapters                │
    │  PlaywrightAdapter                │
    │  SeleniumAdapter     (planned)    │
    │  DesktopAdapter      (planned)    │
    └───────────────────────────────────┘
```

- **Core** handles orchestration, context, and execution flow — never changes
- **Handlers** add new step types — no core changes required
- **Adapters** swap the underlying automation engine — handlers remain the same

### Config-Driven by Design
```yaml
test:
  name: "User checkout flow"
  steps:
    - api:
        method: POST
        url: "{{ env.API_BASE }}/auth/login"
        store_as: session
    - navigate: "{{ env.BASE_URL }}/shop"
    - click: "Add to cart"
    - assert:
        text: "1 item in cart"
```

No code. No imports. No framework knowledge required.

---

## Current State

The platform is production-ready across all core layers. ~93% of the full vision is implemented.

| Component | Status |
|---|---|
| YAML DSL parser + all step types | ✅ Done (navigate, click, fill, assert, api, db, judge, wait, if, for_each, store) |
| Web automation (Playwright) + self-healing | ✅ Done |
| API testing + DB validation | ✅ Done |
| Parallel execution (8-worker, zero interleaving) | ✅ Done |
| Retry + circuit breaker + memory-aware backoff | ✅ Done |
| OrchestratorAgent (explore → map → generate → run → score) | ✅ Done |
| Authenticated re-exploration (BFS post-login) | ✅ Done |
| LLM-powered debugger + memory layer | ✅ Done |
| Multi-LLM support (Claude, GPT-4, Gemini, NVIDIA, mock) | ✅ Done |
| Healer analytics (unstable pages, LLM savings, flakiness trends) | ✅ Done |
| Test case import (CSV, Excel, Gherkin) | ✅ Done |
| CI/CD pipeline (GitHub Actions + Jenkins) | ✅ Done |
| Impact filter (`--impact-only` — runs only affected tests) | ✅ Done |
| HTML reports with trend chart, heatmap, duration bars | ✅ Done |
| JUnit XML reporter (GitHub Actions, GitLab, Azure DevOps) | ✅ Done |
| REST + WebSocket API (14 endpoints + 1 WS stream) | ✅ Done |
| Web Portal (Dashboard, Tests, Runs, RunDetail, Orchestrate) | ✅ Done |
| Chrome Extension (zero-setup, CDP-based) | ✅ Done |
| Jira integration (story → test generation) | 🔧 Partial (skeleton exists) |
| Allure reporter | ⬜ Planned |
| AI application testing (LLM eval, agentic workflows) | ⬜ Planned |
| Desktop automation + vision | ⬜ Planned |
| SaaS / multi-tenant | ⬜ Planned |

**572 tests passing** · TypeScript strict · Zero known security issues

---

## Build Roadmap

### Phase 1 — AI Core (Next)
> Makes AIQA an AI QA platform, not just a test runner

| Step | Description |
|---|---|
| DebuggerAgent | On failure: classify root cause, suggest fix via Claude |
| Memory layer | Store failure patterns, locator fixes, flakiness scores |
| RetryPolicy | Memory-aware backoff — flaky tests get longer delays |
| TraceContext | `AsyncLocalStorage` isolation for parallel test runs |

**Outcome:** Failures are diagnosed automatically. The system learns from each run.

---

### Phase 2 — Broader Coverage
> Covers the full application stack

| Step | Description |
|---|---|
| DBHandler | SQL/NoSQL query steps — assert on database state |
| WaitHandler | `wait_for_element`, `wait_ms`, `wait_for_condition` |
| ConditionHandler | `if/else` branching in test flows |
| LoopHandler | `for_each` iteration over API response arrays |
| Coverage scoring | Per-run pass rate, readiness score, trend tracking |

**Outcome:** A single YAML can test the full stack — UI, API, and database — in one flow.

---

### Phase 3 — Enterprise Integration
> Connects QA to the rest of the business

| Step | Description |
|---|---|
| Jira integration | Pull user stories, generate test scenarios from AC |
| Xray sync | Push results, raise defects automatically |
| ImpactFilter | Git diff → select only affected tests for CI |
| Multi-env config | `staging.yaml`, `prod.yaml`, profile merging |
| Reporting | Allure report, Slack notification on run complete |

**Outcome:** QA is connected to requirements. CI runs only what matters.

---

### Phase 4 — AI + GenAI Testing
> Tests AI systems, not just traditional apps

| Step | Description |
|---|---|
| LLMEvalHandler | Assert LLM output quality, consistency, accuracy |
| Hallucination detection | Flag responses that contradict known facts |
| Agentic workflow testing | Multi-step agent decision path validation |
| Prompt regression testing | Detect when model outputs change across versions |

**Outcome:** AIQA can test GPT, Claude, and other AI systems the same way it tests a web app.

---

### Phase 5 — Vision + Desktop
> Removes dependency on DOM/selectors entirely

| Step | Description |
|---|---|
| Screenshot capture | Per-step visual snapshots |
| OCR element extraction | Build object repository from screenshots |
| DesktopAdapter | Native app automation via vision + accessibility APIs |
| Visual regression | Compare screenshots across runs |
| SmartLocatorEngine | LLM-assisted locator healing when selectors break |

**Outcome:** Works on apps with no DOM access — desktop, embedded, legacy.

---

### Phase 6 — Autonomous Testing
> Self-driving test generation

| Step | Description |
|---|---|
| App explorer | Navigate an app autonomously, map all pages and flows |
| Scenario generator | LLM generates test cases from discovered flows |
| Edge case detection | AI identifies boundary conditions and negative paths |
| Readiness score | Composite score: coverage + pass rate + risk assessment |

**Outcome:** Give AIQA a URL. Get a full test suite back. No manual test writing.

---

### Phase 7 — Platform & Scale
> From tool to product

| Step | Description |
|---|---|
| Language adapters | Java and Python test runners alongside TypeScript |
| Plugin marketplace | Third-party handlers via `ai-qa-*` npm packages |
| No-code UI | Visual test builder, run dashboard, results explorer |
| Cloud execution | Distributed parallel runs, scheduled CI |
| SaaS model | Multi-tenant, team management, usage billing |

---

## Key Metrics to Track Per Phase

| Metric | Target |
|---|---|
| Test types supported | Web + API → + DB → + Desktop → + AI |
| Time to onboard new app | < 30 minutes |
| Failure diagnosis accuracy | > 80% correct classification |
| Test generation from URL | Full flow coverage in < 5 minutes |
| CI impact reduction | 40%+ fewer tests run per PR via impact filter |

---

## What Makes This Different

| Existing Tools | AIQA |
|---|---|
| Playwright, Selenium | Only web. Code-only. |
| Postman, RestAssured | Only API. No UI. |
| Appium | Only mobile/desktop. |
| LangSmith, RAGAS | Only LLM eval. No UI or API. |
| Cucumber/BDD | Config-driven but no AI, no memory, no multi-layer |

AIQA is the only platform that handles **all layers in one system**, with AI at the execution core, not as an afterthought.
