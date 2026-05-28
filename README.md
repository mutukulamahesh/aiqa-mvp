# AIQA — Enterprise AI QA Platform

Write tests in YAML. Run them anywhere. Test web apps, APIs, databases, and AI systems with one tool.

> **Tests are plain YAML — no JavaScript knowledge required.** Works with Node.js, Docker, Python (`pip install aiqa-runner`), or a one-line installer for Linux, macOS, and Windows.

---

## Get started in 30 seconds

**Docker (no install required):**

```bash
# 1. Create a test file
cat > login.yaml << 'EOF'
test:
  name: "Login smoke test"
  steps:
    - navigate: "https://yourapp.com/login"
    - fill: { target: "Email", value: "user@example.com" }
    - fill: { target: "Password", value: "secret" }
    - click: "Sign in"
    - assert: { text: "Dashboard" }
EOF

# 2. Run it
docker run --rm -v $(pwd):/tests aiqa/aiqa run /tests/login.yaml --headless
```

**Or install the CLI:**

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash

# Python teams
pip install aiqa-runner && curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash

# Node.js
git clone https://github.com/mutukulamahesh/aiqa-mvp.git && cd aiqa-mvp && npm install && npm link
```

---

## What you can test

| Type | What it does |
|---|---|
| **Web apps** | Click, fill, assert, self-heal broken selectors, auto-generate tests from any live app |
| **APIs** | HTTP requests, status codes, response assertions, chain API → DB checks |
| **Databases** | SQL queries, row counts, field values — PostgreSQL via Knex |
| **AI systems** | Call any LLM, judge quality, assert consistency, detect prompt regressions |
| **Visual UI** | Screenshot-based element detection and pixel-level visual regression — no selectors needed |

Tests are YAML files. One format for all four types:

```yaml
test:
  name: "API + DB check"
  steps:
    - api:
        method: POST
        url: "https://api.example.com/users"
        body: { name: "Alice" }
        assert_status: 201
        store_as: newUser
    - db:
        query: "SELECT id FROM users WHERE name = ?"
        params: ["Alice"]
        assert_rows: 1
```

---

## Install

| Method | Command | Best for |
|---|---|---|
| **Docker** | `docker pull aiqa/aiqa` | Any tech stack, no Node.js needed |
| **Python** | `pip install aiqa-runner` | Python / Django / FastAPI teams |
| **Shell** | `curl -fsSL .../install.sh \| bash` | Linux / macOS / CI pipelines |
| **Node.js** | `git clone ... && npm install && npm link` | Node.js / frontend teams |
| **Windows** | `iwr .../install.ps1 \| iex` | Windows PowerShell |

→ [Full install instructions](#installation-details)

---

## Key features

- **Auto-generate tests** — point AIQA at any live app; it crawls, maps flows, and writes the YAML
- **Self-heal selectors** — broken locators are repaired automatically via LLM and cached; vision-based strategy-5 fallback when all else fails
- **Vision testing** — assert elements by description using Claude Vision, no CSS selectors required; pixel-level visual regression with configurable diff thresholds
- **AI evaluation** — test LLMs natively: quality scoring, consistency checks, prompt regression detection
- **Enterprise AI** — works with Azure OpenAI, internal AI gateways, Ollama (local, no data leaves machine)
- **CI integration** — JUnit XML output, `--impact-only` flag runs only tests affected by the current git diff
- **HTML reports** — pass-rate trend chart, flaky test heatmap, step-by-step duration bars
- **Jira integration** — auto-creates bugs for failures with screenshots; deduplicates on re-run
- **Web portal** — browser UI for running tests, live progress, and result history

→ [Full feature list](#full-feature-list) · [GenAI testing guide](#genai-testing) · [Enterprise AI setup](#enterprise--on-premise-ai) · [CLI reference](#cli-reference)

---

## Full feature list

- **Init a project** in one command — folder structure, sample test, ready to run
- **Explore any app** autonomously and map its pages and flows; **authenticated re-exploration** logs in and crawls post-login pages automatically
- **Generate test files** per page or per flow — no manual test writing
- **Orchestrate the full pipeline** — one command: explore → map → generate → run → score
- **Analytics after every run** — top unstable pages, most healed selectors, LLM calls saved
- **Diagnose failures** automatically with AI root-cause analysis and screenshots
- **Score readiness** — get a 0–100 grade on your test coverage
- **Rich HTML reports** — pass-rate trend chart, top-5 flaky tests heatmap, step-by-step duration bars; generated automatically after every run
- **CI-ready JUnit XML** — `--junit <file>` emits xUnit XML consumed natively by GitHub Actions, GitLab CI, and Azure DevOps test result parsers
- **Run only impacted tests** — `--impact-only` runs only tests affected by the current git diff; targets 40%+ CI time reduction
- **Import existing test cases** from CSV, Excel, or Gherkin — no rewrite needed
- **Memory-aware retries** — flaky steps get extra wait time based on historical failure scores
- **Plug in any LLM** (Claude, GPT-4, Gemini, NVIDIA, Ollama) or point to your **enterprise AI endpoint** (Azure OpenAI, AWS Bedrock-compatible, internal AI gateway) — no code changes needed
- **Web Portal** — browser-based UI to trigger runs, view live progress, edit tests, and browse history
- **REST + WebSocket API** — full API layer for portal, Chrome extension, and CI integrations
- **Chrome Extension** — test any app from the browser, no CLI or YAML needed
- **Shell completion** — `aiqa completion bash|zsh` generates tab-completion scripts for your shell
- **Jira integration** — auto-creates bugs for failed tests with screenshots attached; reads stories and converts them to test scenarios; filters by sprint; deduplicates: re-failures add comments rather than creating new issues

---

## Installation details

### Docker

No Node.js install needed. Works on any OS, any tech stack:

```bash
docker pull aiqa/aiqa
docker run --rm -v $(pwd)/tests:/tests aiqa/aiqa run /tests/login.yaml --headless
```

Run all tests in a directory:

```bash
docker run --rm -v $(pwd)/tests:/tests aiqa/aiqa run-all /tests --headless
```

> Add `-v $(pwd)/config:/app/config` to any `docker run` command to use your own environment config (custom URLs, Ollama `baseUrl`, etc.). Without it the baked-in `dev` config is used.

Pass API keys via environment variables — nothing is baked into the image:

```bash
docker run --rm \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -v $(pwd)/tests:/tests \
  -v $(pwd)/config:/app/config \
  aiqa/aiqa run /tests/ai/translation.yaml --headless
```

Or use Docker Compose — copy `docker-compose.yml` from the repo root, set keys in `.env`, then:

```bash
docker compose run aiqa run-all /tests --headless
```

The image ships with Node 20 and Chromium pre-installed. No Node.js or npm needed on the host.

### Python wrapper

For Python teams — install once, run YAML tests from your existing Python environment:

```bash
pip install aiqa-runner
```

Then install the AIQA CLI (one-time, handles Node.js automatically):

```bash
curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash
```

Then run tests exactly as documented:

```bash
aiqa run tests/login.yaml
aiqa run-all tests/ --headless
aiqa --help
```

All arguments are forwarded directly to the AIQA Node CLI — no Python reimplementation. See `python/` in the repo for package source.

### Shell script (Linux / macOS / CI)

One-liner that installs Node.js (via nvm if needed), clones AIQA, and links the CLI — no manual setup:

```bash
curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash
aiqa run tests/login.yaml
```

**Windows (PowerShell):**

```powershell
iwr https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.ps1 | iex
aiqa run tests\login.yaml
```

> To run the downloaded script directly instead: `Set-ExecutionPolicy -Scope Process Bypass` then `.\install.ps1`

The script detects whether Node.js is already installed and skips the install if version ≥ 18 is present. Playwright Chromium is installed automatically.

### Node.js (default)

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

## Auto-generate tests for any app

```bash
aiqa init myproject
aiqa explore https://yourapp.com --out myproject
aiqa generate --out myproject --per-page
aiqa run-all --out myproject --headless
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

## Web Portal

AIQA includes a React web portal that gives you a full browser-based interface — no CLI needed.

### Start the portal

```bash
# Build the portal (first time only)
cd portal && npm install && npm run build && cd ..

# Start the API server (serves the portal + REST + WebSocket)
npx aiqa serve
```

The portal opens at **http://localhost:7432** (default port; override with `--port` or `AIQA_PORT` env var).

### Portal pages

| Page | What it does |
|---|---|
| **Dashboard** | Summary of recent runs — pass rate, scores, durations |
| **Tests** | Browse, view, and edit YAML test files with syntax highlighting |
| **Runs** | Run history with status filters; click any run for live step details and screenshots |
| **Orchestrate** | One-click full pipeline — enter a URL, set env vars (including credentials), watch it explore, generate, and run |

### Authentication credentials (portal)

The Orchestrate page has an **Env Vars panel** for setting runtime variables. To enable authenticated re-exploration and credential-based test generation:

1. Open the Orchestrate page
2. Click **Env Vars** and add:
   - `USERNAME` → your app's login username/email
   - `PASSWORD` → your app's login password
3. Click **Run** — AIQA will log in, crawl post-login pages, and generate authenticated test scenarios

---

## REST + WebSocket API

The API server exposes a complete REST + WebSocket interface. All endpoints (except `/api/health`) require a `Bearer` token (set via `AIQA_TOKEN` env var; defaults to no auth in dev).

### Trigger endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/run` | Run a single YAML test |
| `POST` | `/api/run-all` | Run all tests in a directory |
| `POST` | `/api/orchestrate` | Full pipeline: explore → map → generate → run → score |
| `POST` | `/api/explore` | Exploration only |
| `POST` | `/api/generate` | Generate scenarios from a prior exploration |
| `POST` | `/api/import` | Import CSV/Excel/Gherkin files (multipart) |
| `POST` | `/api/jira-sync` | Generate tests from Jira stories |

### Status + results endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/runs` | List all runs |
| `GET` | `/api/runs/:id` | Run metadata and status |
| `GET` | `/api/runs/:id/results` | Full test results JSON |
| `GET` | `/api/runs/:id/report` | HTML report |
| `GET` | `/api/runs/:id/screenshots/:file` | Screenshot file |
| `POST` | `/api/runs/:id/cancel` | Cancel an in-progress run |
| `GET` | `/api/health` | Health check (no auth required) |

### Test file endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tests/*path` | Read a YAML test file |
| `PUT` | `/api/tests/*path` | Write a YAML test file |

### Live streaming (WebSocket)

```
WS ws://localhost:7432/api/runs/:runId/stream
```

Streams `RunEvent` objects in real time: `step`, `step_result`, `log`, `test_done`, `done`. Up to 500 events are buffered for late subscribers (e.g. browser tab opened after a run starts).

### Example — trigger an orchestrate run via API

```bash
curl -X POST http://localhost:7432/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourapp.com",
    "headless": true,
    "vars": { "USERNAME": "admin", "PASSWORD": "secret" }
  }'
# → { "runId": "abc123", "status": "queued" }

# Stream live progress
wscat -c "ws://localhost:7432/api/runs/abc123/stream"
```

---

## Chrome Extension (EPIC-EXT-B)

The pure Chrome Extension lets non-technical users test any web app without installing anything locally.

**How it works:**
1. Install the extension in Chrome (load unpacked from `chrome-ext/` folder)
2. Open any web app
3. Click the AIQA extension icon — a side panel opens
4. Type a natural-language test goal or record a flow by clicking through the app
5. The extension generates and replays steps using Chrome's CDP (no Playwright, no server needed)
6. Pass / fail results shown inline with visual step highlighting

**Key features:**
- AI test generation — page HTML → Claude API → YAML steps
- Record mode — captures click/fill/navigate actions, replays with highlights
- Export as YAML, import from file
- Persists saved tests via `chrome.storage`
- Zero setup — no local server required

> Track A (API-backed extension, full Playwright power) is planned for a future release.

---

## CLI Reference

### `aiqa init [project]` — Create a project workspace

```bash
npx aiqa init myproject                                   # explicit name
npx aiqa init                                             # interactive prompt
npx aiqa init myproject --base-url https://yourapp.com   # pre-fill sample URL
```

Creates the folder structure (`tests/`, `results/`, `screenshots/`) and a starter `tests/sample.yaml`.

Options:
- `--base-url <url>` — pre-fill the `navigate:` URL in the generated sample test

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
- `--jira <projectKey>` — also pull Jira stories and generate scenarios (reads `JIRA_API_TOKEN` from env)
- `--sprint <id>` — filter Jira stories by sprint ID or name (used with `--jira`)

---

### `aiqa jira-sync <results.json>` — Push failures to Jira

Creates a Jira bug for every failed test. Deduplicates: if a bug with the same fingerprint already exists, adds a comment instead. Attaches the failure screenshot automatically.

```bash
npx aiqa jira-sync results/run-2026-05-19.json --project SCRUM
npx aiqa jira-sync results/run-2026-05-19.json --project SCRUM --dry-run
npx aiqa jira-sync results/run-2026-05-19.json --project SCRUM --xray SCRUM-99
```

Options:
- `--project <key>` — Jira project key (overrides `jira.projectKey` in config)
- `--dry-run` — preview what would be created without making any Jira calls
- `--xray <executionKey>` — also sync pass/fail outcomes to an Xray test execution record

Required env var: `JIRA_API_TOKEN` — your Atlassian API token (never commit it).

Required config (`config/environments/<env>.yaml`):
```yaml
jira:
  baseUrl:    https://yourorg.atlassian.net
  projectKey: SCRUM
  email:      you@example.com
```

`run-all` also accepts `--jira-defects` to create bugs inline during a run — no separate `jira-sync` step needed.

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
- `--junit <file>` — also write a JUnit XML report (for GitHub Actions, GitLab CI, Azure DevOps)

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
- `--junit <file>` — also write a JUnit XML report (for GitHub Actions, GitLab CI, Azure DevOps)
- `--impact-only` — only run tests whose tags or file path match files changed in the current git diff vs main; prints skipped tests count
- `--changed-files <list>` — comma-separated file list to use instead of git diff (for CI environments that expose changed files directly)

---

### `aiqa orchestrate --url <url>` — Full pipeline in one command

Runs the complete pipeline: Explore → Map flows → Generate scenarios → Run tests → Score readiness.

**Authenticated re-exploration:** If the crawl finds a login page and `USERNAME`/`PASSWORD` are set in the environment, AIQA automatically logs in and crawls post-login pages (dashboard, inventory, checkout, etc.), merging them into the exploration before scenario generation.

```bash
npx aiqa orchestrate --url https://yourapp.com --headless
npx aiqa orchestrate --url https://yourapp.com --dry-run
npx aiqa orchestrate --url https://yourapp.com --out myproject

# With credentials for authenticated re-exploration (set as shell env vars)
USERNAME=admin PASSWORD=secret npx aiqa orchestrate --url https://yourapp.com --headless
```

Options:
- `--url <url>` — target application URL (required)
- `--headless` — run browser in headless mode
- `--dry-run` — generate scenarios but do not execute them
- `--out <folder>` — save `orchestrator-summary.json` to this folder
- `--max-pages <n>` — page crawl limit (default: 10)
- `--slack` — post run summary to Slack (reads `SLACK_WEBHOOK_URL` from env)
- `--email <recipients>` — email HTML report on completion (reads `SMTP_*` from env)

Output:
```
[1/5] [Explorer] Exploring https://yourapp.com
[1/5] [Explorer] Authenticated re-exploration (https://yourapp.com/login)
[1/5] [Explorer] Merged 3 post-login page(s) — total 4
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

### `aiqa list [dir]` — List test files

Scans a directory for YAML test files and prints a summary table with name, tags, step count, and file path.

```bash
npx aiqa list                   # lists tests/ in current project
npx aiqa list myproject/tests/  # explicit directory
```

Output:
```
NAME                                 TAGS                       STEPS  FILE
Login flow                           smoke, regression              5  tests/login.yaml
Checkout — guest user                regression                     8  tests/checkout.yaml
API — create user                    api, smoke                     3  tests/api_create.yaml
```

---

### `aiqa doctor` — System health check

Checks that all platform dependencies are satisfied before a run.

```bash
npx aiqa doctor
npx aiqa doctor --env staging
```

Checks performed:
- Node.js version (≥ 18)
- Playwright installation
- `js-yaml` and `zod` packages
- `.env` file presence
- Environment config file validity
- Disk space (warns if < 100 MB free)

Exits `0` if all critical checks pass (warnings are non-blocking), exits `1` on any critical failure.

---

### `aiqa config validate [env]` — Validate environment config

Loads and validates the config for an environment profile, prints all resolved values, and exits non-zero if the config is invalid.

```bash
npx aiqa config validate             # validates dev (default)
npx aiqa config validate staging     # validates staging profile
```

Output:
```
✅ Config valid for env: staging
   base     : https://staging.example.com
   api      : https://staging.example.com/api
   workers  : 4
   headless : true
   ...
```

---

### `aiqa completion [shell]` — Shell tab-completion

Generates a tab-completion script for your shell. Defaults to `bash`.

```bash
npx aiqa completion bash >> ~/.bashrc && source ~/.bashrc
npx aiqa completion zsh  >> ~/.zshrc  && source ~/.zshrc
```

---

### `aiqa serve` — Start the API + Portal server

```bash
npx aiqa serve
npx aiqa serve --port 8080
npx aiqa serve --env staging
```

Options:
- `--port <n>` — port to listen on (default: 7432 or `AIQA_PORT` env var)
- `--env <env>` — environment profile to load (default: dev)

Starts the REST + WebSocket API server and serves the compiled portal at the same port. Keep this running while using the portal or making API calls.

---

### `aiqa knowledge ingest` — Build the RAG knowledge index

Pulls content from all configured connectors (Jira stories, Confluence pages, OpenAPI specs, git log) and builds the local vector index used by the judge, healer, and RAG assertion steps.

```bash
npx aiqa knowledge ingest            # ingest using dev config
npx aiqa knowledge ingest --env staging
```

Requires `knowledge.enabled: true` in your environment config and at least one connector configured.

---

### `aiqa knowledge readiness [--tag <tag>]` — Check RAG coverage

Reports whether the knowledge index has sufficient coverage for a given test tag.

```bash
npx aiqa knowledge readiness --tag login    # READY / PARTIAL / MISSING
npx aiqa knowledge readiness               # overall index health
```

Exit codes: `0` = READY, `1` = PARTIAL or MISSING.

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
| `assert: { element_not_visible }` | Assert an element (e.g. login form) is no longer visible — used to confirm successful login |
| `api: { method, url, ... }` | Make an HTTP request, optionally store response |
| `db: { query, params?, assert_rows?, assert_field?, store_as? }` | Execute SQL with optional positional `params` array; assert row counts and field values |
| `judge: { value, prompt, pass_if }` | LLM scores a value against a natural-language criterion (0.0–1.0); `pass_if: "score >= 0.7"` |
| `llm_eval: { target, prompt, assert_quality, baseline_key }` | Call a named target LLM, judge quality, and/or detect prompt regression via embedding drift |
| `llm_consistency: { target, prompt, runs, assert_variance }` | Run the same prompt N times and assert the maximum pairwise cosine distance stays below threshold |
| `rag_assert: { query, min_chunks, min_score }` | Assert the knowledge index returns relevant chunks for a query — validates RAG retrieval quality |
| `vision_assert: { description, min_confidence?, store_as? }` | Detect a UI element by natural-language description using Claude Vision; stores `{ description, type, selector, confidence }` via `store_as`; compose with `click:` / `fill:` for actions |
| `visual_snapshot: { name, update?, max_diff_percent?, sensitivity?, store_as? }` | Capture or compare a screenshot baseline; `update: true` records; compare mode fails if pixel diff exceeds `max_diff_percent`; `sensitivity` controls per-pixel color tolerance |
| `wait_for_element: <selector>` | Wait for an element to appear |
| `wait_ms: <n>` | Wait N milliseconds |
| `wait_for_url: <pattern>` | Wait until URL matches |
| `if: { variable, operator, operand, steps }` | Conditional branching (`operator`: `equals`, `not_equals`, `contains`, `greater_than`, `less_than`) |
| `for_each: { over, as, steps }` | Loop over an array (max 100 iterations) |
| `store: { selector, as }` | Capture page text/attribute into a variable |

### GenAI testing

Test AI systems with the same YAML syntax as web and API tests. Configure target LLMs in your environment profile, then reference them by name:

```yaml
# config/environments/dev.yaml
llm_targets:
  fast:     { provider: ollama,    model: llama3.2 }
  powerful: { provider: anthropic, model: claude-sonnet-4-6 }
```

```yaml
test:
  name: "Translation quality + consistency"
  steps:
    # Quality assertion — judge the response against natural-language criteria
    - llm_eval:
        target: fast
        prompt: "Translate 'Good morning' to French"
        assert_quality:
          criteria: "Response is a correct French translation"
          pass_if: "score >= 0.8"
        baseline_key: translate-good-morning   # regression: fails if response drifts > 20%
        store_as: evalResult

    # Consistency — same prompt N times; assert low variance
    - llm_consistency:
        target: fast
        prompt: "What is the capital of France?"
        runs: 5
        assert_variance:
          max: 0.1        # max pairwise cosine distance across 5 responses
        store_as: consistencyResult

    # RAG health — assert the knowledge index retrieves relevant content
    - rag_assert:
        query: "user authentication acceptance criteria"
        min_chunks: 2
        min_score: 0.7
```

Record a baseline on first run, then CI diffs against it automatically:
```bash
AIQA_BASELINE_RECORD=true npx aiqa run tests/ai/translation.yaml   # record
npx aiqa run tests/ai/translation.yaml                              # subsequent CI runs diff vs baseline
```

### Vision testing

Test any UI by describing what you see — no CSS selectors, XPath, or DOM knowledge required. Works on web apps, embedded UIs, and any interface that can be screenshotted.

```yaml
test:
  name: "Login — vision-based"
  steps:
    - navigate: "https://yourapp.com/login"

    # Detect and store the email field using Claude Vision
    - vision_assert:
        description: "Email input field"
        min_confidence: 0.7
        store_as: emailField

    # Use the resolved selector from vision in a normal fill step
    - fill:
        target: "{{ emailField.selector }}"
        value: "user@example.com"

    # Visual regression — capture baseline on first run
    - visual_snapshot:
        name: login-page-baseline
        update: true        # omit this on subsequent runs to compare

    # Compare against baseline — fail if more than 0.5% of pixels change
    - visual_snapshot:
        name: login-page-baseline
        max_diff_percent: 0.005
        sensitivity: 0.1
        store_as: visualResult
```

**How vision_assert works:**
1. Captures a screenshot of the current page
2. Sends it to Claude Vision with a detection prompt (no selectors, no DOM)
3. Matches the best detected element against your `description`
4. Attempts selector resolution via OCR text proximity + DOM validation
5. Stores `{ description, type, selector, confidence }` — use `selector` in subsequent steps

**Visual regression thresholds:**
- `max_diff_percent` — what percentage of pixels may differ before the test fails (e.g. `0.01` = 1%)
- `sensitivity` — per-pixel color tolerance passed to pixelmatch (e.g. `0.1` = 10% color channel delta)

Baseline images are stored in `.aiqa/visual-baselines/` and diff images written alongside them on failure.

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

AIQA works out of the box without any API key and upgrades seamlessly when one is configured. Six providers are supported.

### Supported providers

| Provider | Env var | Notes |
|---|---|---|
| `mock` (default) | — | Rule-based, zero dependencies, always works |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude — `npm install @anthropic-ai/sdk` required |
| `openai` | `OPENAI_API_KEY` | GPT-4o-mini default; also used for **Azure OpenAI** and any OpenAI-compatible enterprise gateway — set `baseUrl` to your endpoint |
| `nvidia` | `NVIDIA_API_KEY` | Free API at [build.nvidia.com](https://build.nvidia.com) — OpenAI-compatible |
| `gemini` | `GEMINI_API_KEY` | Gemini 2.0 Flash default |
| `ollama` | — | Local LLM, no API key, data never leaves machine; `baseUrl` configurable per `llm_targets` entry |

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

### Enterprise & on-premise AI

If your organisation routes all AI traffic through an approved endpoint — Azure OpenAI, an internal LiteLLM proxy, or an Azure API Management AI gateway — AIQA works with it out of the box. No new API keys or external AI contracts needed.

**Azure OpenAI** — use `provider: openai` and set `baseUrl` to your Azure deployment:

```yaml
llm:
  provider: openai
  baseUrl: "https://your-company.openai.azure.com/openai/deployments/gpt-4o"
```

**Internal AI gateway** (LiteLLM, Azure APIM, or any OpenAI-compatible proxy):

```yaml
llm:
  provider: openai
  baseUrl: "https://ai-gateway.internal.yourcompany.com/v1"
```

**Per-target routing** — if your company tests its own AI product (the "target") and uses a separate approved LLM as the judge, each can route through a different endpoint:

```yaml
# config/environments/prod.yaml
llm_targets:
  our-chatbot:   { provider: openai, baseUrl: "https://chatbot.internal/v1" }   # system under test
  judge:         { provider: openai, baseUrl: "https://approved-aoai.openai.azure.com/openai/deployments/gpt-4o" }
```

**What AIQA sends to the LLM** — only the test prompt and the LLM response being evaluated. No application credentials, no user data, no source code. Your AI gateway's audit log will capture every call.

---

## Data stays on-prem

AIQA is designed so that sensitive data never has to leave your network. This section explains exactly what goes where and how to lock it down completely.

### What never leaves your machine

| Artefact | Where it lives |
|---|---|
| YAML test files | Your filesystem / VCS |
| Playwright browser sessions | In-process; no external relay |
| Screenshots & HTML reports | `results/` directory |
| RAG knowledge index | `.aiqa/knowledge/` (local vectra store) |
| Jira / Confluence content ingested into RAG | `.aiqa/knowledge/` — never re-uploaded |
| Database query results (`db:` steps) | In-process; logged locally only |
| `store:` variables captured during a run | In-process; written to `results/` JSON |
| API response bodies (`api:` steps) | In-process; written to `results/` JSON |

### What goes outbound (and when)

| Call | Destination | Trigger | How to eliminate |
|---|---|---|---|
| LLM inference (judge, heal, generate) | Your configured `llm.provider` | Any step that invokes the LLM | Use `provider: ollama` or `provider: mock` |
| Jira REST API reads (RAG ingest) | `jira.baseUrl` (your instance) | `aiqa knowledge ingest` | Already on-prem if self-hosted Jira |
| Confluence REST API reads (RAG ingest) | `confluence.baseUrl` (your instance) | `aiqa knowledge ingest` | Already on-prem if self-hosted Confluence |
| OpenAPI spec fetch | URL in `connectors[].url` | `aiqa knowledge ingest` | Point to an internal URL |
| `navigate:` / `api:` step URLs | Your app under test | Test execution | Your app, your network |

LLM calls are the only calls that can reach a third-party service. Everything else talks to systems you already own.

### Full air-gap with `privacy_mode`

Set `privacy_mode: true` in your environment config to enforce local-only LLM usage at startup. AIQA will refuse to start if the configured provider (or any provider in the fallback chain) makes outbound calls:

```yaml
# config/environments/prod.yaml
privacy_mode: true

llm:
  provider: ollama          # ✅ local inference
  fallback: [mock]          # ✅ also local
```

Any attempt to use `anthropic`, `openai`, `nvidia`, or `gemini` with `privacy_mode: true` raises a startup error listing the disallowed providers.

### Running fully local with Ollama

1. **Install Ollama** — [ollama.com](https://ollama.com) (macOS / Linux / Windows)
2. **Pull a model:**
   ```bash
   ollama pull llama3          # general-purpose judge + healer
   ollama pull nomic-embed-text # optional: local embeddings
   ```
3. **Configure AIQA:**
   ```yaml
   privacy_mode: true

   llm:
     provider: ollama
     model: llama3
     baseUrl: "http://localhost:11434"
   ```
4. **Verify with `aiqa doctor`:**
   ```
   ✅ Ollama   running — models: llama3, nomic-embed-text
   🔒 Privacy mode  ON — only ollama/mock providers permitted (no outbound LLM calls)
   ```

With this setup AIQA runs entirely on your hardware. No API keys, no data egress, no external dependencies.

### Compliance checklist

- [ ] `privacy_mode: true` in `prod.yaml`
- [ ] `llm.provider: ollama` (or `mock` for pure scripted tests)
- [ ] No `anthropic` / `openai` / `gemini` / `nvidia` keys in `.env`
- [ ] Jira / Confluence URLs point to your self-hosted instance
- [ ] `results/` directory excluded from external log shippers
- [ ] `aiqa doctor` green before first production run

---

## Project Structure

```
config/
  environments/
    dev.yaml              ← development profile
    staging.yaml          ← staging profile
    prod.yaml             ← production profile

portal/                   ← React + Vite web portal
  src/
    pages/
      Dashboard.tsx       ← run history summary
      Tests.tsx           ← YAML editor + file browser
      Runs.tsx            ← run list with status filters
      RunDetail.tsx       ← live step-by-step progress + screenshots
      Orchestrate.tsx     ← one-click full pipeline UI
    components/
      EnvVarPanel.tsx     ← credential / env var input panel
      ErrorBoundary.tsx   ← React error boundary
      Layout.tsx          ← navigation shell
    api.ts                ← REST + WebSocket client

src/
  cli.ts                  ← CLI entry point (all commands)
  server.ts               ← Express + WS server (aiqa serve)
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
    AssertionHandler.ts  ← assert (text, url, equals, element_not_visible)
    APIActionHandler.ts  ← api step execution
    DBActionHandler.ts   ← db step — query, assert_rows, assert_field, store_as
    JudgeHandler.ts      ← judge: LLM scoring with determinism cache
    LLMEvalHandler.ts    ← llm_eval: target LLM call + quality judge + baseline compare
    ConsistencyHandler.ts ← llm_consistency: N runs + pairwise variance assertion
    RagAssertHandler.ts  ← rag_assert: retrieval quality assertion
    AgentTraceHandler.ts ← agent_trace: OpenAI Assistants + LangChain trace assertion
    VisionAssertHandler.ts ← vision_assert: screenshot-based element detection; pure detector
    VisualSnapshotHandler.ts ← visual_snapshot: pixel-level visual regression baseline/compare
    judgeUtils.ts        ← shared scoreByCriteria, parsePassIf, formatACContext
    WaitHandler.ts       ← wait_for_element, wait_ms, wait_for_url
    ConditionHandler.ts  ← if: branching
    LoopHandler.ts       ← for_each: iteration with depth guard
    StoreHandler.ts      ← store: capture page text/attribute
  vision/
    types.ts             ← DetectedElement, OcrWord, BoundingBox, RepoEntry
    VisionAgent.ts       ← Claude Vision API; analyzeBuffer(buf); StubVisionAgent
    OcrEngine.ts         ← tesseract.js lazy-load; bbox normalized 0–1; StubOcrEngine
    ObjectRepository.ts  ← SHA-256 composite key; hostname-only normalizeUrl; atomic write
    SmartLocatorEngine.ts ← OCR proximity + type hints → DOM-validated CSS candidates
    VisualRegression.ts  ← pixelmatch diff; max_diff_percent vs sensitivity; diff image on fail
  adapter/
    AdapterActions.ts    ← Browser adapter interface (includes screenshotBuffer, countLocator)
    PlaywrightAdapter.ts ← Playwright + transparent selector healing
  db/
    DBAdapter.ts          ← DBAdapter interface + QueryResult type
    DBAdapterFactory.ts   ← Auto-selects Mock (CI) or Knex (DB_URL set)
    MockDBAdapter.ts      ← Seedable in-memory adapter for unit tests
    KnexDBAdapter.ts      ← PostgreSQL via Knex (optional, requires knex pg)
  runner/
    TestRunner.ts         ← End-to-end orchestration, retry, circuit breaker
    RunEvent.ts           ← Event types for WS streaming
  reporters/
    HTMLReporter.ts       ← Self-contained HTML report — trend chart, heatmap, duration bars
    JUnitReporter.ts      ← JUnit/xUnit XML for GitHub Actions, GitLab CI, Azure DevOps
    AllureReporter.ts     ← Allure JSON output
    TrendTracker.ts       ← Pass-rate trend history + topFlakyTests helper
    SlackNotifier.ts      ← Slack webhook post-run summary
    EmailNotifier.ts      ← Email HTML report via SMTP
  utils/
    Spinner.ts            ← TTY-aware CLI spinner (no-op in CI/pipes)
  config/
    ConfigLoader.ts       ← Zod-validated YAML config loader + secret checks
  llm/
    LLMProvider.ts        ← Interface + createLLMProvider() factory
    MockLLMProvider.ts    ← Rule-based, no API key needed
    AnthropicLLMProvider.ts
    OpenAILLMProvider.ts  ← Also used for NVIDIA (OpenAI-compatible)
    GeminiLLMProvider.ts
    OllamaLLMProvider.ts  ← Local LLM via Ollama REST API; no API key required
    FallbackLLMProvider.ts ← Provider chain with retryable-error classification
  ai-testing/
    BaselineStore.ts      ← Reads/writes tests/baselines/{key}.json for prompt regression
  tests/__mocks__/
    pixelmatch.js         ← CJS shim for pixelmatch v7 (pure ESM); wired via jest moduleNameMapper
    VarianceComputer.ts   ← Pairwise cosine distance (max or mean) across N LLM responses
    TraceParser.ts        ← Normalises OpenAI Assistants + LangChain traces to AgentTrace
  agents/
    OrchestratorAgent.ts  ← Full pipeline coordinator: Explorer → FlowMapper → Generator → Runner → Scorer
    DebuggerAgent.ts      ← Failure classification + fix suggestions (memory-backed)
    AppExplorer.ts        ← Playwright-based app crawler + authenticated re-exploration
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
    JiraClient.ts         ← Jira REST HTTP client (injectable transport for testing)
    JiraAdapter.ts        ← AC extraction, story→flow, bug creation, screenshot attachment
  impact/
    GitDiffParser.ts      ← Parses `git diff --name-only` output into changed file list
    ImpactMapper.ts       ← Maps changed files → affected YAML tests (tag + path matching)
  api/
    router.ts             ← Route registration
    middleware/
      auth.ts             ← Bearer token + query-param auth
      cors.ts             ← CORS policy
    routes/
      runTriggers.ts      ← POST /api/run|run-all|orchestrate|explore|generate|import|jira-sync
      runs.ts             ← GET /api/runs, /api/runs/:id, /runs/:id/results|report
      tests.ts            ← GET/PUT /api/tests/*path
      screenshots.ts      ← GET /api/runs/:id/screenshots/:file
      cancel.ts           ← POST /api/runs/:id/cancel
      health.ts           ← GET /api/health
    ws/
      runStream.ts        ← WebSocket fan-out, 500-event replay buffer
    jobs/
      RunJob.ts           ← Job lifecycle + event buffer
      RunJobStore.ts      ← In-memory job store + concurrency queue

.aiqa/
  healer-cache.json       ← Persisted healer selector store (auto-created)
  healer-runs.json        ← Run history for analytics (auto-created)
  runs/                   ← Persisted run results, exploration, screenshots

tests/
  saucedemo/              ← End-to-end YAML examples (Sauce Demo app)
  baselines/              ← VCS-committed prompt regression baselines (*.json, one per baseline_key)
  db/                     ← DB handler unit tests
  config/                 ← Config schema unit tests
  healer/                 ← Healer + analytics unit tests
  agents/                 ← FlowMapper + Orchestrator unit tests
  importer/               ← CSV/Excel/Gherkin importer unit tests
  llm/                    ← LLM provider unit tests
  memory/                 ← Memory store unit tests
  flow-control/           ← wait/if/for_each/store handler tests
  judge/                  ← LLM judge handler tests
  handlers/               ← LLMEvalHandler baseline regression tests
  ai-testing/             ← TraceParser + VarianceComputer + BaselineStore unit tests
```

---

## Technologies

- [TypeScript](https://www.typescriptlang.org/)
- [Playwright](https://playwright.dev/) — web automation, app crawling, screenshots
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) — web portal frontend
- [Express](https://expressjs.com/) — REST API server
- [ws](https://github.com/websockets/ws) — WebSocket streaming
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML test file parsing
- [Zod](https://zod.dev/) — config and request schema validation
- [Commander.js](https://github.com/tj/commander.js) — CLI interface
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel test case import
- [Knex](https://knexjs.org/) *(optional)* — PostgreSQL adapter; install with `npm install knex pg`
- [tesseract.js](https://github.com/naptha/tesseract.js) *(optional)* — OCR engine for vision testing; lazy-loaded on first use
- [pngjs](https://github.com/lukeapage/pngjs) + [pixelmatch](https://github.com/mapbox/pixelmatch) — PNG encode/decode and pixel diff for visual regression

---

## Open-core model

AIQA is open-core. The engine is free and stays free.

| Tier | What's included | Price |
|---|---|---|
| **Core** (this repo) | Full CLI, YAML DSL, Playwright runner, LLM judge, self-healing selectors, RAG knowledge layer, REST + WebSocket API, portal, all integrations, VS Code + JetBrains plugins | Free forever · Apache-2.0 |
| **Cloud** *(roadmap)* | Hosted execution — run tests without managing infrastructure; team dashboards; parallel workers on demand; SLA-backed uptime | Paid · per seat or per minute |

The Cloud tier will never gate features that exist in Core today. If it's in this repo, it stays free.

If you are running AIQA on your own infrastructure, self-hosting is fully supported and always will be. The `privacy_mode` flag, Ollama integration, and local RAG index exist precisely for teams that cannot send data to a third-party cloud.

---

## License

Copyright 2026 Mahesh Mutukula

Licensed under the [Apache License, Version 2.0](LICENSE). You may use, modify, and distribute this software freely provided you retain the copyright notice and license file.
