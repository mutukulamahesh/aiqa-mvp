export interface KnowledgeChunk {
  text:       string;
  sourceId:   string;                                        // e.g. "SCRUM-42"
  sourceName: string;                                        // e.g. "jira"
  type:       "story" | "defect" | "page" | "api" | "git";
  tags:       string[];
  severity?:  "critical" | "high" | "medium" | "low";
  version?:   string;
  confidence: number;                                        // 1.0 default; feedback loop updates
  relations:  { type: string; targetId: string }[];          // Knowledge Graph — empty Phase 1
  ingestedAt: string;                                        // ISO date
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
}

export interface KnowledgeConfig {
  enabled:    boolean;
  indexPath:  string;
  topK:       number;
  chunker:    "naive";                        // Phase 2: "ac-aware" | "semantic"
  connectors: KnowledgeConnectorConfig[];
}
