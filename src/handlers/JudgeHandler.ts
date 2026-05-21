import * as crypto from "crypto";
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

const MAX_VALUE_LENGTH = (() => {
  const n = parseInt(process.env.AIQA_JUDGE_MAX_LENGTH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
})();

const MAX_AC_CHUNKS = 3;

export class JudgeHandler implements StepHandler {
  readonly handles = ["judge"];

  private readonly resultCache = new Map<string, { score: number; reason: string }>();

  constructor(
    private readonly llm:       LLMProvider,
    private readonly retriever?: KnowledgeRetriever,
  ) {}

  private cacheKey(value: string, prompt: string, acContext: string): string {
    return crypto.createHash("sha256").update(`${value}\x00${prompt}\x00${acContext}`).digest("hex");
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

    const key    = this.cacheKey(safeValue, safePrompt, acContext);
    const cached = this.resultCache.get(key);

    let score:  number;
    let reason: string;

    if (cached) {
      wwrite(`  ▶ judge      → cache hit (skipping LLM call)`);
      score  = cached.score;
      reason = cached.reason;
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
      this.resultCache.set(key, { score, reason });
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
