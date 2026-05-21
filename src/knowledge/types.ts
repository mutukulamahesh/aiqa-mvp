export interface KnowledgeChunk {
  text:             string;
  sourceId:         string;                                        // e.g. "SCRUM-42"
  sourceName:       string;                                        // e.g. "jira"
  type:             "story" | "defect" | "page" | "api" | "git";
  // RAG3-01: defect classification — healer uses "ui" only; "functional"/"regression" surface as warnings
  category?:        "ui" | "functional" | "regression";
  tags:             string[];
  severity?:        "critical" | "high" | "medium" | "low";
  version?:         string;
  confidence:       number;                                        // 1.0 default; feedback loop updates
  relations:        { type: string; targetId: string }[];          // Knowledge Graph — populated Phase 3
  ingestedAt:       string;                                        // ISO date
  sourceUpdatedAt?: string;                                        // ISO date from source system; recency signal for HybridReranker
}

// RAG3-02: sub-score breakdown preserved through reranker for auditability
export interface ScoreBreakdown {
  semantic:     number;   // cosine similarity component
  recency:      number;   // recency decay component
  severity:     number;   // severity tier component
  sourceWeight: number;   // per-connector weight component
  connectorId:  string;   // sourceName of the originating connector
}

export interface RetrievedChunk extends KnowledgeChunk {
  score:          number;         // 0.0–1.0 final weighted score
  scoreBreakdown?: ScoreBreakdown; // present when HybridReranker is active
}

export interface KnowledgeConnectorConfig {
  type:          string;
  projectKey?:   string;   // jira
  acField?:      string;   // jira — custom field ID for Acceptance Criteria
  spaceKey?:     string;   // confluence
  url?:          string;   // openapi
  weight?:       number;   // HybridReranker source weight (default 1.0)
  lookbackDays?: number;   // git — commits to include (default 30)
}

export interface RerankerConfig {
  strategy:       "cosine" | "hybrid";
  semanticWeight: number;   // coefficient on cosine similarity score (default 0.6)
  recencyWeight:  number;   // coefficient on recency decay (default 0.2)
  severityWeight: number;   // coefficient on severity tier (default 0.1)
  sourceWeight:   number;   // coefficient on per-connector weight (default 0.1)
}

// RAG3-03: token-aware retrieval budget — prevents context explosion with large indexes
export interface RetrievalBudget {
  maxChunks:       number;   // hard cap on chunks returned regardless of topK
  maxTokensApprox: number;   // soft cap — chunks trimmed once cumulative estimate exceeds this
}

export interface KnowledgeConfig {
  enabled:    boolean;
  indexPath:  string;
  topK:       number;
  chunker:    "naive" | "ac-aware";
  reranker:   RerankerConfig;
  connectors: KnowledgeConnectorConfig[];
  budget?:    RetrievalBudget;
}
