import { KnowledgeStore } from "./KnowledgeStore";
import { RetrievedChunk } from "./types";

// Standalone query interface — any component (FlowMapper, ScenarioGenerator,
// HealerAgent, JudgeHandler) can inject this without depending on KnowledgeStore directly.
export class KnowledgeRetriever {
  private store: KnowledgeStore;
  private topK:  number;

  constructor(store: KnowledgeStore, topK = 5) {
    this.store = store;
    this.topK  = topK;
  }

  // Returns [] gracefully if index has not been built yet.
  async retrieve(query: string, topK?: number): Promise<RetrievedChunk[]> {
    try {
      return await this.store.retrieve(query, topK ?? this.topK);
    } catch {
      return [];
    }
  }

  // Format retrieved chunks as a compact context block for LLM prompts.
  static formatContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "";
    const lines = chunks.map(c =>
      `- [${c.sourceId}] (${c.type}, score=${c.score.toFixed(2)}): ${c.text.slice(0, 300)}`,
    );
    return `Organisational knowledge context:\n${lines.join("\n")}`;
  }
}
