import { KnowledgeStore } from "./KnowledgeStore";
import { RetrievedChunk } from "./types";

/**
 * RAG3-04: One-hop Knowledge Graph expansion.
 *
 * For each retrieved chunk, follows its `relations[]` array one hop to fetch
 * related chunks from the store (e.g. a story chunk that links to its defects,
 * or a defect that links back to its blocking story).
 *
 * Appended chunks are given a slightly reduced score (originator × 0.8) so
 * they rank below the directly-matched chunks but still influence the LLM context.
 * Duplicates (by sourceId) are deduplicated — the highest-score entry wins.
 */
export class GraphEnricher {
  constructor(private readonly store: KnowledgeStore) {}

  async enrich(chunks: RetrievedChunk[], maxHops = 1): Promise<RetrievedChunk[]> {
    if (maxHops < 1) return chunks;

    const seen    = new Map<string, RetrievedChunk>();
    // Seed with the direct results
    for (const c of chunks) seen.set(c.sourceId, c);

    // One-hop expansion
    const candidates = [...chunks];
    for (const chunk of candidates) {
      for (const rel of chunk.relations ?? []) {
        if (seen.has(rel.targetId)) continue; // already present at higher score
        const related = await this.fetchBySourceId(rel.targetId);
        if (!related) continue;
        const hopChunk: RetrievedChunk = {
          ...related,
          score: Number((chunk.score * 0.8).toFixed(4)),
          scoreBreakdown: chunk.scoreBreakdown
            ? {
                ...chunk.scoreBreakdown,
                // Mark as graph-expanded so callers can distinguish
                semantic: Number((chunk.scoreBreakdown.semantic * 0.8).toFixed(4)),
              }
            : undefined,
        };
        seen.set(rel.targetId, hopChunk);
      }
    }

    // Return original ordering first, then graph-expanded chunks sorted by score
    const direct   = chunks.map(c => seen.get(c.sourceId)!);
    const expanded = [...seen.values()].filter(c => !chunks.some(o => o.sourceId === c.sourceId));
    expanded.sort((a, b) => b.score - a.score);

    return [...direct, ...expanded];
  }

  private async fetchBySourceId(sourceId: string): Promise<RetrievedChunk | null> {
    try {
      const all = await this.store.listAll();
      const match = all.find(c => c.sourceId === sourceId);
      if (!match) return null;
      return { ...match, score: 0 }; // score overridden by caller
    } catch {
      return null;
    }
  }
}
