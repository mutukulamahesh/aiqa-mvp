# Contributing to AIQA

Thanks for your interest. AIQA is open-core: the engine, CLI, and all integrations are Apache-2.0. Contributions are welcome via pull request.

---

## Local dev setup

**Prerequisites:** Node 20+, npm 10+, Git.

```bash
git clone https://github.com/mutukulamahesh/aiqa-mvp
cd aiqa-mvp
npm install
npx playwright install chromium
cp .env.example .env          # add your API keys (optional — dev uses mock LLM by default)
```

Verify everything works:

```bash
npx tsc --noEmit              # must be clean
npx jest --no-coverage        # 858 tests, ~90 s
npx ts-node src/cli.ts doctor # system health check
```

---

## Project structure

| Path | What lives here |
|---|---|
| `src/cli.ts` | All CLI commands — single entry point |
| `src/config/ConfigLoader.ts` | Zod-validated config loader |
| `src/runner/TestRunner.ts` | Test execution engine |
| `src/execution/StepInterpreter.ts` | DSL step dispatcher |
| `src/healer/SelectorHealer.ts` | LLM-powered selector repair |
| `src/knowledge/` | RAG layer (ingest, retrieve, rerank) |
| `src/reporters/` | HTML, Slack, Email, JUnit, Allure, Uptime reporters |
| `src/agents/` | Orchestrator, Explorer, FlowMapper, ScenarioGenerator |
| `src/handlers/` | One file per DSL step type |
| `src/integrations/` | Jira, Confluence adapters |
| `tests/` | Jest test suites (mirrors `src/`) |
| `config/environments/` | `dev.yaml`, `staging.yaml`, `prod.yaml` |

---

## Making changes

### Branches

- Feature branches off `main`: `feat/short-description`
- Bug fixes: `fix/short-description`
- Docs only: `docs/short-description`

### Before opening a PR

```bash
npx tsc --noEmit              # zero errors required
npx jest --no-coverage        # all tests must pass
```

### Commit style

```
feat(scope): what and why
fix(scope): what was wrong and what changed
docs(scope): what docs changed
```

Scope is the subsystem: `cli`, `healer`, `knowledge`, `runner`, `dex`, `oss`, etc.

### Test conventions

- Every new handler or utility needs a corresponding `tests/**/*.test.ts` file
- Use `StubEmbedder` (not real embeddings) in any test that touches knowledge code
- Use injectable `transport?` constructor arg for HTTP connector tests — never mock `https.request` globally
- Tests must pass with `provider: mock` — no real API calls in CI
- Do not snapshot-test output strings that include timestamps or run IDs

### Comments

Write no comments unless the *why* is non-obvious (a hidden constraint, a workaround for a specific bug, a subtle invariant). Never write docstrings or multi-line comment blocks.

---

## Adding a new DSL step

1. Create `src/handlers/YourHandler.ts` implementing the step logic
2. Register it in `src/execution/StepInterpreter.ts` `HandlerRegistry`
3. Add the step type to `src/dsl/DslParser.ts` schema
4. Write tests in `tests/handlers/your-handler.test.ts`
5. Document the step in the **DSL quick reference** section of `README.md`

---

## Adding a new LLM provider

1. Implement `LLMProvider` interface in `src/llm/providers/YourProvider.ts`
2. Register the provider string in `src/llm/LLMProvider.ts` `createLLMProvider()`
3. Add it to the `privacy_mode` allowlist comment if it is a local provider
4. Write tests using `StubLLM` or a recorded fixture — no live API calls in CI

---

## PR checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npx jest --no-coverage` all passing
- [ ] New behaviour covered by tests
- [ ] `CHANGELOG.md` `[Unreleased]` section updated
- [ ] No `.env` or secrets committed
- [ ] No hardcoded URLs or timeouts (use config)

---

## Reporting bugs

Open a GitHub Issue with:
- AIQA version (`aiqa --version`)
- OS and Node version
- Minimal reproduction (YAML test file if relevant)
- `aiqa doctor` output

---

## Questions

Use [GitHub Discussions](https://github.com/mutukulamahesh/aiqa-mvp/discussions) for questions, ideas, and roadmap feedback.
