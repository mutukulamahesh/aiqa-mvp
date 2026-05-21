import { KnowledgeStore } from "./KnowledgeStore";
import { GraphEnricher } from "./GraphEnricher";
import { RetrievalBudget, RetrievedChunk } from "./types";

// Per-connector-type approximate token cost per chunk character.
// Used by the budget enforcer — rough 4-char-per-token estimate adjusted by type.
const TOKEN_ESTIMATE_CHARS_PER_TOKEN: Record<string, number> = {
  api:     3,   // API spec chunks are dense — ~3 chars per token
  git:     5,   // git commit chunks are looser
  page:    4,   // Confluence pages: typical prose
  story:   4,
  defect:  4,
};

function estimateTokens(chunk: RetrievedChunk): number {
  const charsPerToken = TOKEN_ESTIMATE_CHARS_PER_TOKEN[chunk.type] ?? 4;
  return Math.ceil(chunk.text.length / charsPerToken);
}

// Standalone query interface — any component (FlowMapper, ScenarioGenerator,
// HealerAgent, JudgeHandler) can inject this without depending on KnowledgeStore directly.
export class KnowledgeRetriever {
  private store:    KnowledgeStore;
  private topK:     number;
  private budget:   RetrievalBudget | undefined;
  private enricher: GraphEnricher | undefined;

  constructor(store: KnowledgeStore, topK = 5, budget?: RetrievalBudget, enricher?: GraphEnricher) {
    this.store    = store;
    this.topK     = topK;
    this.budget   = budget;
    this.enricher = enricher;
  }

  // Returns [] gracefully if index has not been built yet; logs unexpected errors.
  // Applies budget caps (maxChunks + maxTokensApprox) after retrieval, in score order.
  async retrieve(query: string, topK?: number): Promise<RetrievedChunk[]> {
    try {
      const k       = topK ?? this.topK;
      // Fetch up to budget.maxChunks or k, whichever is larger, so budget can trim accurately
      const fetchK  = this.budget ? Math.max(k, this.budget.maxChunks) : k;
      const results  = await this.store.retrieve(query, fetchK);
      const budgeted = this.applyBudget(results, k);
      return this.enricher ? await this.enricher.enrich(budgeted) : budgeted;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const isExpected = msg.includes("does not exist") || msg.includes("ENOENT");
      if (!isExpected) process.stderr.write(`[knowledge] retrieve error: ${msg}\n`);
      return [];
    }
  }

  // Enforces maxChunks and maxTokensApprox budget — chunks already sorted by score desc.
  private applyBudget(chunks: RetrievedChunk[], topK: number): RetrievedChunk[] {
    // Always respect topK first
    let result = chunks.slice(0, topK);

    if (!this.budget) return result;

    // Hard chunk cap
    if (result.length > this.budget.maxChunks) {
      result = result.slice(0, this.budget.maxChunks);
    }

    // Soft token cap — trim from the tail (lowest-score) until under budget
    let tokenTotal = result.reduce((sum, c) => sum + estimateTokens(c), 0);
    while (tokenTotal > this.budget.maxTokensApprox && result.length > 1) {
      const removed = result.pop()!;
      tokenTotal -= estimateTokens(removed);
      process.stderr.write(
        `[knowledge] budget: dropped ${removed.sourceId} (tokens ~${estimateTokens(removed)}, total would be ~${tokenTotal + estimateTokens(removed)})\n`,
      );
    }

    return result;
  }

  // Format retrieved chunks as a compact context block for LLM prompts.
  // Includes scoreBreakdown when present.
  static formatContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "";
    const lines = chunks.map(c => {
      const bd = c.scoreBreakdown;
      const breakdown = bd
        ? ` [sem=${bd.semantic.toFixed(2)} rec=${bd.recency.toFixed(2)} sev=${bd.severity.toFixed(2)} src=${bd.sourceWeight.toFixed(2)} via=${bd.connectorId}]`
        : "";
      return `- [${c.sourceId}] (${c.type}, score=${c.score.toFixed(2)}${breakdown}): ${c.text.slice(0, 300)}`;
    });
    return `Organisational knowledge context:\n${lines.join("\n")}`;
  }
}
