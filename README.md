# AIQA — Enterprise AI QA Platform

A plug-and-play, AI-powered QA platform that unifies web automation, API testing, and autonomous test generation into a single config-driven system.

> Full platform vision: see [VISION.md](VISION.md)

---

## What it does

- **Init a project** in one command — folder structure, sample test, ready to run
- **Explore any app** autonomously and map its pages and flows
- **Generate test files** per page or per flow — no manual test writing
- **Run tests** defined in YAML — web UI, API, or mixed
- **Orchestrate the full pipeline** — one command: explore → map → generate → run → score
- **Self-heal broken selectors** — when a locator fails, AIQA repairs it via LLM and caches the fix
- **Analytics after every run** — top unstable pages, most healed selectors, LLM calls saved
- **Diagnose failures** automatically with AI root-cause analysis and screenshots
- **Score readiness** — get a 0–100 grade on your test coverage
- **HTML reports** generated automatically after every run
- **Plug in real LLM** (Claude) at any time — no code changes needed

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

---

## Quickstart — test any app in 4 commands

```bash
npx ts-node src/cli.ts init myproject
npx ts-node src/cli.ts explore https://yourapp.com --out myproject
npx ts-node src/cli.ts generate --out myproject --per-page
npx ts-node src/cli.ts run-all --out myproject --headless
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
npx ts-node src/cli.ts init myproject
```

Creates the folder structure (`tests/`, `results/`, `screenshots/`) and a starter `tests/sample.yaml`.

---

### `aiqa explore <url>` — Crawl an application

Navigates the app, maps all pages, forms, buttons, and internal links into a structured JSON file.

```bash
# Save into a project folder
npx ts-node src/cli.ts explore https://yourapp.com --out myproject --max-pages 20

# Or save to an explicit path
npx ts-node src/cli.ts explore https://yourapp.com --output exploration.json
```

Options:
- `--out <folder>` — project folder; saves to `<folder>/exploration.json`
- `--output <file>` — explicit output file path
- `--max-pages <n>` — maximum pages to crawl (default: 10)

Output:
```
✅ Explored 5 page(s), 17 internal link(s)
   • https://yourapp.com          — Home
   • https://yourapp.com/about    — About
   • https://yourapp.com/contact  — Contact

   Saved → myproject/exploration.json
```

---

### `aiqa generate [exploration]` — Generate test scenarios

Reads an exploration file, identifies user flows or individual pages, and generates ready-to-run YAML test files.

```bash
# Generate one test per page (recommended for new projects)
npx ts-node src/cli.ts generate --out myproject --per-page

# Generate one test per flow (auth, forms, navigation)
npx ts-node src/cli.ts generate --out myproject

# Explicit paths
npx ts-node src/cli.ts generate exploration.json --output tests/
```

Options:
- `--out <folder>` — project folder; reads `<folder>/exploration.json`, writes to `<folder>/tests/`
- `--output <dir>` — explicit output directory
- `--per-page` — one test file per discovered page instead of per flow
- `--jira <projectKey>` — also pull mock Jira stories and generate scenarios

Output:
```
   ✔ page_home.yaml      [navigation]
   ✔ page_about.yaml     [navigation]
   ✔ page_contact.yaml   [navigation]

✅ Generated 3 scenario(s) → myproject/tests/
```

---

### `aiqa run <file>` — Run a single test file

```bash
npx ts-node src/cli.ts run tests/example.yaml --headless
npx ts-node src/cli.ts run tests/example.yaml --out myproject --headless
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
# Using project folder (recommended)
npx ts-node src/cli.ts run-all --out myproject --headless

# Explicit directory
npx ts-node src/cli.ts run-all myproject/tests/ --headless --report myproject/results/report.html
```

Options:
- `--out <folder>` — project folder; runs `<folder>/tests/`, saves results + HTML to `<folder>/results/`
- `--headless` — run browser in headless mode
- `--report <file>` — explicit HTML report output path
- `--results <file>` — explicit JSON results output path
- `--base-url <url>` — base URL shown in the report header

Output:
```
   Ran   : 4 test(s)
   Passed: 4   Failed: 0
   JSON  → myproject/results/run-2026-01-15T10-30-45.json
   HTML  → myproject/results/report.html
```

---

### `aiqa orchestrate --url <url>` — Full pipeline in one command

Runs the complete pipeline: Explore → Map flows → Generate scenarios → Run tests → Score readiness.

```bash
npx ts-node src/cli.ts orchestrate --url https://yourapp.com --headless
npx ts-node src/cli.ts orchestrate --url https://yourapp.com --dry-run   # generate only, skip execution
npx ts-node src/cli.ts orchestrate --url https://yourapp.com --out myproject
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

On the first run the healer cache is cold. From run 2 onward, previously healed selectors are reused directly and the analytics block appears.

---

### `aiqa score <results.json>` — Readiness scoring

Computes a 0–100 readiness score from saved test results.

```bash
npx ts-node src/cli.ts score myproject/results/run-2026-01-15T10-30-45.json
```

Output:
```
📊 Readiness Report
   Score   : 88/100  (B)
   Tests   : 7/8 passed  (87%)
   Coverage: UI, Assertions
   Issues  : 1 test failed

   Good coverage. Address failing tests before releasing.
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
  name: "User API — fetch and assert"
  steps:
    - api:
        method: GET
        url: "https://api.example.com/users/1"
        assert_status: 200
        store_as: user
    - assert:
        value: "{{ user.name }}"
        equals: "Alice"
    - api:
        method: POST
        url: "https://api.example.com/posts"
        body:
          title: "Test post"
          userId: 1
        assert_status: 201
        store_as: post
    - assert:
        value: "{{ post.title }}"
        equals: "Test post"
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

---

## LLM Integration

AIQA works out of the box without any API key and upgrades seamlessly to a real provider when one is configured. Five providers are supported — pick whichever you have access to.

### Supported providers

| Provider | Env var | Notes |
|---|---|---|
| `mock` (default) | — | Rule-based, zero dependencies, always works |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude — `npm install @anthropic-ai/sdk` required |
| `openai` | `OPENAI_API_KEY` | GPT-4o-mini default |
| `nvidia` | `NVIDIA_API_KEY` | Free API at [build.nvidia.com](https://build.nvidia.com) — OpenAI-compatible |
| `gemini` | `GEMINI_API_KEY` | Gemini 2.0 Flash default |

### Quick start

```bash
# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
npm install @anthropic-ai/sdk

# OpenAI
export OPENAI_API_KEY="sk-..."

# NVIDIA (free tier available)
export NVIDIA_API_KEY="nvapi-..."

# Gemini
export GEMINI_API_KEY="AIza..."
```

No code changes required — the factory auto-detects whichever key is present (priority: Anthropic → OpenAI → NVIDIA → Gemini → mock).

### Configuring via YAML environment profile

```yaml
# config/environments/prod.yaml
llm:
  provider: anthropic
  fallback: [openai, mock]   # tried in order if primary fails
  model: claude-opus-4-7     # optional — overrides provider default
```

### Fallback chains

Set `LLM_FALLBACK` or configure `fallback:` in the YAML profile to build a resilience chain:

```bash
export LLM_PROVIDER=anthropic
export LLM_FALLBACK=openai,mock
```

- Transient failures (rate limits, server errors) advance to the next provider
- Non-retryable failures (invalid API key, bad request) fail immediately
- A warning is logged whenever a fallback provider is activated

---

## Project Structure

```
src/
  cli.ts                        # CLI entry point (all commands)
  dsl/
    types.ts                    # DSL type definitions
    DslParser.ts                # YAML → TestDefinition parser
  execution/
    ExecutionContext.ts          # Runtime variable store + template resolver
    StepInterpreter.ts          # Thin orchestrator — routes steps to handlers
    HandlerRegistry.ts          # Handler registration and lookup
    APIExecutor.ts              # HTTP fetch wrapper with timeout + abort
  handlers/
    UIActionHandler.ts          # navigate, click, fill
    AssertionHandler.ts         # assert (text, url, equals)
    APIActionHandler.ts         # api step execution
  adapter/
    AdapterActions.ts           # Browser adapter interface (includes screenshot)
    PlaywrightAdapter.ts        # Playwright implementation + transparent selector healing
  runner/
    TestRunner.ts               # End-to-end test orchestration, retry, circuit breaker
  reporters/
    HTMLReporter.ts             # Self-contained HTML report generator
  llm/
    LLMProvider.ts              # Interface, types, createLLMProvider() factory
    MockLLMProvider.ts          # Rule-based, no API key needed
    AnthropicLLMProvider.ts     # Claude (requires @anthropic-ai/sdk)
    OpenAILLMProvider.ts        # OpenAI + NVIDIA (fetch-based, no extra deps)
    GeminiLLMProvider.ts        # Google Gemini (fetch-based, no extra deps)
    FallbackLLMProvider.ts      # Chains providers; retryable-error classification; degradation warning
  agents/
    OrchestratorAgent.ts        # Full pipeline coordinator: Explorer → FlowMapper → Generator → Runner → Scorer
    DebuggerAgent.ts            # Failure classification + fix suggestions (memory-backed)
    AppExplorer.ts              # Playwright-based app crawler
    FlowMapper.ts               # Flow identification + healer-seeded step generation
    ScenarioGenerator.ts        # Flow → YAML test file generator
    ReadinessScorer.ts          # 0–100 readiness score
  healer/
    SelectorHealer.ts           # LLM-powered locator repair with semantic scoring + visibility guard
    HealerCache.ts              # Persisted selector store — confidence, score decay, lifecycle state
    HealerAnalytics.ts          # Analytics: unstable pages, healed selectors, flakiest steps, LLM savings
    contextKey.ts               # SPA context fingerprint — SHA-256 of page title + headings
  memory/
    MemoryStore.ts              # Cross-run flakiness scores + known-pattern cache
    types.ts                    # KnownPattern, StepMemory, MemoryData
  integrations/
    JiraAdapter.ts              # Jira story → flow converter (mock + stub)

.aiqa/
  healer-cache.json             # Persisted healer selector store (created on first heal)
  healer-runs.json              # Run history for analytics (created after first orchestrate run)

tests/
  example.yaml                  # Web automation example
  api_example.yaml              # API testing example
```

---

## Building for production

```bash
npm run build        # compile TypeScript → dist/
```

---

## Technologies

- [TypeScript](https://www.typescriptlang.org/)
- [Playwright](https://playwright.dev/) — web automation, app crawling, and screenshots
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML test file parsing
- [Commander.js](https://github.com/tj/commander.js) — CLI interface

---

## License

MIT
