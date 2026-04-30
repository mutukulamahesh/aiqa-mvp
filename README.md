# AIQA — Enterprise AI QA Platform

A plug-and-play, AI-powered QA platform that unifies web automation, API testing, and autonomous test generation into a single config-driven system.

> Full platform vision: see [VISION.md](VISION.md)

---

## What it does

- **Run tests** defined in YAML — web UI, API, or mixed
- **Explore any app** autonomously and map its pages and flows
- **Generate test files** from the exploration — no manual test writing
- **Diagnose failures** automatically with AI-powered root-cause analysis
- **Score readiness** — get a 0–100 grade on your test coverage
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

## CLI Reference

### `aiqa run <file>` — Run a test file

```bash
npx ts-node src/cli.ts run tests/example.yaml --headless
npx ts-node src/cli.ts run tests/api_example.yaml
```

Options:
- `--headless` — run browser in headless mode (required in CI / no display)

On failure the DebuggerAgent automatically classifies the error and suggests a fix:
```
✗ FAILED: assertTextVisible: text "Submit" not found on page
🔍 [locator_failure] Check that the button/link text matches what is rendered.
```

---

### `aiqa explore <url>` — Crawl an application

Navigates the app, maps all pages, forms, buttons, and internal links into a structured JSON file.

```bash
npx ts-node src/cli.ts explore https://yourapp.com --max-pages 10 --output exploration.json
```

Options:
- `--max-pages <n>` — maximum pages to crawl (default: 10)
- `--output <file>` — output file path (default: `exploration.json`)

Output:
```
✅ Explored 6 page(s), 24 internal link(s)
   • https://yourapp.com          — Home
   • https://yourapp.com/login    — Login
   • https://yourapp.com/register — Register
```

---

### `aiqa generate <exploration.json>` — Generate test scenarios

Reads an exploration file, identifies user flows (auth, forms, navigation), and generates ready-to-run YAML test files.

```bash
npx ts-node src/cli.ts generate exploration.json --output generated/
```

Options:
- `--output <dir>` — output directory (default: `generated/`)
- `--jira <projectKey>` — also pull mock Jira stories and generate scenarios from them

Output:
```
   ✔ user_authentication.yaml     [authentication]
   ✔ user_registration.yaml       [form_submission]
   ✔ navigation_key_pages.yaml    [navigation]

✅ Generated 3 scenario(s) → generated/
   Run them with: aiqa run generated/<file>.yaml --headless
```

---

### `aiqa score <results.json>` — Readiness scoring

Computes a 0–100 readiness score from saved test results.

```bash
npx ts-node src/cli.ts score results.json
```

Output:
```
📊 Readiness Report
   Score   : 88/100  (B)
   Tests   : 7/8 passed  (87%)
   Coverage: UI, API, Assertions
   Issues  : 1× locator failure

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

The platform uses an abstraction layer so it works without any API key and upgrades seamlessly when one is provided.

| Mode | Behaviour |
|---|---|
| No API key (default) | Rule-based mock responses — fully functional |
| `ANTHROPIC_API_KEY` set | Real Claude API for richer analysis and generation |

To enable Claude:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm install @anthropic-ai/sdk
```

No code changes required — the factory picks it up automatically.

---

## Project Structure

```
src/
  cli.ts                        # CLI entry point (run, explore, generate, score)
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
    AdapterActions.ts           # Browser adapter interface
    PlaywrightAdapter.ts        # Playwright implementation (lazy launch)
  runner/
    TestRunner.ts               # End-to-end test orchestration
  llm/
    LLMProvider.ts              # Interface + factory
    MockLLMProvider.ts          # Rule-based, no API key needed
    AnthropicLLMProvider.ts     # Claude integration (plug-in ready)
  agents/
    DebuggerAgent.ts            # Failure classification + fix suggestions
    AppExplorer.ts              # Playwright-based app crawler
    FlowMapper.ts               # Heuristic user flow identification
    ScenarioGenerator.ts        # Flow → YAML test file generator
    ReadinessScorer.ts          # 0–100 readiness score
  integrations/
    JiraAdapter.ts              # Jira story → flow converter (mock + stub)

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
- [Playwright](https://playwright.dev/) — web automation + app crawling
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML test file parsing
- [Commander.js](https://github.com/tj/commander.js) — CLI interface

---

## License

MIT
