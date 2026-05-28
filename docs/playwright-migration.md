# Adding AIQA to an Existing Playwright Project

AIQA is designed to complement Playwright, not replace it. If your team already has Playwright tests, you can add AIQA alongside them to get self-healing selectors, LLM-powered assertions, and AI-generated test scenarios — without rewriting anything.

---

## What AIQA adds on top of Playwright

| Capability | Playwright alone | Playwright + AIQA |
|---|---|---|
| Browser automation | ✅ | ✅ |
| Self-healing selectors | ❌ | ✅ Auto-heals broken selectors via LLM |
| LLM semantic assertions | ❌ | ✅ `judge:` step scores free-text criteria |
| AI-generated tests from UI | ❌ | ✅ `aiqa explore` + `aiqa generate` |
| RAG from Jira/Confluence | ❌ | ✅ Tests generated from acceptance criteria |
| Uptime monitoring | ❌ | ✅ `aiqa schedule` + webhook alerts |
| Impact filter (skip unaffected) | ❌ | ✅ `--impact-only` on PRs |

AIQA test files (`.yaml`) live alongside your existing Playwright spec files. They share the same `tests/` directory — no conflict.

---

## Step 1 — Install AIQA into your existing project

```bash
npm install --save-dev aiqa
npx playwright install chromium   # if not already installed
```

Or use the Docker image if you don't want Node:

```bash
docker pull aiqa/aiqa:latest
```

---

## Step 2 — Create an AIQA config file

AIQA needs a minimal config file. Run:

```bash
npx aiqa init                     # interactive prompt
```

Or create `config/environments/dev.yaml` manually:

```yaml
environment: dev
urls:
  base: https://your-app.com
  api:  https://your-app.com

timeouts:
  action:     10000
  navigation: 30000
  api:        10000

execution:
  workers:  2
  retries:  1
  headless: true
  maxPages: 20
  maxDepth: 3
  circuitBreaker: 5

screenshots:
  onFailure: true
  dir: screenshots

results:
  dir: results

features:
  llmEnabled: true

llm:
  provider: mock        # start with mock; switch to anthropic/openai when ready
  fallback: []
```

---

## Step 3 — Write your first AIQA test

AIQA tests are YAML files. They live in the same `tests/` folder as your Playwright specs:

```
tests/
  login.spec.ts          ← existing Playwright test
  login.yaml             ← new AIQA test covering the same flow
```

Example `tests/login.yaml`:

```yaml
test:
  name: "Login — happy path"
  tags: [smoke, auth]
  steps:
    - navigate: "https://your-app.com/login"
    - fill:
        target: "#email"
        value: "user@example.com"
    - fill:
        target: "#password"
        value: "password123"
    - click: "button[type='submit']"
    - assert_url_contains: "/dashboard"
    - assert_text_visible: "Welcome"
```

Run it:

```bash
npx aiqa run tests/login.yaml --headless
```

---

## Step 4 — Run alongside your existing CI

AIQA and Playwright run independently. Add AIQA to your CI pipeline without removing anything:

```yaml
# .github/workflows/ci.yml
jobs:
  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright test        # existing

  aiqa:
    runs-on: ubuntu-latest
    steps:
      - uses: mutukulamahesh/aiqa-mvp@main   # zero install
        with:
          test-dir: tests/
          env: staging
```

Or use the impact filter to only run AIQA on tests affected by the PR:

```bash
npx aiqa run-all tests/ --impact-only --headless
```

---

## Step 5 — Let AIQA generate tests from your existing UI

Once your app URL is reachable in CI, AIQA can map its flows and write new test scenarios automatically:

```bash
npx aiqa explore https://your-app.com --out my-project
npx aiqa generate --out my-project --per-page
npx aiqa run-all my-project/tests/ --headless
```

The generated YAML files are human-readable and editable. Add them to version control alongside your Playwright specs.

---

## Frequently asked questions

**Do I have to migrate my Playwright tests to YAML?**
No. Playwright tests keep running exactly as before. AIQA YAML tests run in a separate process. Both can live in the same repo.

**Can AIQA tests call my existing Playwright fixtures?**
Not directly. AIQA uses its own Playwright instance internally. If you need shared setup (like auth state), use the `navigate` + `fill` steps to replicate it, or use the `api:` step to hit your auth endpoint directly.

**What if a selector breaks?**
AIQA's self-healer automatically tries 4 fallback strategies (DOM text, role, nearby label, LLM-generated candidate) and updates the healer cache. Your test passes without a code change. You'll see a `⚡ Healed` note in the output.

**How do I enable the LLM judge for semantic assertions?**
Change `llm.provider` in your config from `mock` to `anthropic` or `openai`, set the API key in `.env`, and use the `judge:` step:

```yaml
- judge:
    prompt: "Did the checkout total calculate correctly?"
    value: "${capturedTotal}"
    pass_if: ">= 0.8"
```

**Is my test data sent to the LLM?**
Only the string passed as `value` in `judge:` steps, and only if you configure a real LLM provider. Set `privacy_mode: true` in config to block all outbound LLM calls and force local-only mode (Ollama).
