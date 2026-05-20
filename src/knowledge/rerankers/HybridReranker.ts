import { RetrievedChunk } from "../types";
import { Reranker } from "./Reranker";

// Normalised severity contribution: undefined/unknown → 0.5 (medium)
const SEVERITY_SCORE: Record<string, number> = {
  critical: 1.00,
  high:     0.75,
  medium:   0.50,
  low:      0.25,
};

// Recency window: chunks older than this score 0 for recency
const RECENCY_WINDOW_DAYS = 90;

/**
 * Hybrid reranker — Phase 2.
 * final = 0.6 × semantic + 0.2 × recency + 0.1 × severity + 0.1 × sourceWeight
 *
 * sourceWeights: map of sourceName → weight (default 1.0 if not provided).
 * Weights are not normalised — treat them as relative boosts (e.g. jira=1.0, confluence=0.8).
 */
export class HybridReranker implements Reranker {
  private sourceWeights: Record<string, number>;

  constructor(sourceWeights: Record<string, number> = {}) {
    this.sourceWeights = sourceWeights;
  }

  rerank(candidates: RetrievedChunk[]): RetrievedChunk[] {
    const now = Date.now();
    return [...candidates]
      .map(c  => ({ chunk: c, hybrid: this.hybridScore(c, now) }))
      .sort((a, b) => b.hybrid - a.hybrid)
      .map(({ chunk, hybrid }) => ({ ...chunk, score: hybrid }));
  }

  private hybridScore(c: RetrievedChunk, now: number): number {
    const semantic   = Math.max(0, Math.min(1, c.score));
    const recency    = this.recencyScore(c, now);
    const severity   = SEVERITY_SCORE[c.severity ?? ""] ?? 0.5;
    const sourceWt   = Math.max(0, this.sourceWeights[c.sourceName] ?? 1.0);

    return 0.6 * semantic + 0.2 * recency + 0.1 * severity + 0.1 * sourceWt;
  }

  private recencyScore(c: RetrievedChunk, now: number): number {
    const dateStr = c.sourceUpdatedAt ?? c.ingestedAt;
    const ts = Date.parse(dateStr);
    if (!Number.isFinite(ts)) return 0;
    const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS);
  }
}
