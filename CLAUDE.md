# AIQA — Claude Code Instructions

## What this project is
Enterprise AI QA Platform. TypeScript + Node 20. Tests written in YAML DSL, executed via
Playwright. Self-healing selectors, LLM judge, RAG knowledge layer, Jira integration, REST API,
Chrome Extension, Portal. Not an MVP — production-grade.

---

## CRITICAL RULES — never violate these

1. **NEVER run `git push` unless the user explicitly says "push".** Say "ready to push?" instead.
2. **NEVER run `git commit` unless the user explicitly says "commit".** Stage + diff, then wait.
3. **NEVER commit `.env`** — Jira API token (`JIRA_API_TOKEN`) and all LLM API keys live there only.
4. **Always run `npx tsc --noEmit` + `npx jest --no-coverage` before reporting a task complete.**
5. **Read `BACKLOG.md` before starting any new epic** — it has the agreed story list and architecture notes.
6. **Feature work on named branches** (e.g. `rag3`, `phase5-genai`). Merge to `main` only after a clean review cycle.
7. **Do not add comments** unless the WHY is non-obvious. Never write docstrings or multi-line comment blocks.

---

## Environment

- **OS:** Windows 11, local VS Code + Claude Code extension
- **Working dir:** `d:\AI\Projects\aiqa-mvp`
- **Shell:** PowerShell — use `$env:VAR`, `;` to chain (not `&&`), backtick for line continuation
- **Portal:** `http://localhost:7432`
- **Jira:** `https://aiqajira.atlassian.net` · project key `SCRUM` (not AIQA) · email `mmk.mutu@gmail.com`
- **LLM keys:** in `.env` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. Dev config defaults to `mock`.

---

## Commands

```bash
npx ts-node src/cli.ts run tests/example.yaml          # run one test file
npx ts-node src/cli.ts run-all tests/ --headless       # run all tests
npx ts-node src/cli.ts orchestrate --url <url>         # full explore→generate→run pipeline
npx ts-node src/cli.ts knowledge ingest                # ingest all configured connectors
npx ts-node src/cli.ts knowledge readiness --tag login # READY/PARTIAL/MISSING for a tag
npx ts-node src/cli.ts serve                           # start REST+WS API on port 7432
npx tsc --noEmit                                       # type check (must be clean before commit)
npx jest --no-coverage                                 # full test suite (858 tests, ~90s)
```

---

## Architecture — key files

| File | Role |
|---|---|
| `src/cli.ts` | All CLI commands — single entry point, ~1600 lines |
| `src/config/ConfigLoader.ts` | Zod-validated YAML config loader; `loadConfig(env)` / `getConfig()` |
| `src/runner/TestRunner.ts` | Executes a test suite; wires Healer + MemoryStore + KnowledgeStore |
| `src/execution/StepInterpreter.ts` | Dispatches DSL steps to handlers; holds `HandlerRegistry` |
| `src/dsl/DslParser.ts` | Parses `.yaml` test files into `TestDefinition[]` |
| `src/agents/OrchestratorAgent.ts` | Explore → map → generate → run full pipeline |
| `src/agents/FlowMapper.ts` | Maps explored pages to test flows; wired to KnowledgeRetriever |
| `src/healer/SelectorHealer.ts` | 4-strategy selector healing; optional KnowledgeRetriever (3rd constructor arg) |
| `src/handlers/JudgeHandler.ts` | `judge:` DSL step; LLM scores 0–1; optional KnowledgeRetriever for AC context |
| `src/knowledge/KnowledgeStore.ts` | Combines Embedder + VectorIndex; ingest/retrieve/feedback/listAll |
| `src/knowledge/KnowledgeRetriever.ts` | Standalone retriever; wraps KnowledgeStore; used by Healer + Judge + FlowMapper |
| `src/knowledge/VectorIndex.ts` | vectra LocalIndex wrapper; add/search/updateConfidence/listAll |
| `src/knowledge/types.ts` | `KnowledgeChunk`, `RetrievedChunk`, `KnowledgeConfig`, `RerankerConfig` |
| `src/impact/ImpactMapper.ts` | git diff → changed files → affected test files |
| `src/integrations/JiraAdapter.ts` | Jira REST API; createDefect, syncXray, getIssue |
| `src/server.ts` | Express + WS API server (port 7432); delegates to routes in `src/api/` |

### Knowledge Layer sub-map (`src/knowledge/`)

```
types.ts                    ← KnowledgeChunk, RetrievedChunk, RerankerConfig
Embedder.ts                 ← all-MiniLM-L6-v2 local; StubEmbedder for CI (no download)
VectorIndex.ts              ← vectra wrapper
KnowledgeStore.ts           ← ingest / retrieve / feedback / listAll
KnowledgeRetriever.ts       ← standalone; retrieve(query, topK)
KnowledgeIngester.ts        ← runs connectors, deduplicates, writes meta.json
HealthScorer.ts             ← GOOD/WARN/STALE/EMPTY from meta.json
ReadinessScorer.ts          ← class KnowledgeReadinessScorer (NOT ReadinessScorer — see note)
chunkers/
  NaiveChunker.ts           ← max 2000 chars per chunk
  ACChunker.ts              ← one chunk per AC bullet; prose via NaiveChunker pass
rerankers/
  CosineSimilarityReranker.ts
  HybridReranker.ts         ← 4-weight formula; weights come from config, not hardcoded
connectors/
  JiraConnector.ts          ← stories + defects; ADF → plain text
  ConfluenceConnector.ts    ← REST API v1; terminates on results<PAGE_SIZE||!_links?.next
  OpenAPIConnector.ts       ← JSON/YAML spec; one chunk per path×method
  GitConnector.ts           ← git log + --name-only; conventional-scope → tags
```

**Naming collision to remember:**
- `src/agents/ReadinessScorer` — test results → 0–100 score (imported at top of cli.ts)
- `src/knowledge/ReadinessScorer` exports `KnowledgeReadinessScorer` — READY/PARTIAL/MISSING by tag (dynamic import in cli.ts readiness command)

---

## Testing discipline

- **StubEmbedder** — always use in tests that touch knowledge code; never triggers model download
- **Injectable transport** — all HTTP connectors (JiraConnector, ConfluenceConnector, OpenAPIConnector) accept a `transport?` constructor arg for test fakes; use that pattern, never mock `https.request` globally
- **Jest config:** `jest.config.ts` → `testEnvironment: node`, `testMatch: **/tests/**/*.test.ts`
- **Test suites:** 26 suites, 701 tests as of 2026-05-21

---

## Config structure

`config/environments/{dev,staging,prod}.yaml` — validated by Zod schema in `ConfigLoader.ts`.

Key sections:
```yaml
llm:
  provider: mock | anthropic | openai | nvidia | gemini
  fallback: []

knowledge:
  enabled: false          # set true + run ingest to activate RAG
  indexPath: .aiqa/knowledge
  topK: 5
  chunker: naive | ac-aware
  reranker:
    strategy: cosine | hybrid
    semanticWeight: 0.6
    recencyWeight:  0.2
    severityWeight: 0.1
    sourceWeight:   0.1
  connectors:
    - type: jira
      projectKey: SCRUM
    - type: confluence
      spaceKey: ENG
    - type: openapi
      url: https://...
    - type: git
      lookbackDays: 30

jira:
  baseUrl: https://aiqajira.atlassian.net
  projectKey: SCRUM
  email: mmk.mutu@gmail.com
```

---

## Current state (2026-05-28)

- **Branch:** `main` at `b82851b` (merged from `vision`)
- **Tests:** 972 passing, 42 suites, tsc clean
- **All strategic epics complete:** EPIC-DEX ✅, EPIC-OSS ✅, EPIC-LOCAL ✅, EPIC-MON ✅
- **EPIC-RAG Phase 1 + Phase 2 + Phase 3:** complete and merged to main
- **Phase 5 — GenAI Testing:** complete and merged to main
- **Phase 6 — EPIC-14 Vision Agent:** complete and merged to main (61 new tests)
- **Active:** EPIC-15 Desktop Automation (not started — next up)
- **Parked:** EPIC-EXT-A (Chrome extension API-backed), OSS-04 (manual GitHub Discussions)
- **Vision design locked:** no `suggestedSelector` in VisionAgent output; `vision_assert` is pure detector (no action field); SmartLocatorEngine DOM-validates every selector; ObjectRepository composite key (url+title); `visual_snapshot` uses `max_diff_percent` + `sensitivity` (not conflated `threshold`); `normalizeUrl` lowercases hostname only (not full URL)

### Phase 5 stories — ALL COMPLETE ✅

| ID | Story | Size | Status |
|---|---|---|---|
| GEN-01 | `llm_eval:` — named `target:` from `llm_targets` config, call LLM, judge quality | S | ✅ |
| GEN-04 | `llm_consistency:` — N runs sequential, max pairwise cosine distance, configurable to mean | M | ✅ |
| GEN-05 | `rag_assert:` — KnowledgeRetriever assertions; wired same as JudgeHandler | S | ✅ |
| GEN-02 | Prompt regression — `baseline_key` on `llm_eval`; baselines in `tests/baselines/` (VCS) | M | ✅ |
| GEN-03 | `agent_trace:` spike — schema + normalizers proven clean; deferred pending injectable transport | L | ✅ spike |

### Key Phase 5 files

| File | Role |
|---|---|
| `src/handlers/LLMEvalHandler.ts` | `llm_eval:` step; resolves target LLM, judges with AIQA internal; baseline regression |
| `src/handlers/ConsistencyHandler.ts` | `llm_consistency:` step; N runs + max pairwise variance |
| `src/handlers/RagAssertHandler.ts` | `rag_assert:` step; wraps KnowledgeRetriever |
| `src/ai-testing/BaselineStore.ts` | Reads/writes `tests/baselines/{key}.json`; path traversal guard; async I/O |
| `src/ai-testing/VarianceComputer.ts` | Pairwise cosine similarity via Embedder; max/mean; exports `cosineDist` |
| `src/ai-testing/TraceParser.ts` | GEN-03 spike: normalises OpenAI + LangChain traces; depth guard; deferred |

### Phase 6 — EPIC-14 Vision Agent — ALL COMPLETE ✅

| ID | Story | Size | Status |
|---|---|---|---|
| 14.1 | `VisionAgent` — analyzeBuffer/analyze split; Claude Vision → DetectedElement[]; StubVisionAgent | S | ✅ |
| 14.2 | `OcrEngine` — lazy tesseract.js; bbox normalization; StubOcrEngine | S | ✅ |
| 14.5 | `ObjectRepository` — SHA-256 composite key; hostname-only normalizeUrl; atomic write; merge | M | ✅ |
| 14.3 | `SmartLocatorEngine` — OCR proximity + type candidates; DOM count validation; SelectorHealer strategy-5 | M | ✅ |
| 14.4 | `VisualRegression` — pixelmatch diff; max_diff_percent vs sensitivity; diff image on failure | M | ✅ |
| — | `VisionAssertHandler` — vision_assert DSL step; pure detector; store_as | S | ✅ |
| — | `VisualSnapshotHandler` — visual_snapshot DSL step; update/compare modes | S | ✅ |

### Key Phase 6 files

| File | Role |
|---|---|
| `src/vision/types.ts` | DetectedElement, OcrWord, BoundingBox, RepoKey, RepoEntry, VisionScanResult |
| `src/vision/VisionAgent.ts` | IVisionAgent, VisionAgent (Anthropic SDK direct), StubVisionAgent |
| `src/vision/OcrEngine.ts` | IOcrEngine, OcrEngine (tesseract.js lazy), StubOcrEngine |
| `src/vision/ObjectRepository.ts` | normalizeUrl (hostname-only), ObjectRepository (SHA-256 key, atomic write) |
| `src/vision/SmartLocatorEngine.ts` | DomValidator interface, SmartLocatorEngine.locate() |
| `src/vision/VisualRegression.ts` | VisualRegression.snapshot/compare; pixelmatch CJS shim via moduleNameMapper |
| `src/handlers/VisionAssertHandler.ts` | vision_assert step; pure detector; store_as |
| `src/handlers/VisualSnapshotHandler.ts` | visual_snapshot step; update/compare modes |
| `tests/__mocks__/pixelmatch.js` | CJS shim for pixelmatch v7 (pure ESM — incompatible with Jest CJS mode) |

---

## DSL quick reference

```yaml
name: test name
tags: [tag1, tag2]
source: [SCRUM-42]        # knowledge source IDs — drives feedback loop
steps:
  - navigate: https://...
  - click: "selector or descriptor"
  - fill: { target: "field", value: "text" }
  - assert_text_visible: "expected text"
  - assert_url_contains: "/path"
  - assert_element_visible: "selector"
  - assert_element_not_visible: "selector"
  - store: { from: "selector", as: varName }
  - wait_for_element: "selector"
  - wait_ms: 500
  - if: { condition: "${var} == value", then: [...], else: [...] }
  - for_each: { items: [...], as: item, steps: [...] }
  - judge:
      prompt: "Was the checkout total calculated correctly?"
      value: "${capturedText}"
      pass_if: ">= 0.7"
  - api:
      method: POST
      url: "http://localhost/api/..."
      body: { key: value }
      assert_status: 201
  - db:
      query: "SELECT * FROM users WHERE id = ?"
      params: [1]
      assert_rows: 1
  - llm_eval:
      target: fast                          # resolves via config.llm_targets
      prompt: "Translate 'hello' to French"
      assert_quality:
        criteria: "Response is a correct French translation"
        pass_if: "score >= 0.8"
      baseline_key: translate-hello         # optional drift regression
      max_drift: 0.15
      store_as: evalResult
  - llm_consistency:
      target: fast
      prompt: "What is the capital of France?"
      runs: 5
      assert_variance:
        max: 0.1
        metric: max                         # max | mean
      store_as: consistencyResult
  - rag_assert:
      query: "user authentication acceptance criteria"
      min_chunks: 2
      min_score: 0.7
      store_as: ragResult
```
