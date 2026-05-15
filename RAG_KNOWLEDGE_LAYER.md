# AIQA — RAG Knowledge Layer Vision

> Status: **Parked — future epic, post current backlog**
> Captured: 2026-05-15
> Author: Strategic session with Mahesh Mutukula

---

## The Problem This Solves

Current AIQA generates tests by *exploring what is on the page* (structural intelligence).
It does not know *what matters about what is on the page* — the business rules, the known failure history, the risk areas that caused P1s last quarter.

That knowledge exists in every enterprise — scattered across Jira, Confluence, Xray, Zephyr, Postman, RCA docs, and engineers' heads. It is never used at test generation time.

**The RAG Knowledge Layer closes this gap.**

---

## Core Idea

Introduce a knowledge ingestion and retrieval layer that continuously learns from enterprise SDLC/STLC artifacts, then injects that context into every test generation decision AIQA makes.

When a user asks:
> "Generate tests for checkout coupon functionality"

The system:
1. Retrieves: related user stories, acceptance criteria, past defect patterns for checkout, known edge cases (coupon + loyalty points), API contract for the promo endpoint
2. Understands: risk areas, prior failure modes, business rules
3. Generates: ready-to-run YAML tests that reflect organizational knowledge — not just what's visible on screen

---

## Vision Statement

> **"Your QA platform that knows what your organization knows — and never forgets."**

This is not test generation. It is **Institutional QA Memory** — a new product category.

---

## Knowledge Sources (Ingestion Targets)

| Source | What It Contributes |
|--------|---------------------|
| Jira Stories | Acceptance criteria, feature intent, scope |
| Jira Defect History | Known failure patterns, recurring bugs, risky areas |
| Xray / Zephyr | Historical test coverage, what has been tested before |
| Confluence Pages | Test plans, release notes, runbooks, architecture docs |
| Postman / OpenAPI | API contracts, expected request/response shapes |
| Git history | What changed, what broke after what commit |
| Production incidents / RCA | High-risk areas, cascading failure patterns |
| Regression suites | What the team has learned is worth re-testing |

---

## Platform Architecture (Conceptual)

```
┌──────────────────────────────────────────────────────────┐
│                   KNOWLEDGE LAYER (NEW)                   │
│                                                          │
│  Connectors → Chunker → Embedder → Vector DB            │
│  (Jira, Confluence, Xray, Git, Postman, Incidents)      │
│                                                          │
│  Permission-aware retrieval (source ACL inherited)       │
│  TTL / change-detection to prevent stale knowledge       │
│  Provenance tracking (which source informed which test)  │
└───────────────────────┬──────────────────────────────────┘
                        │  context chunks injected here
                        ▼
┌──────────────────────────────────────────────────────────┐
│                  REASONING LAYER (AIQA TODAY)             │
│                                                          │
│  OrchestratorAgent → FlowMapper → ScenarioGenerator     │
│  Runner → Healer → ReadinessScorer                       │
│                                                          │
│  FlowMapper already accepts context → RAG is additive   │
│  JiraAdapter already fetches stories → extend, not redo │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│                  EXECUTION LAYER                          │
│  Playwright → API Executor → DB Validator                │
└──────────────────────────────────────────────────────────┘
```

**Key architectural note:** RAG enriches the *prompt context* passed to existing agents.
FlowMapper, ScenarioGenerator, and the Healer already consume LLM context.
The knowledge layer is a new input source — it does not replace current agents.

---

## Autonomous Workflow Potential

```
Code change detected (GitHub PR / git diff)
        ↓
Impact filter identifies affected flows (EPIC-12 already planned)
        ↓
Knowledge layer retrieves: related stories, defect history, risk tags
        ↓
Generator creates targeted tests for the changed surface
        ↓
Human sign-off before merge (trust gate — always keep this)
        ↓
Test results feed back into knowledge layer (closed loop)
        ↓
System learns: which patterns catch real bugs in this org
```

The **closed loop** is the differentiator. Every test run outcome — pass, fail, flaky —
becomes a training signal that improves future test generation quality for this org specifically.

---

## Enterprise Requirements (Non-Negotiable)

1. **On-premise deployment** — vector DB and LLM must run fully air-gapped (BFSI, healthcare, defense requirement)
2. **Permission inheritance** — knowledge from restricted Confluence pages must not leak across team boundaries
3. **Provenance / audit trail** — every generated test must carry: which story, which defect, which spec informed it
4. **Knowledge health score** — warn when source data quality is too low to generate reliable tests
5. **Connector plugin architecture** — so community/customers can maintain connectors without core team bottleneck

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Stale knowledge (18-month-old stories describe a UI that no longer exists) | TTL + change-detection on source documents |
| Embedding drift as requirements evolve | Re-embed on source update, not just on schedule |
| LLM blending retrieved chunks incorrectly | Show source chunk alongside generated test for human validation |
| Connector maintenance cost sprawl | Plugin architecture — connectors are external, not core |
| QA engineer trust ("is it replacing me?") | Human sign-off gate + "it handles boilerplate, you handle exploratory" positioning |
| Data quality = output quality | Knowledge health score surfaced in UI before generation |

---

## Differentiation

| Dimension | Selenium/Playwright | Current AIQA | AIQA + Knowledge Layer |
|-----------|--------------------|--------------|-----------------------|
| Test source | Engineer writes | AI explores UI | AI understands business intent |
| Context awareness | None | Page structure | Org history + requirements |
| Maintenance | Manual | Self-healing | Context-aware healing + risk prediction |
| Coverage | What engineer thinks of | What is visible | What is historically risky |
| Learning | None | None | Continuously improves per org |
| Enterprise fit | Good | Emerging | Native |

**The one-line pitch:**
> Traditional tools test what you *tell* them to test. AIQA tests what your organization has *learned* matters.

---

## Evolution Path (Phases)

| Phase | What It Does |
|-------|-------------|
| 1 (now) | Test web apps from exploration + human-provided YAML |
| 2 (current backlog) | Test web apps with impact-awareness (git diff → affected flows) |
| 3 (this vision) | Test web apps with full organizational knowledge context |
| 4 (agentic) | Autonomous agents monitor production, generate probes, file defects, update knowledge |
| 5 (AI system testing) | Test customers' own AI models — prompt injection, output consistency, hallucination rates |

Phase 5 is not speculative — as customers deploy AI features, AIQA's architecture applies directly.
The "application under test" becomes an LLM rather than a web UI. Same agent architecture, new target.

---

## What Current Architecture Already Does Right (No Changes Needed)

These decisions made today will support the knowledge layer when we build it:

- **FlowMapper accepts LLM context** — can accept retrieved knowledge chunks with no interface change
- **JiraAdapter already fetches stories** — the connector pattern is established; extend to full ingestion pipeline
- **Structured logger** — provenance events need structured, queryable logs; already in place
- **Circuit breaker on LLM calls** — retrieval + generation chains will need the same resilience
- **StepInterpreter HandlerRegistry is injectable** — knowledge-aware handlers can be swapped in for testing
- **API layer exists** — knowledge ingestion and retrieval will be REST endpoints on the same server
- **On-premise deployment already works** — the air-gap requirement is already met by design

---

## Suggested Build Sequence (When We Return To This)

1. **Jira-only RAG context** — lowest connector cost, already partially integrated via JiraAdapter. Prove that retrieved story context improves FlowMapper output quality vs exploration-only.
2. **Defect history retrieval** — closes the "we've seen this before" loop. Feed Jira defect fields into retrieval index alongside stories.
3. **Provenance output** — every generated test YAML carries `# source: JIRA-123, defect-history:checkout` comments.
4. **Confluence + OpenAPI connectors** — broader context, higher coverage quality.
5. **Closed-loop learning** — test outcomes feed back into knowledge index as weighted signals.
6. **Permission-aware retrieval** — required before any multi-tenant or enterprise SaaS deployment.
7. **Agentic monitoring** — production anomaly detection triggers autonomous test probe generation.

---

*This document is a strategic vision record. It does not represent committed scope.*
*Revisit after EPIC-12 (Impact Filter) and EPIC-Jira-Full (full Jira/Slack/Email integration) are complete.*
