import { KnowledgeStore } from "./KnowledgeStore";
import { KnowledgeChunk, RetrievedChunk } from "./types";

export class GraphEnricher {
  constructor(private readonly store: KnowledgeStore) {}

  async enrich(chunks: RetrievedChunk[], maxHops = 1): Promise<RetrievedChunk[]> {
    if (maxHops < 1) return chunks;

    // Single index load — O(1) lookup for all subsequent relation lookups
    let byId: Map<string, KnowledgeChunk>;
    try {
      const all = await this.store.listAll();
      byId = new Map(all.map(c => [c.sourceId, c]));
    } catch {
      return chunks;
    }

    const seen = new Map<string, RetrievedChunk>();
    for (const c of chunks) seen.set(c.sourceId, c);

    for (const chunk of chunks) {
      for (const rel of chunk.relations ?? []) {
        if (seen.has(rel.targetId)) continue;
        const related = byId.get(rel.targetId);
        if (!related) continue;
        seen.set(rel.targetId, {
          ...related,
          score: Number((chunk.score * 0.8).toFixed(4)),
          scoreBreakdown: chunk.scoreBreakdown
            ? { ...chunk.scoreBreakdown, semantic: Number((chunk.scoreBreakdown.semantic * 0.8).toFixed(4)) }
            : undefined,
        });
      }
    }

    const direct   = chunks.map(c => seen.get(c.sourceId)!);
    const expanded = [...seen.values()].filter(c => !chunks.some(o => o.sourceId === c.sourceId));
    expanded.sort((a, b) => b.score - a.score);

    return [...direct, ...expanded];
  }
}
