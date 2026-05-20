import { RetrievedChunk } from "../types";
import { Reranker } from "./Reranker";

// Phase 1: sorts by score descending (vectra already computes cosine similarity).
// Phase 2: replace with HybridReranker — no caller changes needed.
export class CosineSimilarityReranker implements Reranker {
  rerank(candidates: RetrievedChunk[]): RetrievedChunk[] {
    return [...candidates].sort((a, b) => b.score - a.score);
  }
}
