# Changelog

All notable changes to AIQA are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [1.5.0] — 2026-05-26

### Added — EPIC-OSS
- `CHANGELOG.md` and `CONTRIBUTING.md` for open-source community onboarding
- Open-core business model section in README
- `aiqa badge` command — generate embeddable Readiness Score SVG badge
- Readiness Score badge embeddable in downstream repo READMEs

### Added — EPIC-LOCAL / EPIC-MON
- `privacy_mode: true` config — blocks all outbound LLM providers at startup
- `aiqa doctor` Ollama probe — detects running instance + pulled model list
- "Data stays on-prem" README section with compliance checklist
- `--alert-webhook <url>` on `run-all` and `schedule` — Slack / Teams / PagerDuty
- `aiqa uptime [dir]` — rolling 30-day per-file pass/fail history with bar-chart display

### Added — EPIC-DEX
- Docker image + `docker-compose.yml`
- Shell install scripts (`install.sh` / `install.ps1`)
- Python wrapper shim (`pip install aiqa-runner`)
- `npx aiqa` zero-install runner
- GitHub Actions composite action (`uses: mutukulamahesh/aiqa-mvp@main`)
- Maven plugin (`mvn aiqa:run`)
- Gradle plugin (`./gradlew aiqaRun`)
- Python REST client (`pip install aiqa-client`, zero runtime deps)
- Java REST client (`java.net.http`, Java 11+, org.json only)
- VS Code extension (CodeLens, right-click run, results panel, YAML autocomplete)
- JetBrains plugin (IntelliJ / PyCharm / WebStorm action + tool window)

---

## [1.4.0] — 2026-05-22

### Added — Phase 5: GenAI Testing
- `llm_eval:` DSL step — evaluate LLM target quality with configurable criteria
- `llm_consistency:` DSL step — N-run variance check (max/mean pairwise cosine distance)
- `rag_assert:` DSL step — assert RAG retrieval meets min-chunk and min-score thresholds
- Prompt regression baseline (`baseline_key` + `max_drift` on `llm_eval:`)
- `BaselineStore` — reads/writes `tests/baselines/*.json`; path traversal guard
- `VarianceComputer` — pairwise cosine similarity via Embedder; max/mean strategies
- `TraceParser` spike — OpenAI + LangChain trace normalisation; deferred pending injectable transport

---

## [1.3.0] — 2026-05-19

### Added — EPIC-RAG Phase 3
- `HybridReranker` — 4-weight formula (semantic, recency, severity, source)
- `KnowledgeReadinessScorer` — READY / PARTIAL / MISSING per tag
- `aiqa knowledge readiness --tag <tag>` CLI command
- `aiqa knowledge status` — health dashboard (GOOD / WARN / STALE / EMPTY)
- `HealthScorer` — derives health grade from `meta.json` ingest metadata
- Confluence connector pagination fix (terminates on `results < PAGE_SIZE || !_links?.next`)
- `ACChunker` — one chunk per acceptance-criteria bullet; prose via `NaiveChunker` pass

---

## [1.2.0] — 2026-05-15

### Added — EPIC-RAG Phase 1 + 2
- RAG knowledge layer: `KnowledgeStore`, `KnowledgeRetriever`, `VectorIndex`, `Embedder`
- Connectors: Jira, Confluence, OpenAPI, Git
- `KnowledgeIngester` — deduplication + `meta.json` tracking
- `SelectorHealer` wired to `KnowledgeRetriever` (3rd constructor arg)
- `JudgeHandler` wired to `KnowledgeRetriever` for acceptance-criteria context
- `FlowMapper` wired to `KnowledgeRetriever`
- `aiqa knowledge ingest` CLI command
- `StubEmbedder` for CI (no model download)

---

## [1.1.0] — 2026-05-11

### Added — EPIC-API + Portal
- REST API server (`aiqa serve`, port 7432)
- WebSocket live streaming of run events
- Web portal (React + Vite): dashboard, run history, trend charts, settings
- Chrome extension (EPIC-EXT-B): run YAML from browser toolbar
- `aiqa import` — Excel / CSV / Gherkin → YAML test generation
- `aiqa jira-sync` — push failures to Jira; Xray execution sync
- Impact filter (`--impact-only`) — git diff → affected test files only
- JUnit XML reporter (`--junit`)
- Allure reporter (`--allure`)
- Trend tracking + flaky test analytics
- Artifact cleanup (`--retain-runs`)

---

## [1.0.0] — 2026-05-08

### Added — Sprints 1 + 2
- YAML DSL test runner (Playwright-backed)
- `aiqa run` / `aiqa run-all` / `aiqa orchestrate`
- `OrchestratorAgent` — explore → map → generate → run pipeline
- `SelectorHealer` — 4-strategy LLM-powered locator repair
- `LLMJudge` — 0–1 quality scorer for `judge:` steps
- Config system (`ConfigLoader`, Zod-validated, per-environment YAML)
- Parallel execution with `AsyncLocalStorage` worker isolation
- Circuit breaker (`--circuit-breaker`)
- Retry on transient failures (`retries:` in DSL)
- HTML reporter
- Slack + Email notifiers
- `aiqa doctor` — system health check
- `aiqa score` — 0–100 readiness scoring
- CI/CD pipeline (`.github/workflows/`)

---

## Migration notes

### 1.4.0 → 1.5.0
- No breaking changes. New `privacy_mode` config field defaults to `false`.
- `aiqa uptime` reads `results/uptime.json` — populated from the next `run-all` run onwards.
- VS Code extension: `aiqa.pollIntervalMs` setting replaced by `aiqa.maxPollIntervalMs` (default: 10 000 ms).

### 1.3.0 → 1.4.0
- No breaking changes. New `llm_targets` config section is optional.
- `llm_eval:` requires at least one entry in `llm_targets` to resolve a named target.

### 1.2.0 → 1.3.0
- `KnowledgeReadinessScorer` export renamed (was `ReadinessScorer` in early branch). Dynamic import path: `src/knowledge/ReadinessScorer`.
- `HybridReranker` weights now come from config (`reranker.semanticWeight` etc.), not hardcoded.

[Unreleased]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mutukulamahesh/aiqa-mvp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mutukulamahesh/aiqa-mvp/releases/tag/v1.0.0
