import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { KnowledgeRetriever } from "../knowledge/KnowledgeRetriever";
import { wwrite, wlog } from "../execution/WorkerContext";

export class RagAssertHandler implements StepHandler {
  readonly handles = ["rag_assert"];

  constructor(private readonly retriever?: KnowledgeRetriever) {}

  async execute(step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "rag_assert") return;

    if (!this.retriever) {
      throw new AssertionError(
        "rag_assert: knowledge retriever is not configured — enable knowledge in config and run ingest"
      );
    }

    const query     = ctx.resolve(step.query);
    const minScore  = step.min_score  ?? 0.0;
    const minChunks = step.min_chunks ?? 1;
    const topK      = Math.max(minChunks, 5);

    wwrite(`  ▶ rag_assert   → query: "${query.slice(0, 60)}${query.length > 60 ? "…" : ""}"`);

    const chunks  = await this.retriever.retrieve(query, topK);
    const passing = chunks.filter(c => c.score >= minScore);

    wlog(`      ↳ retrieved ${chunks.length}, score>=${minScore}: ${passing.length} passing`);

    if (step.store_as) ctx.set(step.store_as, passing);

    if (passing.length < minChunks) {
      throw new AssertionError(
        `rag_assert failed: ${passing.length} chunk(s) with score >= ${minScore}, need ${minChunks}`
      );
    }
  }
}
