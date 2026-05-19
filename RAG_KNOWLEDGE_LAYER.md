# AIQA — RAG Knowledge Layer

> Status: **Active — Phase 1 in planning (2026-05-19)**
> Original capture: 2026-05-15
> Author: Mahesh Mutukula

---

## The Problem This Solves

Current AIQA generates tests by *exploring what is on the page* (structural intelligence).
It does not know *what matters about what is on the page* — the business rules, the known failure
history, the risk areas that caused P1s last quarter.

That knowledge exists in every enterprise — scattered across Jira, Confluence, Xray, Zephyr, Postman,
RCA docs, and engineers' heads. It is never used at test generation time.

**The RAG Knowledge Layer closes this gap.**

---

## Vision Statement

> **"Your QA platform that knows what your organisation knows — and never forgets."**

This is not test generation. It is **Institutional QA Memory** — a new product category.

---

## Zero-Cost Stack (Phase 1)

| Need | Tool | Cost |
|------|------|------|
| Embed text → searchable numbers | `@xenova/transformers` · `all-MiniLM-L6-v2` (25 MB, runs locally) | Free — no API key |
| Store + search those numbers | `vectra` (pure Node.js, saves to local JSON file) | Free — no server |

No cloud. No API keys. No Docker. Two `npm install`s.

---

## Input → Output Flow

```
INGEST  (aiqa knowledge ingest --jira SCRUM)
────────────────────────────────────────────
JiraConnector.fetch()
  → stories + defects from Jira REST API
  → ADF description + AC + title → plain text
  → NaiveChunker splits into KnowledgeChunks (max 2000 chars)

KnowledgeIngester
  → deduplicate by sourceId
  → Embedder.embed(chunk.text) → number[384]
  → VectorIndex.add(chunk, vector)
  → writes .aiqa/knowledge/index/ + meta.json

OUTPUT:
  Fetched 47 stories, 23 defects
  Embedded 312 chunks → .aiqa/knowledge/index/
  Health: GOOD (312 chunks, avg age 3 days)

────────────────────────────────────────────
RETRIEVE  (at generate / orchestrate time)
────────────────────────────────────────────
KnowledgeRetriever.retrieve("checkout coupon page")
  → Embedder.embed(query) → number[384]
  → VectorIndex.search(vector, topK=5)
  → CosineSimilarityReranker.rerank(candidates)
  → returns top 5 RetrievedChunks ranked by score

[
  { text: "SCRUM-12: Coupon validated before loyalty points", score: 0.91 },
  { text: "SCRUM-34: Loyalty discount applied twice (defect)", score: 0.87 },
  { text: "SCRUM-41: Checkout timeout on slow network",       score: 0.81 },
]

────────────────────────────────────────────
GENERATE  (existing FlowMapper + ScenarioGenerator)
────────────────────────────────────────────
FlowMapper.map(exploration, ragContext)
  → LLM sees: page structure + retrieved org knowledge
  → generates flows covering known edge cases

ScenarioGenerator.generate(flows, ragContext)
  → YAML tests carry source: [SCRUM-12, SCRUM-34]
```

---

## Data Model

```typescript
interface KnowledgeChunk {
  text:        string;
  sourceId:    string;                              // "SCRUM-42"
  sourceName:  string;                              // "jira"
  type:        "story" | "defect" | "page" | "api" | "git";
  tags:        string[];                            // ["checkout", "coupon"]
  severity?:   "critical" | "high" | "medium" | "low";
  version?:    string;                              // "2.4.1"
  confidence:  number;                              // 1.0 default; feedback loop updates
  relations:   { type: string; targetId: string }[]; // Knowledge Graph — empty in Phase 1
  ingestedAt:  string;                              // ISO date — enables recency scoring
}

interface RetrievedChunk extends KnowledgeChunk {
  score: number;   // 0.0–1.0 cosine similarity (Phase 1); hybrid score (Phase 2)
}
```

---

## Plugin Interfaces (all injectable, all testable)

### Chunker
```typescript
interface Chunker {
  chunk(text: string, metadata: ChunkMetadata): KnowledgeChunk[];
}

// Phase 1: character-based, ships now
class NaiveChunker implements Chunker { ... }      // max 2000 chars

// Phase 2: one chunk per AC bullet
class ACChunker implements Chunker { ... }

// Phase 3: LLM-assisted boundary detection
class SemanticChunker implements Chunker { ... }
```

Config-driven: `knowledge.chunker: naive | ac-aware | semantic`

### Reranker
```typescript
interface Reranker {
  rerank(query: string, candidates: RetrievedChunk[]): RetrievedChunk[];
}

// Phase 1: pure cosine similarity, ships now
class CosineSimilarityReranker implements Reranker { ... }

// Phase 2: multi-signal hybrid
class HybridReranker implements Reranker {
  // score = (0.6 × semantic) + (0.2 × recency) + (0.1 × severity) + (0.1 × sourceWeight)
}
```

### Embedder
```typescript
interface IEmbedder {
  embed(text: string): Promise<number[]>;
}

// Production: real local model, lazy-loads on first call
class Embedder implements IEmbedder { ... }

// CI / tests: deterministic, no model download
class StubEmbedder implements IEmbedder {
  async embed(text: string): Promise<number[]> {
    const seed = text.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 384 }, (_, i) => Math.sin(seed + i));
  }
}
```

### KnowledgeConnector
```typescript
interface KnowledgeConnector {
  name: string;
  fetch(): Promise<KnowledgeChunk[]>;
}

// Phase 1: implemented
class JiraConnector implements KnowledgeConnector { ... }

// Phase 2: stubs only in Phase 1
class ConfluenceConnector implements KnowledgeConnector { ... }
class OpenAPIConnector  implements KnowledgeConnector { ... }
class GitConnector      implements KnowledgeConnector { ... }
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE LAYER                            │
│                                                              │
│  Connectors → Chunker → Embedder → VectorIndex              │
│  (Jira ✅  Confluence ⬜  OpenAPI ⬜  Git ⬜)                 │
│                                                              │
│  KnowledgeRetriever ← query → Reranker → RetrievedChunks   │
│  KnowledgeStore.feedback() ← execution outcomes (Phase 2)   │
│  GraphEnricher (relations traversal — Phase 3)               │
└────────────────────────┬─────────────────────────────────────┘
                         │  context chunks injected here
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   REASONING LAYER (AIQA today)               │
│                                                              │
│  FlowMapper ✅ · ScenarioGenerator ✅                         │
│  HealerAgent ⬜ · JudgeHandler ⬜ · ImpactMapper ⬜           │
│  ReadinessScorer ⬜ (Phase 2 wiring)                         │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** RAG enriches the *prompt context* passed to existing agents.
It does not replace or restructure any existing component.

---

## File Structure

```
src/
  knowledge/
    types.ts                    ← KnowledgeChunk, RetrievedChunk, KnowledgeConfig
    Embedder.ts                 ← @xenova/transformers wrapper (lazy-load, injectable)
    VectorIndex.ts              ← vectra LocalIndex wrapper
    KnowledgeStore.ts           ← ingest + retrieve + feedback stub
    KnowledgeIngester.ts        ← runs connectors → deduplicates → stores → meta.json
    KnowledgeRetriever.ts       ← standalone query interface (used by FlowMapper etc.)
    HealthScorer.ts             ← GOOD / WARN / STALE / EMPTY from meta.json
    chunkers/
      Chunker.ts                ← interface
      NaiveChunker.ts           ← Phase 1 impl (max 2000 chars)
    rerankers/
      Reranker.ts               ← interface
      CosineSimilarityReranker.ts ← Phase 1 impl
    connectors/
      KnowledgeConnector.ts     ← interface
      JiraConnector.ts          ← Phase 1: stories + defects
      ConfluenceConnector.ts    ← Phase 2: stub only
      OpenAPIConnector.ts       ← Phase 2: stub only
      GitConnector.ts           ← Phase 2: stub only

tests/
  knowledge/
    embedder.test.ts            ← StubEmbedder only, no model download
    vector-index.test.ts        ← real vectra, temp dir
    knowledge-store.test.ts     ← StubEmbedder + real vectra
    jira-connector.test.ts      ← injectable transport
    knowledge-ingester.test.ts
    knowledge-retriever.test.ts
    flow-mapper-rag.test.ts     ← chunks appear in LLM prompt

.aiqa/
  knowledge/
    index/                      ← vectra files (gitignored, regenerated from Jira)
    meta.json                   ← chunk count, last ingested, sources, health
```

---

## Config

```yaml
# config/environments/dev.yaml
knowledge:
  enabled: true
  indexPath: ".aiqa/knowledge"
  topK: 5
  chunker: naive
  connectors:
    - type: jira
      projectKey: SCRUM
```

```yaml
# staging / prod
knowledge:
  enabled: true
  indexPath: ".aiqa/knowledge"
  topK: 5
  chunker: naive
  connectors:
    - type: jira
      projectKey: SCRUM
    # - type: confluence    ← Phase 2
    #   spaceKey: QA
    # - type: openapi       ← Phase 2
    #   url: https://api.example.com/openapi.json
```

---

## CLI

```bash
# Build / refresh the knowledge index
aiqa knowledge ingest --jira SCRUM

# Output:
#   Fetched 47 stories, 23 defects
#   Embedded 312 chunks → .aiqa/knowledge/index/
#   Health: GOOD (312 chunks, avg age 3 days)

# Check index health without re-ingesting
aiqa knowledge status

# Output:
#   Source      Chunks   Last ingested   Status
#   jira        312      2026-05-19      GOOD
#   Total       312      avg age 3 days  GOOD

# Generate with RAG (automatic if knowledge.enabled = true and index exists)
aiqa generate --out my-app --jira SCRUM
#   Retrieved 5 chunks for "checkout" (SCRUM-12, SCRUM-34, SCRUM-41)
#   Generated 8 scenarios (vs 5 without RAG)
```

---

## What Generated YAML Looks Like

```yaml
# Without RAG
test:
  name: "Checkout — place order"
  steps:
    - navigate: "/checkout"
    - click: "Place Order"
    - assert:
        text: "Order confirmed"

# With RAG
test:
  name: "Checkout — coupon validation before loyalty points"
  source: [SCRUM-12, SCRUM-34]
  steps:
    - navigate: "/checkout"
    - fill: { field: "Coupon code", value: "INVALID" }
    - assert:
        text: "Invalid coupon"
    - fill: { field: "Coupon code", value: "SAVE10" }
    - click: "Apply"
    - assert:
        text: "Loyalty points applied after coupon"
```

---

## Five Architectural Decisions (agreed 2026-05-19)

### 1. Hybrid Retrieval (Phase 2)
Phase 1 ships cosine-only. `Reranker` is injectable so Phase 2 upgrades without changing callers:
- `score = (0.6 × semantic) + (0.2 × recency) + (0.1 × severity) + (0.1 × sourceWeight)`
- All metadata needed for this formula is stored in Phase 1 chunks — no schema migration

### 2. Smart Chunking (Phase 2)
Phase 1 ships `NaiveChunker`. `Chunker` is injectable so Phase 2 upgrades without changing connectors:
- `ACChunker` — one chunk per AC bullet (more precise retrieval)
- `SemanticChunker` — LLM-assisted boundary detection (Phase 3)

### 3. Feedback Learning Loop (Phase 2)
`KnowledgeStore.feedback(sourceId, outcome)` is a stub in Phase 1. Phase 2 activates it:
- `TestRunner` calls `feedback()` after each test run
- Failed/flaky sources gain confidence → rank higher in retrieval
- Passed sources that never catch bugs slowly decay → rank lower
- Confidence scores feed into the hybrid reranker (decision 1)

### 4. Retrieval Beyond Generation (Phase 2)
`KnowledgeRetriever` is standalone — not coupled to `FlowMapper`. Any component can inject it:
- `HealerAgent` — "is this selector brittle based on past defects?"
- `JudgeHandler` — "is this LLM output consistent with known AC?"
- `ImpactMapper` — "what Jira stories does this git change touch?"
- `ReadinessScorer` — "what risk areas have P1 defect history?"

### 5. Knowledge Graph (Phase 3)
`relations[]` is present on every chunk in Phase 1 (empty array). Phase 3 adds:
- `GraphEnricher` post-retrieval step — expands chunks by one-hop traversal
- Multi-hop reasoning: story ↔ defect ↔ API ↔ test ↔ production incident
- Permission-aware retrieval (required for multi-tenant SaaS)

---

## Knowledge Sources Roadmap

| Source | Connector | Phase |
|--------|-----------|-------|
| Jira Stories + Defects | `JiraConnector` | ✅ Phase 1 |
| Confluence Pages | `ConfluenceConnector` | Phase 2 |
| OpenAPI / Postman | `OpenAPIConnector` | Phase 2 |
| Git history | `GitConnector` | Phase 2 |
| Production RCAs | `JiraConnector` (defect type) | Phase 1 (via defects) |
| Xray / Zephyr | `XrayConnector` | Phase 3 |
| AIQA run history | Internal feedback loop | Phase 2 |

---

## Enterprise Non-Negotiables

1. **On-premise deployment** — `@xenova/transformers` + `vectra` run fully air-gapped. No cloud dependency.
2. **Permission inheritance** — future: knowledge from restricted sources must not leak across team boundaries
3. **Provenance / audit trail** — every generated test carries `source: [SCRUM-12, SCRUM-34]`
4. **Knowledge health score** — `GOOD` / `WARN` / `STALE` / `EMPTY` surfaced in CLI before generation
5. **Connector plugin architecture** — new connectors implement one interface, zero core changes

---

## Definition of Done — Phase 1

- [ ] `aiqa knowledge ingest --jira SCRUM` builds index from real Jira (SCRUM project)
- [ ] `aiqa knowledge status` prints health score + source breakdown
- [ ] `aiqa generate` with `knowledge.enabled: true` produces YAML with `source:` fields
- [ ] `FlowMapper` generates more edge-case flows with RAG than without (manual comparison)
- [ ] All 38 knowledge tests pass (no real model download in CI — `StubEmbedder`)
- [ ] `tsc --noEmit` clean
- [ ] CI pipeline passes

---

*Phase 2 and Phase 3 are parked. Return to them after Phase 1 is stable and proven.*
