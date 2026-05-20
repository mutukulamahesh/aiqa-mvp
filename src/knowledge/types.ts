export interface KnowledgeChunk {
  text:             string;
  sourceId:         string;                                        // e.g. "SCRUM-42"
  sourceName:       string;                                        // e.g. "jira"
  type:             "story" | "defect" | "page" | "api" | "git";
  tags:             string[];
  severity?:        "critical" | "high" | "medium" | "low";
  version?:         string;
  confidence:       number;                                        // 1.0 default; feedback loop updates
  relations:        { type: string; targetId: string }[];          // Knowledge Graph — empty Phase 1
  ingestedAt:       string;                                        // ISO date
  sourceUpdatedAt?: string;                                        // ISO date from source system; recency signal for HybridReranker
}

export interface RetrievedChunk extends KnowledgeChunk {
  score: number;   // 0.0–1.0; cosine similarity Phase 1, hybrid score Phase 2
}

export interface KnowledgeConnectorConfig {
  type:         string;
  projectKey?:  string;   // jira
  acField?:     string;   // jira — custom field ID for Acceptance Criteria
  spaceKey?:    string;   // confluence
  url?:         string;   // openapi
  weight?:      number;   // HybridReranker source weight (default 1.0)
}

export interface RerankerConfig {
  strategy:       "cosine" | "hybrid";
  semanticWeight: number;   // coefficient on cosine similarity score (default 0.6)
  recencyWeight:  number;   // coefficient on recency decay (default 0.2)
  severityWeight: number;   // coefficient on severity tier (default 0.1)
  sourceWeight:   number;   // coefficient on per-connector weight (default 0.1)
}

export interface KnowledgeConfig {
  enabled:    boolean;
  indexPath:  string;
  topK:       number;
  chunker:    "naive" | "ac-aware";
  reranker:   RerankerConfig;
  connectors: KnowledgeConnectorConfig[];
}
