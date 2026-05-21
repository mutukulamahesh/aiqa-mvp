import { RetrievedChunk } from "../types";
import { Reranker } from "./Reranker";

// Phase 1: sorts by score descending (vectra already computes cosine similarity).
// Attaches a scoreBreakdown so callers always get a consistent shape regardless of reranker.
export class CosineSimilarityReranker implements Reranker {
  rerank(candidates: RetrievedChunk[]): RetrievedChunk[] {
    return [...candidates]
      .sort((a, b) => b.score - a.score)
      .map(c => ({
        ...c,
        scoreBreakdown: {
          semantic:     Number(Math.max(0, Math.min(1, c.score)).toFixed(4)),
          recency:      0,
          severity:     0,
          sourceWeight: 0,
          connectorId:  c.sourceName,
        },
      }));
  }
}
