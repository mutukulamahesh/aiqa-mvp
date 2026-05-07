# AIQA — Enterprise AI QA Platform

> One YAML file. Any stack. Web, API, database, and AI — tested end-to-end.

AIQA is a plug-and-play, AI-powered test automation platform. Write tests in a simple YAML DSL, run them locally or in CI, and let the platform autonomously explore your app, generate test suites, heal broken selectors, and score your release readiness — all without changing a line of code.

---

## What makes AIQA different

| Feature | AIQA | Traditional tools |
|---|---|---|
| Test authoring | YAML — readable by anyone | Code in Python/JS |
| Selector healing | Automatic via LLM | Manual fix required |
| Test generation | Autonomous from live app crawl | Manual |
| AI response validation | Built-in `judge:` step | None |
| DB + API + UI in one file | Yes | Separate tools |
| Works without API key | Yes (mock LLM) | N/A |

---

## Prerequisites

- Node.js v18 or higher
- npm

```bash
git clone https://github.com/mutukulamahesh/aiqa-mvp.git
cd aiqa-mvp
npm install
npx playwright install chromium
```

Run the environment check:

```bash
npx ts-node src/cli.ts doctor
```

---

## Quickstart — test any app in 4 commands

```bash
npx ts-node src/cli.ts init myproject
npx ts-node src/cli.ts explore https://yourapp.com --out myproject
npx ts-node src/cli.ts generate --out myproject --per-page
npx ts-node src/cli.ts run-all --out myproject --headless
```

Or run the entire pipeline in a single command:

```bash
npx ts-node src/cli.ts orchestrate --url https://yourapp.com --out myproject --headless
```

---

## Full Platform Demo

[`tests/demo/full-demo.yaml`](tests/demo/full-demo.yaml) exercises every step type in one test — no server setup required.

```bash
# No API key needed — uses mock LLM
npx ts-node src/cli.ts run tests/demo/full-demo.yaml --headless

# With a real LLM judge
ANTHROPIC_API_KEY=sk-ant-... npx ts-node src/cli.ts run tests/demo/full-demo.yaml --headless
```

What the demo covers: API GET/POST · LLM judge · conditional branching · loop over API list · login form fill · wait/store/assert · DB stub

---

## YAML Test Format

Every test is a `.yaml` file. The header sets metadata; the `steps` list runs in order.

```yaml
test:
  name: "My test"
  tags: [smoke, regression]
  retries: 2                   # retry on transient failures only
  variables:
    base_url: "https://staging.example.com"

  steps:
    - navigate: "{{ base_url }}"
    - assert:
        text: "Welcome"
```

Use `{{ variable }}` anywhere in step values. Dot notation traverses stored objects: `{{ user.address.city }}`.

---

## Step Reference

### Web UI

**`navigate`** — go to a URL

```yaml
- navigate: "https://example.com"
- navigate: "{{ base_url }}/login"
```

**`click`** — click by visible text or CSS selector

```yaml
- click: "Sign in"
- click: "#submit-btn"
```

**`fill`** — type into an input field

```yaml
- fill:
    target: "#email"
    value:  "user@example.com"
- fill:
    target: "Password"
    value:  "{{ env_password }}"
```

**`store`** — capture element text (or attribute) into a named variable

```yaml
- store:
    selector:  ".order-id"
    as:        order_id
- store:
    selector:  "img.avatar"
    attribute: "src"
    as:        avatar_url
```

---

### Assertions

All four assertion kinds resolve template variables before comparing.

**`assert: text`** — text is visible anywhere on the page

```yaml
- assert:
    text: "Order confirmed"
```

**`assert: url`** — current URL contains substring

```yaml
- assert:
    url: "dashboard"
```

**`assert: visible`** — element exists in DOM

```yaml
- assert:
    visible: ".success-banner"
```

**`assert: value + equals`** — stored/template value equals expected

```yaml
- assert:
    value:  "{{ user.name }}"
    equals: "Alice"
- assert:
    value:  "{{ page_title }}"
    equals: "Products"
```

---

### API Testing

**`api`** — make an HTTP request, optionally assert status and store the response

```yaml
# GET with status check + store
- api:
    method: GET
    url: "https://api.example.com/users/1"
    assert_status: 200
    store_as: user

# Use stored fields in later steps
- assert:
    value:  "{{ user.name }}"
    equals: "Alice"

# POST with body
- api:
    method: POST
    url: "https://api.example.com/orders"
    headers:
      Authorization: "Bearer {{ token }}"
    body:
      product_id: 42
      quantity:   1
    assert_status: 201
    store_as: order
```

Supported methods: GET · POST · PUT · PATCH · DELETE · HEAD

---

### Database Testing

**`db`** — run a SQL query (PostgreSQL). Requires `db_schema` in your environment config.

```yaml
# Assert row count
- db:
    query:       "SELECT * FROM users WHERE active = true"
    assert_rows: 10

# Assert a specific field value
- db:
    query: "SELECT status FROM orders WHERE id = 1"
    assert_field:
      status: "completed"

# Parameterised query + store result
- db:
    query:    "SELECT id, name FROM products WHERE category = $1"
    params:   ["electronics"]
    store_as: products

- assert:
    value:  "{{ products[0].name }}"
    equals: "Laptop Pro"
```

Configure the connection in your environment YAML:

```yaml
# config/environments/dev.yaml
db_schema:
  host:     localhost
  port:     5432
  database: myapp
  user:     postgres
  password: postgres
```

---

### Wait Steps

**`wait_for_element`** — wait until a CSS selector is visible (optional per-step timeout)

```yaml
- wait_for_element: "#submit"
- wait_for_element:
    selector: ".spinner"
    timeout:  10000        # ms — overrides global default
```

**`wait_ms`** — fixed pause in milliseconds

```yaml
- wait_ms: 500
```

**`wait_for_url`** — wait until the current URL contains a substring

```yaml
- wait_for_url: "dashboard"
- wait_for_url: "/checkout/confirmation"
```

---

### Flow Control

**`if`** — run sub-steps only when a variable equals a value

```yaml
- if:
    variable: "user.role"
    equals:   "admin"
    steps:
      - assert:
          text: "Admin Panel"
      - click: "Manage Users"
```

**`for_each`** — iterate over a stored array, exposing each item as a loop variable

```yaml
# First store a list (e.g. from an API call)
- api:
    method:   GET
    url:      "https://api.example.com/orders"
    store_as: orders

# Then iterate
- for_each:
    over: "orders"
    as:   "order"
    steps:
      - assert:
          value:  "{{ order.status }}"
          equals: "completed"
```

Maximum 100 iterations per loop. Nested loops are supported (depth guard prevents infinite recursion).

---

### LLM Judge

**`judge`** — ask an LLM to score a value against natural-language criteria (0.0–1.0). The verdict is **always computed deterministically** from `pass_if` — it is never delegated to the LLM.

```yaml
- judge:
    value:    "{{ api_response.summary }}"
    prompt:   "Does this summary accurately describe a product without hallucinations? Score high for factual, concise text."
    pass_if:  "score >= 0.7"
    store_as: summary_score

# The score, verdict, and reason are all stored
- assert:
    value:  "{{ summary_score.verdict }}"
    equals: "pass"
```

`pass_if` operators: `>=` · `<=` · `>` · `<`

Score is normalised to 3 decimal places. Input longer than 5 000 characters is truncated automatically (LLM is notified). Empty input throws immediately without calling the LLM.

Works with the built-in mock LLM (no API key) and upgrades automatically when a provider key is set.

---

## CLI Reference

| Command | Description |
|---|---|
| `init <project>` | Scaffold workspace: `tests/`, `results/`, `screenshots/` |
| `doctor` | Check Node, Playwright, API keys |
| `explore <url>` | Crawl app → `exploration.json` |
| `generate` | Turn exploration into YAML test files |
| `run <file>` | Run a single YAML test |
| `run-all [dir]` | Run every YAML in a directory |
| `orchestrate` | Full pipeline: explore → map → generate → run → score |
| `import --file` | Import from Excel / CSV / text → YAML |
| `score <results>` | Compute 0–100 readiness grade |
| `help` | Quick-start guide |

### Key flags

```bash
# Environment
npx ts-node src/cli.ts run-all --out myproject --env staging

# Parallelism
npx ts-node src/cli.ts run-all --out myproject --workers 4

# Tag filtering
npx ts-node src/cli.ts run-all --out myproject --tags smoke,regression

# Circuit breaker: abort after 3 consecutive failures
npx ts-node src/cli.ts run-all --out myproject --circuit-breaker 3

# Orchestrate without running tests (explore + generate only)
npx ts-node src/cli.ts orchestrate --url https://yourapp.com --dry-run

# Import external test cases
npx ts-node src/cli.ts import --file test-cases.xlsx --out myproject --run
```

---

## LLM Integration

AIQA works out of the box with **no API key** (rule-based mock). Set any key to enable real AI.

### Supported providers

| Provider | Env var | Notes |
|---|---|---|
| `mock` (default) | — | Rule-based, zero dependencies, always works |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude — `npm install @anthropic-ai/sdk` |
| `openai` | `OPENAI_API_KEY` | GPT-4o-mini default |
| `nvidia` | `NVIDIA_API_KEY` | Free tier at build.nvidia.com — OpenAI-compatible |
| `gemini` | `GEMINI_API_KEY` | Gemini 2.0 Flash |

The factory auto-detects whichever key is present (priority: Anthropic → OpenAI → NVIDIA → Gemini → mock). No code changes required.

### Fallback chains

```yaml
# config/environments/prod.yaml
llm:
  provider: anthropic
  fallback:  [openai, mock]    # tried in order if primary fails
  model: claude-opus-4-7       # optional — overrides provider default
```

```bash
# Or via env vars
export LLM_PROVIDER=anthropic
export LLM_FALLBACK=openai,mock
```

Transient failures (rate limits, server errors) advance to the next provider. Non-retryable errors (bad API key, malformed request) fail immediately. A warning is logged whenever a fallback activates.

---

## Configuration

Environment profiles let you target dev / staging / prod without changing test files.

```yaml
# config/environments/staging.yaml
environment: staging

urls:
  base: "https://staging.example.com"
  api:  "https://api.staging.example.com"

execution:
  headless:       true
  workers:        4
  maxPages:       20
  circuitBreaker: 5

timeouts:
  action:     10000
  navigation: 30000

llm:
  provider: anthropic
  fallback:  [mock]

db_schema:
  host:     staging-db.internal
  port:     5432
  database: app_staging
  user:     qa_user
  password: "${DB_PASSWORD}"    # injected from .env
```

Use `--env staging` on any command. Secret values are read from `.env` at startup. Missing secrets print a warning but do not abort the run.

---

## Resilience

### Retry

Add `retries:` to any test. Only transient failures (timeout, locator not found) are retried — assertion failures are not.

```yaml
test:
  name: "Flaky login flow"
  retries: 3
  steps:
    - navigate: "..."
```

### Circuit breaker

Stop burning CI minutes when the app is clearly broken.

```bash
npx ts-node src/cli.ts run-all --out myproject --circuit-breaker 5
```

After 5 consecutive failures the suite aborts. Remaining tests are marked skipped.

### Parallel workers

```bash
npx ts-node src/cli.ts run-all --out myproject --workers 8
```

Each worker gets its own isolated browser context — no shared state, no race conditions.

### Depth guard

`if` and `for_each` blocks are protected against infinite recursion. The engine enforces a maximum nesting depth and throws a clear error before the stack overflows.

---

## Intelligence Layer

### Self-Healing Selectors

When a locator fails, the `SelectorHealer` tries four repair strategies in order:

1. Text match — find element by visible text
2. Role match — find by ARIA role
3. Semantic match — LLM suggests an equivalent selector
4. CSS fallback — best-effort structural match

Healed selectors are stored in `.aiqa/healer-cache.json` with confidence scores. On the next run they are reused immediately, saving an LLM call.

### Memory Store

Tracks per-step flakiness across runs. Steps that fail repeatedly get a longer retry wait automatically. The memory report is printed after every `run-all`:

```
━━━ Memory Report ━━━
  Known patterns  : 12
  Flaky steps     : 3
  Avg wait boost  : +800ms on flaky steps
━━━━━━━━━━━━━━━━━━━━━
```

### Healer Analytics

After every `orchestrate` run:

```
━━━ Healer Analytics ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  LLM calls saved   : 8  (across 3 runs)
  Top unstable page : /checkout  (4 heals)
  Most healed       : #submit-btn  (3 times)
  Flakiest step     : click "Confirm" on /checkout
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### LLM Judge

The `judge:` step embeds AI evaluation directly into your test suite. Useful for:

- Validating AI-generated content for hallucinations
- Scoring response quality against acceptance criteria
- Asserting tone, completeness, or factual accuracy

The score comes from the LLM; the pass/fail verdict is always computed deterministically from your `pass_if` expression.

---

## Test Importer

Import existing test cases from any format and run them immediately.

```bash
# From Excel
npx ts-node src/cli.ts import --file test-cases.xlsx --out myproject --run

# From CSV
npx ts-node src/cli.ts import --file test-cases.csv --tags smoke --out myproject

# From Gherkin / plain text
npx ts-node src/cli.ts import --file features/login.feature --out myproject

# Save import report
npx ts-node src/cli.ts import --file tests.csv --out myproject --report
```

Supported formats: `.xlsx` · `.xls` · `.csv` · `.feature` · `.txt`

---

## HTML Reports

Every `run`, `run-all`, `orchestrate`, and `import --run` generates a self-contained HTML report.

```bash
npx ts-node src/cli.ts run tests/demo/full-demo.yaml --out myproject
# → myproject/results/report.html
```

The report includes: pass/fail per test · step-level error messages · screenshots on failure · healer and memory summaries.

---

## CI / CD

A ready-to-use GitHub Actions workflow is included.

```yaml
# .github/workflows/aiqa.yml (already in this repo)
on:
  push:
    branches: [main, phase*]
  schedule:
    - cron: "0 2 * * *"    # nightly

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - uses: actions/upload-artifact@v4
        with:
          name: aiqa-results
          path: results/
```

---

## Project Structure

```
src/
  cli.ts                    CLI entry point (all commands)
  config/
    ConfigLoader.ts         Zod-validated YAML environment loader + dotenv
  dsl/
    types.ts                All 13 step type definitions
    DslParser.ts            YAML → TestDefinition parser
  execution/
    ExecutionContext.ts     Runtime variable store + {{ template }} resolver
    StepInterpreter.ts      Routes steps to handlers
    HandlerRegistry.ts      Handler registration and lookup
    APIExecutor.ts          HTTP fetch wrapper with timeout + abort
    DepthGuard.ts           Recursion depth limiter for if/for_each
    WorkerContext.ts        AsyncLocalStorage log buffering (parallel isolation)
  handlers/
    UIActionHandler.ts      navigate · click · fill
    AssertionHandler.ts     assert (text · url · visible · equals)
    APIActionHandler.ts     api step
    DBActionHandler.ts      db step (Knex, PostgreSQL)
    WaitHandler.ts          wait_for_element · wait_ms · wait_for_url
    StoreHandler.ts         store (element text/attribute capture)
    ConditionHandler.ts     if branching
    LoopHandler.ts          for_each (max 100 iterations, depth guard)
    JudgeHandler.ts         judge (LLM scoring, deterministic pass_if)
  adapter/
    AdapterActions.ts       Browser adapter interface
    PlaywrightAdapter.ts    Playwright impl + transparent selector healing
  runner/
    TestRunner.ts           End-to-end orchestration, retry, circuit breaker
  reporters/
    HTMLReporter.ts         Self-contained HTML report generator
  llm/
    LLMProvider.ts          Interface + createLLMProvider() factory
    MockLLMProvider.ts      Rule-based mock (no API key)
    AnthropicLLMProvider.ts Claude
    OpenAILLMProvider.ts    OpenAI + NVIDIA (fetch-based, no extra deps)
    GeminiLLMProvider.ts    Google Gemini (fetch-based, no extra deps)
    FallbackLLMProvider.ts  Provider chain with retryable-error classification
  agents/
    OrchestratorAgent.ts    Full pipeline coordinator
    AppExplorer.ts          Playwright-based BFS app crawler
    FlowMapper.ts           Page → user flow mapper (healer-seeded steps)
    ScenarioGenerator.ts    Flow → valid YAML test generator
    DebuggerAgent.ts        LLM failure classification + fix suggestions
    ReadinessScorer.ts      0–100 readiness score with grade + recommendations
  healer/
    SelectorHealer.ts       4-strategy LLM repair: text → role → semantic → CSS
    HealerCache.ts          Persisted selector store with confidence scores
    HealerAnalytics.ts      Unstable pages, healed selectors, LLM savings report
    contextKey.ts           SPA fingerprint (SHA-256 of title + headings)
  memory/
    MemoryStore.ts          Cross-run flakiness scores + known-pattern cache
    types.ts                KnownPattern · StepMemory · MemoryData
  db/
    DBAdapter.ts            DB adapter interface
    KnexDBAdapter.ts        PostgreSQL implementation via Knex
    MockDBAdapter.ts        In-memory mock for testing
    DBAdapterFactory.ts     Selects real or mock based on config
  importers/
    ExcelImporter.ts        .xlsx/.xls → TestCase[]
    CSVImporter.ts          .csv → TestCase[]
    TextImporter.ts         .feature/.txt → TestCase[]
    TestCaseTranslator.ts   TestCase → YAML DSL
    ImportOrchestrator.ts   Coordinates all importers, validates output
  integrations/
    JiraAdapter.ts          Jira story → flow converter (mock + stub)

tests/
  demo/
    full-demo.yaml          All 13 step types — runs without a server
  example.yaml              Simple web UI example
  api_example.yaml          API testing example
  saucedemo/                Login, checkout, add-to-cart flows
  flow-control/             wait, store, if, for_each tests
  judge/                    LLM judge tests (61 unit tests)

config/
  environments/
    dev.yaml                Local development profile
    staging.yaml            Staging profile
    prod.yaml               Production profile

.aiqa/
  healer-cache.json         Persisted healer selector store
  healer-runs.json          Run history for analytics
```

---

## Technologies

- [TypeScript](https://www.typescriptlang.org/)
- [Playwright](https://playwright.dev/) — browser automation, crawling, screenshots
- [Knex](https://knexjs.org/) — SQL query builder (PostgreSQL)
- [Zod](https://zod.dev/) — runtime schema validation
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML parsing
- [Commander.js](https://github.com/tj/commander.js) — CLI interface

---

## Platform Metrics

**16 test suites · 444 tests · 0 failures**

---

## License

MIT
