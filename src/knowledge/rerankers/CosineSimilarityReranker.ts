import { RetrievedChunk } from "../types";
import { Reranker } from "./Reranker";

// Phase 1: sorts by score descending (vectra already computes cosine similarity).
// scoreBreakdown is intentionally omitted — zeros for recency/severity would be
// misleading in logs (they were never computed, not computed as zero).
export class CosineSimilarityReranker implements Reranker {
  rerank(candidates: RetrievedChunk[]): RetrievedChunk[] {
    return [...candidates].sort((a, b) => b.score - a.score);
  }
}
