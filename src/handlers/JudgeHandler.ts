import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { LLMProvider } from "../llm/LLMProvider";
import { KnowledgeRetriever } from "../knowledge/KnowledgeRetriever";
import { RetrievedChunk } from "../knowledge/types";
import { wwrite, wlog } from "../execution/WorkerContext";
import { scoreByCriteria, parsePassIf, applyOp, formatACContext } from "./judgeUtils";
import { JudgeCacheStore, NoopJudgeCacheStore } from "../cache/JudgeCacheStore";
import { getConfig } from "../config/ConfigLoader";

type AnyJudgeCache = Pick<JudgeCacheStore, "cacheKey" | "get" | "set">;

const MAX_VALUE_LENGTH = (() => {
  const n = parseInt(process.env.AIQA_JUDGE_MAX_LENGTH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
})();

const MAX_AC_CHUNKS = 3;

export class JudgeHandler implements StepHandler {
  readonly handles = ["judge"];

  private readonly runCache:     Map<string, { score: number; reason: string }>;
  private readonly persistCache: AnyJudgeCache;

  constructor(
    private readonly llm:       LLMProvider,
    private readonly retriever?: KnowledgeRetriever,
    persistCache?: AnyJudgeCache,
  ) {
    this.runCache = new Map();
    if (persistCache) {
      this.persistCache = persistCache;
    } else {
      // Use noop when no config loaded (unit tests) — avoids bleeding real cached scores into stubs
      const indexPath = (() => { try { return getConfig().knowledge.indexPath; } catch { return null; } })();
      this.persistCache = indexPath ? new JudgeCacheStore(indexPath) : new NoopJudgeCacheStore();
    }
  }

  async execute(step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "judge") return;

    const value  = ctx.resolve(step.value);
    const prompt = ctx.resolve(step.prompt);

    if (!value.trim()) throw new AssertionError("judge failed: empty input");

    const truncated  = value.length > MAX_VALUE_LENGTH;
    const safeValue  = truncated ? value.slice(0, MAX_VALUE_LENGTH) + "...[truncated]" : value;
    const safePrompt = truncated ? `${prompt}\nNote: input was truncated for length.` : prompt;

    let acChunks: RetrievedChunk[] = [];
    if (this.retriever) acChunks = await this.retriever.retrieve(prompt, MAX_AC_CHUNKS);
    const acContext = acChunks.length > 0 ? formatACContext(acChunks) : "";

    const key          = this.persistCache.cacheKey(safeValue, safePrompt, acContext);
    const runHit       = this.runCache.get(key);
    const persistHit   = runHit ? undefined : this.persistCache.get(key);

    let score:  number;
    let reason: string;

    if (runHit) {
      wwrite(`  ▶ judge      → cache hit (skipping LLM call)`);
      score  = runHit.score;
      reason = runHit.reason;
    } else if (persistHit) {
      wwrite(`  ▶ judge      → cross-run cache hit (skipping LLM call)`);
      score  = persistHit.score;
      reason = persistHit.reason;
      this.runCache.set(key, { score, reason });
    } else {
      const acLabel = acChunks.length > 0 ? ` + ${acChunks.length} AC chunk(s) from knowledge` : "";
      wwrite(`  ▶ judge      → evaluating via ${this.llm.name}${acLabel}`);
      if (acChunks.length > 0 && process.env.AIQA_DEBUG_RAG) {
        for (const c of acChunks) {
          const bd = c.scoreBreakdown;
          wlog(`      ↳ retrieved ${c.sourceId} score=${c.score.toFixed(3)}` +
            (bd ? ` (sem=${bd.semantic.toFixed(2)} rec=${bd.recency.toFixed(2)} sev=${bd.severity.toFixed(2)} src=${bd.sourceWeight.toFixed(2)} via=${bd.connectorId})` : ""));
        }
      }

      ({ score, reason } = await scoreByCriteria(this.llm, safeValue, safePrompt, acContext));
      this.runCache.set(key, { score, reason });
      this.persistCache.set(key, score, reason);
    }

    const { op, threshold } = parsePassIf(step.pass_if);
    const passed  = applyOp(op, score, threshold);
    const verdict = passed ? "pass" : "fail";

    wlog(`      ↳ score=${score}  verdict=${verdict}  reason="${reason}"`);

    if (step.store_as) ctx.set(step.store_as, { score, verdict, reason });

    if (!passed) {
      throw new AssertionError(`Judge failed (score: ${score} ${op} ${threshold})\nReason: ${reason}`);
    }
  }
}
