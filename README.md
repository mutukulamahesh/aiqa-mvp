# AIQA — Enterprise AI QA Platform

A plug-and-play, AI-powered QA platform that unifies web automation, API testing, database validation, and autonomous test generation into a single config-driven system.

> Full platform vision: see [VISION.md](VISION.md) · Full backlog: see [BACKLOG.md](BACKLOG.md)

---

## What it does

- **Init a project** in one command — folder structure, sample test, ready to run
- **Explore any app** autonomously and map its pages and flows
- **Generate test files** per page or per flow — no manual test writing
- **Run tests** defined in YAML — web UI, API, database, or mixed
- **Orchestrate the full pipeline** — one command: explore → map → generate → run → score
- **Self-heal broken selectors** — when a locator fails, AIQA repairs it via LLM and caches the fix
- **Analytics after every run** — top unstable pages, most healed selectors, LLM calls saved
- **Diagnose failures** automatically with AI root-cause analysis and screenshots
- **Score readiness** — get a 0–100 grade on your test coverage
- **HTML reports** generated automatically after every run
- **Import existing test cases** from CSV, Excel, or Gherkin — no rewrite needed
- **DB validation** — run SQL queries, assert row counts and field values, chain API → DB checks
- **Memory-aware retries** — flaky steps get extra wait time based on historical failure scores
- **Plug in any LLM** (Claude, GPT-4, Gemini, NVIDIA) — no code changes needed

---

## Prerequisites

- Node.js v18 or higher
- npm

---

## Installation

```bash
git clone https://github.com/mutukulamahesh/aiqa-mvp.git
cd aiqa-mvp
npm install
npx playwright install
```

The `aiqa` CLI is available immediately after install — no build step required:

```bash
npx aiqa --help          # run via npx (always works)

npm link                 # optional: install globally so you can type just:
aiqa --help              # aiqa <command> anywhere
```

All examples below use `npx aiqa`. If you've run `npm link`, drop the `npx` prefix.

---

## Quickstart — test any app in 4 commands

```bash
npx aiqa init myproject
npx aiqa explore https://yourapp.com --out myproject
npx aiqa generate --out myproject --per-page
npx aiqa run-all --out myproject --headless
```

This creates a complete project folder:

```
myproject/
  exploration.json          ← live page map from the crawl
  tests/
    page_home.yaml          ← one test file per discovered page
    page_about.yaml
    page_contact.yaml
  results/
    run-2026-01-15T10-30-45.json   ← auto-saved after every run
    report.html                    ← HTML report auto-saved after every run
  screenshots/
    step-3-fail.png         ← captured automatically on any step failure
```

---

## CLI Reference

### `aiqa init <project>` — Create a project workspace

```bash
npx aiqa init myproject
```

Creates the folder structure (`tests/`, `results/`, `screenshots/`) and a starter `tests/sample.yaml`.

---

### `aiqa explore <url>` — Crawl an application

Navigates the app, maps all pages, forms, buttons, and internal links into a structured JSON file.

```bash
npx aiqa explore https://yourapp.com --out myproject --max-pages 20
npx aiqa explore https://yourapp.com --output exploration.json
```

Options:
- `--out <folder>` — project folder; saves to `<folder>/exploration.json`
- `--output <file>` — explicit output file path
- `--max-pages <n>` — maximum pages to crawl (default: 10)

---

### `aiqa generate [exploration]` — Generate test scenarios

Reads an exploration file, identifies user flows or individual pages, and generates ready-to-run YAML test files.

```bash
npx aiqa generate --out myproject --per-page
npx aiqa generate --out myproject
npx aiqa generate exploration.json --output tests/
```

Options:
- `--out <folder>` — project folder; reads `<folder>/exploration.json`, writes to `<folder>/tests/`
- `--output <dir>` — explicit output directory
- `--per-page` — one test file per discovered page instead of per flow
- `--jira <projectKey>` — also pull mock Jira stories and generate scenarios

---

### `aiqa import --file <path>` — Import existing test cases

Converts CSV, Excel (.xlsx), or Gherkin (.feature) test cases into AIQA YAML format. Handles structured files directly; falls back to LLM translation for free-form text.

```bash
npx aiqa import --file tests/cases.csv --out myproject
npx aiqa import --file tests/cases.xlsx --out myproject
npx aiqa import --file tests/login.feature --out myproject
npx aiqa import --file tests/cases.csv --run --headless   # import and run immediately
```

Options:
- `--file <path>` — input file (CSV, XLSX, or .feature)
- `--out <folder>` — output project folder
- `--run` — execute imported tests immediately after conversion
- `--headless` — headless mode when used with `--run`

Output:
```
   ✔ Imported 6 test case(s) from cases.csv
   ✔ Saved → myproject/tests/imported_cases.yaml
```

---

### `aiqa run <file>` — Run a single test file

```bash
npx aiqa run tests/example.yaml --headless
npx aiqa run tests/example.yaml --out myproject --headless
```

Options:
- `--headless` — run browser in headless mode (required in CI / no display)
- `--out <folder>` — saves screenshots, results JSON, and HTML report into the project folder
- `--report <file>` — explicit HTML report output path

On failure the DebuggerAgent automatically classifies the error, suggests a fix, and captures a screenshot:
```
✗ FAILED: assertTextVisible: text "Submit" not found on page
🔍 [locator_failure] Check that the selector matches what is rendered.
📸 Screenshot → myproject/screenshots/step-3-fail.png
```

---

### `aiqa run-all [dir]` — Run all tests in a directory

```bash
npx aiqa run-all --out myproject --headless
npx aiqa run-all myproject/tests/ --headless --report myproject/results/report.html
```

Options:
- `--out <folder>` — project folder; runs `<folder>/tests/`, saves results + HTML to `<folder>/results/`
- `--headless` — run browser in headless mode
- `--report <file>` — explicit HTML report output path
- `--results <file>` — explicit JSON results output path
- `--base-url <url>` — base URL shown in the report header

---

### `aiqa orchestrate --url <url>` — Full pipeline in one command

Runs the complete pipeline: Explore → Map flows → Generate scenarios → Run tests → Score readiness.

```bash
npx aiqa orchestrate --url https://yourapp.com --headless
npx aiqa orchestrate --url https://yourapp.com --dry-run
npx aiqa orchestrate --url https://yourapp.com --out myproject
```

Options:
- `--url <url>` — target application URL (required)
- `--headless` — run browser in headless mode
- `--dry-run` — generate scenarios but do not execute them
- `--out <folder>` — save `orchestrator-summary.json` to this folder
- `--max-pages <n>` — page crawl limit (default: 10)

Output:
```
[1/5] [Explorer] Exploring https://yourapp.com
[2/5] [FlowMapper] Mapping flows (4 pages found)
[3/5] [Generator] Generating scenarios (3 flows)
[4/5] [Runner] Running 3 valid scenario(s)
[5/5] [Scorer] Scoring readiness

   Status  : success
   Score   : 75/100 (C)
   Flows   : 3   Scenarios: 3   Passed: 2   Failed: 1
   Memory reuse: seeded selectors: 4  ·  heals avoided: 4

━━━ Healer Analytics ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LLM calls saved   : 4  (across 2 runs)
   ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### `aiqa score <results.json>` — Readiness scoring

```bash
npx aiqa score myproject/results/run-2026-01-15T10-30-45.json
```

Output:
```
📊 Readiness Report
   Score   : 88/100  (B)
   Tests   : 7/8 passed  (87%)
   Coverage: UI, Assertions
   Issues  : 1 test failed
```

---

## YAML Test Format

### Web automation

```yaml
test:
  name: "Login flow"
  variables:
    base_url: "https://yourapp.com"
  steps:
    - navigate: "{{ base_url }}/login"
    - fill:
        target: "email"
        value: "user@example.com"
    - fill:
        target: "password"
        value: "secret"
    - click: "Sign in"
    - assert:
        url: "dashboard"
    - assert:
        text: "Welcome back"
```

### API testing

```yaml
test:
  name: "User API — create and verify"
  steps:
    - api:
        method: POST
        url: "https://api.example.com/users"
        body:
          name: "Alice"
          email: "alice@example.com"
        assert_status: 201
        store_as: newUser
    - assert:
        value: "{{ newUser.email }}"
        equals: "alice@example.com"
```

### Database validation

```yaml
test:
  name: "User creation — API + DB verification"
  steps:
    - api:
        method: POST
        url: "{{ base_url }}/api/users"
        body: { name: "Alice", email: "alice@example.com" }
        assert_status: 201
        store_as: created

    - db:
        query: "SELECT * FROM users WHERE id = {{ created.id }}"
        assert_rows: 1
        assert_field:
          name: "Alice"
          email: "alice@example.com"
        store_as: dbUser

    - assert:
        value: "{{ dbUser.name }}"
        equals: "Alice"
```

DB steps execute against a real PostgreSQL database when `DB_URL` is set, or against an in-memory mock in CI. Writes are blocked by default (`db.readOnly: true`) — set `db.readOnly: false` in your environment config to allow them.

```bash
export DB_URL="postgresql://user:pass@localhost:5432/mydb"
npm install knex pg   # only required for real DB connections
```

### Supported step types

| Step | Description |
|---|---|
| `navigate: <url>` | Navigate to a URL |
| `click: <text>` | Click a button or link by visible text |
| `fill: { target, value }` | Fill an input field |
| `assert: { text }` | Assert text is visible on the page |
| `assert: { url }` | Assert current URL contains substring |
| `assert: { value, equals }` | Assert a stored variable equals expected |
| `api: { method, url, ... }` | Make an HTTP request, optionally store response |
| `db: { query, ... }` | Execute SQL, assert rows/fields, store results |

### Template variables

Use `{{ variable }}` anywhere in step values. Dot notation traverses stored objects:

```yaml
variables:
  base_url: "https://staging.example.com"

steps:
  - navigate: "{{ base_url }}/profile"
  - assert:
      value: "{{ user.address.city }}"
      equals: "London"
```

### Retries

```yaml
test:
  name: "Flaky login"
  retries: 2        # retry up to 2x on transient failures only
  steps:
    - navigate: "https://yourapp.com/login"
    - click: "Sign in"
```

Retries only trigger on transient errors (timeouts, network failures). Assertion failures never retry.

---

## Environment Configuration

AIQA uses per-environment YAML profiles for all runtime settings. The profile is selected via `--env` flag or `AIQA_ENV` env var (default: `dev`).

```bash
npx aiqa run-all --env staging --headless
```

```yaml
# config/environments/staging.yaml
environment: staging

urls:
  base: "https://staging.example.com"
  api:  "https://staging.example.com/api"

timeouts:
  action:     15000
  navigation: 45000
  api:        20000

execution:
  workers:        4
  retries:        2
  headless:       true
  circuitBreaker: 5     # abort suite after 5 consecutive failures

db:
  readOnly: true        # set false to allow INSERT/UPDATE/DELETE

llm:
  provider: anthropic
  fallback: [mock]
```

Three profiles are included: `dev.yaml`, `staging.yaml`, `prod.yaml`. All settings have sensible defaults — unknown keys are rejected at startup via Zod validation.

---

## LLM Integration

AIQA works out of the box without any API key and upgrades seamlessly when one is configured. Five providers are supported.

### Supported providers

| Provider | Env var | Notes |
|---|---|---|
| `mock` (default) | — | Rule-based, zero dependencies, always works |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude — `npm install @anthropic-ai/sdk` required |
| `openai` | `OPENAI_API_KEY` | GPT-4o-mini default |
| `nvidia` | `NVIDIA_API_KEY` | Free API at [build.nvidia.com](https://build.nvidia.com) — OpenAI-compatible |
| `gemini` | `GEMINI_API_KEY` | Gemini 2.0 Flash default |

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm install @anthropic-ai/sdk
```

No code changes required — the factory auto-detects whichever key is present (priority: Anthropic → OpenAI → NVIDIA → Gemini → mock).

### Fallback chains

```yaml
llm:
  provider: anthropic
  fallback: [openai, mock]   # tried in order if primary fails
```

Transient failures (rate limits, server errors) advance to the next provider automatically.

---

## Project Structure

```
config/
  environments/
    dev.yaml              ← development profile
    staging.yaml          ← staging profile
    prod.yaml             ← production profile

src/
  cli.ts                  ← CLI entry point (all commands)
  errors.ts               ← AssertionError, TransientError
  dsl/
    types.ts              ← DSL type definitions
    DslParser.ts          ← YAML → TestDefinition parser
  execution/
    ExecutionContext.ts   ← Runtime variable store + template resolver
    StepInterpreter.ts   ← Routes steps to handlers; owns DB teardown
    HandlerRegistry.ts   ← Handler registration and lookup
    APIExecutor.ts        ← HTTP fetch wrapper with timeout + abort
    WorkerContext.ts      ← AsyncLocalStorage log buffering (parallel safety)
  handlers/
    UIActionHandler.ts   ← navigate, click, fill
    AssertionHandler.ts  ← assert (text, url, equals)
    APIActionHandler.ts  ← api step execution
    DBActionHandler.ts   ← db step — query, assert_rows, assert_field, store_as
  adapter/
    AdapterActions.ts    ← Browser adapter interface
    PlaywrightAdapter.ts ← Playwright + transparent selector healing
  db/
    DBAdapter.ts          ← DBAdapter interface + QueryResult type
    DBAdapterFactory.ts   ← Auto-selects Mock (CI) or Knex (DB_URL set)
    MockDBAdapter.ts      ← Seedable in-memory adapter for unit tests
    KnexDBAdapter.ts      ← PostgreSQL via Knex (optional, requires knex pg)
  runner/
    TestRunner.ts         ← End-to-end orchestration, retry, circuit breaker
  reporters/
    HTMLReporter.ts       ← Self-contained HTML report generator
  config/
    ConfigLoader.ts       ← Zod-validated YAML config loader + secret checks
  llm/
    LLMProvider.ts        ← Interface + createLLMProvider() factory
    MockLLMProvider.ts    ← Rule-based, no API key needed
    AnthropicLLMProvider.ts
    OpenAILLMProvider.ts  ← Also used for NVIDIA (OpenAI-compatible)
    GeminiLLMProvider.ts
    FallbackLLMProvider.ts ← Provider chain with retryable-error classification
  agents/
    OrchestratorAgent.ts  ← Full pipeline: Explorer → FlowMapper → Generator → Runner → Scorer
    DebuggerAgent.ts      ← Failure classification + fix suggestions (memory-backed)
    AppExplorer.ts        ← Playwright-based app crawler
    FlowMapper.ts         ← Flow identification + healer-seeded step generation
    ScenarioGenerator.ts  ← Flow → YAML test file generator
    ReadinessScorer.ts    ← 0–100 readiness score
  healer/
    SelectorHealer.ts     ← LLM-powered locator repair, semantic scoring, visibility guard
    HealerCache.ts        ← Persisted selector store — confidence, score decay, lifecycle
    HealerAnalytics.ts    ← Unstable pages, healed selectors, flakiest steps, LLM savings
    contextKey.ts         ← SPA context fingerprint (SHA-256 of page title + headings)
  memory/
    MemoryStore.ts        ← Cross-run flakiness scores + known-pattern cache
    types.ts              ← KnownPattern, StepMemory, MemoryData
  importers/
    CSVImporter.ts
    ExcelImporter.ts
    TextImporter.ts       ← Gherkin + free-text
    TestCaseTranslator.ts ← LLM-based translation to AIQA YAML
    ImportOrchestrator.ts ← Selects importer by file type, runs translation
  integrations/
    JiraAdapter.ts        ← Jira story → flow converter

.aiqa/
  healer-cache.json       ← Persisted healer selector store (auto-created)
  healer-runs.json        ← Run history for analytics (auto-created)

tests/
  saucedemo/              ← End-to-end YAML examples (Sauce Demo app)
  db/                     ← DB handler unit tests
  config/                 ← Config schema unit tests
  healer/                 ← Healer + analytics unit tests
  agents/                 ← FlowMapper + Orchestrator unit tests
  importer/               ← CSV/Excel/Gherkin importer unit tests
  llm/                    ← LLM provider unit tests
  memory/                 ← Memory store unit tests
```

---

## Technologies

- [TypeScript](https://www.typescriptlang.org/)
- [Playwright](https://playwright.dev/) — web automation, app crawling, screenshots
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML test file parsing
- [Zod](https://zod.dev/) — config schema validation
- [Commander.js](https://github.com/tj/commander.js) — CLI interface
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel test case import
- [Knex](https://knexjs.org/) *(optional)* — PostgreSQL adapter; install with `npm install knex pg`

---

## License

MIT
