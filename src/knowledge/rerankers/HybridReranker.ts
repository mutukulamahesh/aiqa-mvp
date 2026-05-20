import { RetrievedChunk } from "../types";
import { Reranker } from "./Reranker";

const SEVERITY_SCORE: Record<string, number> = {
  critical: 1.00,
  high:     0.75,
  medium:   0.50,
  low:      0.25,
};

// Chunks older than this contribute 0 recency score
const RECENCY_WINDOW_DAYS = 90;

export interface HybridWeights {
  semanticWeight: number;   // coefficient on cosine similarity (e.g. 0.6)
  recencyWeight:  number;   // coefficient on recency decay     (e.g. 0.2)
  severityWeight: number;   // coefficient on severity tier     (e.g. 0.1)
  sourceWeight:   number;   // coefficient on connector weight  (e.g. 0.1)
}

const DEFAULT_WEIGHTS: HybridWeights = {
  semanticWeight: 0.6,
  recencyWeight:  0.2,
  severityWeight: 0.1,
  sourceWeight:   0.1,
};

/**
 * Hybrid reranker — Phase 2.
 *
 * final = semanticWeight×semantic + recencyWeight×recency
 *       + severityWeight×severity + sourceWeight×connectorWeight
 *
 * All four coefficients are configurable in knowledge.reranker in the YAML config
 * so that different verticals (healthcare, banking, e-commerce) can tune priorities.
 *
 * connectorWeights: per-sourceName multiplier from knowledge.connectors[].weight (default 1.0).
 */
export class HybridReranker implements Reranker {
  private weights:          HybridWeights;
  private connectorWeights: Record<string, number>;

  constructor(
    weights:          Partial<HybridWeights>   = {},
    connectorWeights: Record<string, number>   = {},
  ) {
    this.weights          = { ...DEFAULT_WEIGHTS, ...weights };
    this.connectorWeights = connectorWeights;
  }

  rerank(candidates: RetrievedChunk[]): RetrievedChunk[] {
    const now = Date.now();
    return [...candidates]
      .map(c  => ({ chunk: c, hybrid: this.hybridScore(c, now) }))
      .sort((a, b) => b.hybrid - a.hybrid)
      .map(({ chunk, hybrid }) => ({ ...chunk, score: hybrid }));
  }

  private hybridScore(c: RetrievedChunk, now: number): number {
    const { semanticWeight, recencyWeight, severityWeight, sourceWeight } = this.weights;
    const semantic      = Math.max(0, Math.min(1, c.score));
    const recency       = this.recencyScore(c, now);
    const severity      = SEVERITY_SCORE[c.severity ?? ""] ?? 0.5;
    const connectorWt   = Math.max(0, this.connectorWeights[c.sourceName] ?? 1.0);

    const raw = semanticWeight * semantic
              + recencyWeight  * recency
              + severityWeight * severity
              + sourceWeight   * connectorWt;
    return Math.min(1, Math.max(0, raw));
  }

  private recencyScore(c: RetrievedChunk, now: number): number {
    const dateStr = c.sourceUpdatedAt ?? c.ingestedAt;
    const ts = Date.parse(dateStr);
    if (!Number.isFinite(ts)) return 0;
    const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS);
  }
}
