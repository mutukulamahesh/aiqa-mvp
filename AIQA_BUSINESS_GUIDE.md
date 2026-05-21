# AIQA — Business & Non-Technical Guide

## What Is AIQA?

AIQA (powered by the AIQA platform) is an **AI-driven quality assurance system** that automatically tests your software so your team can ship with confidence — without hiring large QA teams or writing thousands of manual test scripts.

Think of it as a **tireless digital QA engineer** that:
- Learns your application by exploring it like a real user
- Writes its own tests automatically
- Runs those tests every time code changes
- Self-repairs when your app changes (without manual updates)
- Reports problems in plain English before they reach your customers

---

## The Core Idea in Plain English

Traditional QA is slow, expensive, and brittle:
- Manual testers click through screens repeatedly
- Developers write test scripts that break every time the UI changes
- Problems slip through because testing only covers what someone thought to test

**AIQA flips this model entirely.**

Instead of humans writing tests for machines to run, the AI:
1. **Explores** your app autonomously (like a new employee clicking around on day one)
2. **Maps** the important user journeys it discovers
3. **Generates** a full test suite from those real journeys
4. **Runs** tests in parallel — completing in minutes what would take humans hours
5. **Heals itself** when your UI changes, rather than breaking
6. **Scores** your software's readiness on a 0–100 scale before release

---

## The Business Value

| Business Problem | How AIQA Solves It |
|-----------------|------------------------|
| QA slows down releases | Tests run in minutes, not days — parallel execution across 8+ workers |
| Test scripts break when UI changes | Self-healing AI repairs broken selectors automatically |
| Bugs reach production | Every deploy is tested end-to-end across UI, APIs, and database |
| QA team is a bottleneck | One platform replaces a fragmented toolchain of 5+ tools |
| Hard to know what to test | AI discovers user flows you hadn't thought to test |
| Jira tickets don't connect to tests | Auto-generates tests from your Jira acceptance criteria |
| Test results are hard to understand | Plain-English reports with readiness scores and trend charts |
| CI/CD pipeline is slow | Impact filtering runs only tests affected by the latest code change (40%+ faster) |

---

## Architecture Overview

The system has four layers that work together:

```
┌─────────────────────────────────────────────────────────────────┐
│                        HOW YOU INTERACT                         │
│                                                                 │
│   Web Portal (browser)   │   Chrome Extension   │   CLI/API    │
│   Point-and-click UI     │   Zero install       │   CI/CD pipe │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        THE AI BRAIN                             │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  App        │  │  Test        │  │  Debugger Agent       │  │
│  │  Explorer   │→ │  Generator   │  │  (diagnoses failures) │  │
│  │  (BFS crawl)│  │  (writes YAML│  │                       │  │
│  └─────────────┘  │  test files) │  └───────────────────────┘  │
│                   └──────────────┘                              │
│  LLM Providers: Claude (Anthropic) │ GPT-4 (OpenAI) │ Gemini   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        THE TEST ENGINE                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  One YAML test file tests ALL THREE layers simultaneously  │  │
│  │                                                           │  │
│  │   UI Testing        API Testing       Database Testing    │  │
│  │   ─────────────     ─────────────     ─────────────────   │  │
│  │   Click buttons     Call endpoints    Query the DB        │  │
│  │   Fill forms        Check responses   Assert row counts   │  │
│  │   Read screen       POST/GET/PUT      Validate data       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Self-Healing  │  Parallel Workers  │  Memory & Retry Logic    │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RESULTS & INTEGRATION                       │
│                                                                 │
│  Readiness Score  │  HTML Reports  │  Slack/Email Alerts       │
│  (0–100)          │  Trend Charts  │                           │
│                                                                 │
│  Jira: Auto-create bugs  │  GitHub/Jenkins CI  │  Xray Sync   │
└─────────────────────────────────────────────────────────────────┘
```

### The Five-Stage Pipeline

```
   STAGE 1          STAGE 2          STAGE 3          STAGE 4          STAGE 5
  ──────────       ──────────       ──────────       ──────────       ──────────
  EXPLORE    →     MAP        →    GENERATE   →      RUN        →     SCORE

  AI browses      Identifies       Writes test       Executes all     Outputs
  your app        key user         files from        tests in         0–100
  like a user     journeys         discovered        parallel         readiness
                  (login,          flows                              grade
                  checkout,
                  search, etc.)
```

---

## How the Self-Healing Works

This is one of the most important business features — it means **you don't pay engineers to maintain tests after every UI change**.

```
  UI Change Deployed
         │
         ▼
  Test finds broken element
  (button moved, text changed)
         │
         ▼
  AI analyzes the page
  and finds the new location
         │
         ▼
  Fix is cached for future runs
  (no human needed)
         │
         ▼
  Test passes ✓
  Report shows "healed: 1 selector"
```

In traditional testing, a single UI redesign can break hundreds of test scripts and require days of engineering work to fix. AIQA handles this automatically.

---

## What a Test Looks Like (Plain English Version)

Behind the scenes, AIQA writes test scenarios in a simple YAML format. Here's what one looks like and what it means in plain English:

```yaml
# This is auto-generated — your team doesn't write this manually
test:
  name: "User Checkout Flow"
  steps:
    - navigate: "https://yourapp.com/shop"         # Open the shopping page
    - click: "Add to Cart"                          # Click the button
    - fill: { field: "Promo Code", value: "SAVE10"} # Enter a discount code
    - api:
        method: POST                                 # Verify the backend received it
        url: "https://api.yourapp.com/cart"
        store_as: cart_response
    - db:
        query: "SELECT * FROM carts WHERE user_id = 42"  # Confirm DB was updated
        assert_rows: 1
    - assert:
        text: "10% discount applied"                 # Confirm the screen shows it
    - judge:
        value: "{{ cart_response.message }}"         # AI grades the response quality
        prompt: "Is this a friendly, helpful message?"
        pass_if: "score >= 0.7"
```

**Business translation**: This single test simultaneously verifies:
- The user experience (the button works, the message shows)
- The backend API (the cart API accepted the request)
- The database (the record was actually saved)
- The AI quality check (the messaging meets your standards)

Previously, each of these would require a separate tool, separate team, and separate schedule.

---

## Ways to Use AIQA

### Option 1: Web Portal (No Technical Skills Required)

Access via browser at `http://your-server:7432`

```
┌──────────────────────────────────────────────┐
│  LEHMAN QA PORTAL                            │
│  ────────────────────────────────────────    │
│  Dashboard    Tests    Runs    Orchestrate   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  ORCHESTRATE (One-Click Pipeline)    │   │
│  │                                      │   │
│  │  App URL: [https://yourapp.com    ]  │   │
│  │                                      │   │
│  │  [  Run Full AI Pipeline  ]          │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Readiness Score: 87/100  ████████░░         │
│  Last Run: 2 hours ago    143 passed, 3 fail │
└──────────────────────────────────────────────┘
```

**Who uses this**: Product managers, QA leads, business stakeholders who want visibility

### Option 2: Chrome Extension (Zero Installation)

Install the browser extension → describe what you want tested in plain English → AI generates and runs the test in your active tab.

**Example prompt**: *"Test that a user can search for 'laptop', add the first result to cart, and see it in the cart summary"*

**Who uses this**: Non-technical testers, product managers validating features

### Option 3: Automatic CI/CD (Fully Automated)

Every time a developer pushes code, AIQA automatically:
1. Detects what changed
2. Runs only the tests affected by that change (faster)
3. Posts results to Slack / creates Jira bugs if something broke
4. Blocks deployment if the readiness score is too low

**Who uses this**: Engineering teams, DevOps — runs without human intervention

### Option 4: Jira Integration (Requirements → Tests)

Connect to Jira and AIQA will:
- Read your user stories and acceptance criteria
- Auto-generate tests for each story
- Create Jira bugs (with screenshots) when tests fail
- Update Jira test execution records automatically

**Who uses this**: Agile teams, product owners who write user stories in Jira

---

## The Readiness Score: Your Release Confidence Metric

Every test run produces a **Readiness Score from 0 to 100**.

```
  0 ──────────────────────────────────────── 100
  │                    │                       │
  Not ready         Caution              Ship with
  for release       — review             confidence
                    failures
  
  Score Factors:
  ├── Test pass rate          (how many tests passed)
  ├── Critical flow coverage  (login, checkout, etc. all tested?)
  ├── Flakiness penalty       (unstable tests lower the score)
  └── Trend direction         (improving or degrading?)
```

**Business implication**: Product teams can set a minimum score (e.g., 80) as a release gate. No exceptions. No "we think it's probably fine."

---

## Reporting & Visibility

### HTML Report (sent after every run)
- Pass/fail summary with trend charts
- Screenshots of every failure
- Plain-English diagnosis of what went wrong and why
- Comparison to previous runs

### Slack Notification
```
AIQA — Run Complete
━━━━━━━━━━━━━━━━━━━━━━━
✅ Passed:  143
❌ Failed:    3
⚡ Duration: 4m 12s
📊 Score:   87/100

Failures:
• Checkout: Payment declined message missing
• Profile: Avatar upload timeout
• Search: Zero results on valid query

Full report → [link]
```

### Jira Bug (auto-created on failure)
- Title: auto-generated from the test name and failure type
- Steps to reproduce: captured from the test steps
- Screenshot: attached automatically
- Severity: classified by AI

---

## Supported Environments

AIQA works across your entire software delivery lifecycle:

```
  Development      Staging         Production Monitoring
  ──────────────   ─────────────   ─────────────────────
  Headless=false   Headless=true   Headless=true
  1 worker         4 workers       4 workers
  Localhost        Staging URL     Prod URL (read-only)
  Fast feedback    Full suite      Synthetic monitoring
```

---

## What AIQA Is NOT

To set correct expectations:

- **Not a manual testing replacement for exploratory testing** — humans still find edge cases AI doesn't think of
- **Not a performance/load testing tool** — it tests correctness, not throughput
- **Not a security penetration testing tool** — it validates expected behavior, not attack vectors
- **Not a replacement for unit tests** — works best at the integration/end-to-end layer

---

## Getting Started: The 3-Step Quick Start

### Step 1: Point it at your app
```bash
# Install
npm install -g aiqa

# Configure your app URL
aiqa init --url https://yourapp.com
```

### Step 2: Let it explore and generate tests
```bash
# One command: explore → map → generate → run → score
aiqa orchestrate --env staging
```

### Step 3: Review the report
Open the HTML report or web portal. Review the readiness score. Check that the discovered user flows match what your product actually does.

From that point forward, tests run automatically on every code change.

---

## Total Cost of Ownership vs. Traditional QA

| | Traditional QA | AIQA |
|---|---|---|
| **Setup time** | Weeks–months | Hours |
| **Test authoring** | Manual by engineers | AI-generated |
| **Maintenance after UI change** | Hours of engineer time | Automatic (self-healing) |
| **Tool sprawl** | 5+ separate tools | One platform |
| **Test coverage depth** | What humans thought to test | All discovered user flows |
| **Time to first test run** | Days | Minutes |
| **CI integration** | Custom scripting | Built-in (GitHub Actions, Jenkins) |
| **Failure visibility** | Check logs manually | Slack/email/Jira automatic |

---

## Glossary for Non-Technical Readers

| Term | Plain English Meaning |
|------|-----------------------|
| **DSL (Domain Specific Language)** | The simple YAML format tests are written in |
| **Selector** | The technical identifier used to find a button or field on a page |
| **Self-healing** | The AI's ability to fix broken test references automatically |
| **Orchestrate** | The one-click button that runs the full explore → generate → test pipeline |
| **Playwright** | The browser automation engine that drives the actual browser clicks |
| **LLM** | The AI language model (Claude, GPT-4, Gemini) that generates and diagnoses |
| **CI/CD** | The automated pipeline that runs tests every time code is pushed |
| **Flakiness** | A test that sometimes passes and sometimes fails for no clear reason |
| **Impact Filter** | Running only the tests affected by the latest code change (faster CI) |
| **Readiness Score** | The 0–100 number summarizing your software's current quality |
| **Xray** | A Jira plugin for managing test execution records |
| **WebSocket** | Technology that lets the portal show live test progress in real time |
| **RAG** | AI technique that makes the test generator aware of your Jira requirements |
