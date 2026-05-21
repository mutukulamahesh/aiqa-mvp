import * as crypto from "crypto";
import { z } from "zod";
import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { LLMProvider } from "../llm/LLMProvider";
import { KnowledgeRetriever } from "../knowledge/KnowledgeRetriever";
import { RetrievedChunk } from "../knowledge/types";
import { wwrite, wlog } from "../execution/WorkerContext";

const SYSTEM_PROMPT =
  "You are a test evaluation judge.\n" +
  "Given a value to evaluate and evaluation criteria, respond with ONLY valid JSON " +
  "in this exact format (no markdown, no extra text):\n" +
  '{"score": <number from 0.0 to 1.0>, "reason": "<one sentence explaining the score>"}\n' +
  "score 0.0 = completely fails criteria; 1.0 = fully meets criteria.\n" +
  "When acceptance criteria from organisational knowledge are provided, evaluate against them specifically — " +
  "prefer the AC requirements over the generic criteria if they are more precise.\n" +
  "Always respond deterministically: the same input must always produce the same score.";

const JudgeResponseSchema = z.object({
  // .finite() explicitly rejects NaN and Infinity (belt-and-suspenders alongside JSON.parse)
  score:  z.number().finite().min(0).max(1),
  reason: z.string().min(1),
});

// Supported operators: >= > <= <
// Tolerates extra whitespace, case-insensitive "SCORE", decimal shorthand (.7 = 0.7)
const PASS_IF_RE = /^\s*score\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?|\.\d+)\s*$/i;

function parsePassIf(expr: string): { op: string; threshold: number } {
  const m = PASS_IF_RE.exec(expr.trim());
  if (!m) throw new AssertionError(`judge: invalid pass_if expression "${expr}"`);
  return { op: m[1], threshold: parseFloat(m[2]) };
}

function applyOp(op: string, score: number, threshold: number): boolean {
  switch (op) {
    case ">=": return score >= threshold;
    case "<=": return score <= threshold;
    case ">":  return score >  threshold;
    case "<":  return score <  threshold;
    default:   return false;
  }
}

// Soft cap on the input passed to the LLM: keeps token usage predictable and
// avoids context-window overflows on large API responses stored via store_as.
// Configurable via AIQA_JUDGE_MAX_LENGTH if longer inputs are needed.
const MAX_VALUE_LENGTH = (() => {
  const n = parseInt(process.env.AIQA_JUDGE_MAX_LENGTH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
})();

// Maximum AC chunks included in a single judge call — keeps prompt size bounded.
const MAX_AC_CHUNKS = 3;

export class JudgeHandler implements StepHandler {
  readonly handles = ["judge"];

  // Per-execution cache: re-evaluating the same (value, prompt, ac-context) triple during
  // a retry must return the same score to keep test outcomes deterministic.
  // Scope: one JudgeHandler instance = one StepInterpreter = one test execution.
  private readonly resultCache = new Map<string, { score: number; reason: string }>();

  constructor(
    private readonly llm:       LLMProvider,
    private readonly retriever?: KnowledgeRetriever,
  ) {}

  private cacheKey(value: string, prompt: string, acContext: string): string {
    return crypto.createHash("sha256").update(`${value}\x00${prompt}\x00${acContext}`).digest("hex");
  }

  // Format retrieved chunks as a concise AC block for the LLM prompt.
  private formatACContext(chunks: RetrievedChunk[]): string {
    const lines = chunks.map(c =>
      `- [${c.sourceId}] (${c.type}, relevance=${c.score.toFixed(2)}): ${c.text.slice(0, 400)}`,
    );
    return `Acceptance criteria from organisational knowledge:\n${lines.join("\n")}`;
  }

  async execute(step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "judge") return;

    const value  = ctx.resolve(step.value);
    const prompt = ctx.resolve(step.prompt);

    // ── Guard: never call LLM for empty input ─────────────────────────────────
    if (!value.trim()) {
      throw new AssertionError("judge failed: empty input");
    }

    // ── Soft limit: protect prompt size without failing the step ──────────────
    const truncated = value.length > MAX_VALUE_LENGTH;
    const safeValue = truncated
      ? value.slice(0, MAX_VALUE_LENGTH) + "...[truncated]"
      : value;
    const safePrompt = truncated
      ? `${prompt}\nNote: input was truncated for length.`
      : prompt;

    // ── RAG: retrieve relevant AC chunks using the criteria as the query ──────
    // The criteria text is the best signal for which requirements apply.
    // Returns [] gracefully if the index is empty or unavailable.
    let acChunks: RetrievedChunk[] = [];
    if (this.retriever) {
      acChunks = await this.retriever.retrieve(prompt, MAX_AC_CHUNKS);
    }
    const acContext = acChunks.length > 0 ? this.formatACContext(acChunks) : "";

    // ── Determinism cache: reuse result on retry instead of re-calling LLM ───
    // Cache key includes AC context so a knowledge index rebuild between retries
    // produces a fresh evaluation with the updated requirements.
    const key    = this.cacheKey(safeValue, safePrompt, acContext);
    const cached = this.resultCache.get(key);

    let score:  number;
    let reason: string;

    if (cached) {
      wwrite(`  ▶ judge      → cache hit (skipping LLM call)`);
      score  = cached.score;
      reason = cached.reason;
    } else {
      const acLabel = acChunks.length > 0
        ? ` + ${acChunks.length} AC chunk(s) from knowledge`
        : "";
      wwrite(`  ▶ judge      → evaluating via ${this.llm.name}${acLabel}`);

      // ── Compose user message — append AC context when available ──────────────
      const acSection = acContext ? `\n\n${acContext}` : "";
      const userMessage = `Value:\n${safeValue}\n\nCriteria:\n${safePrompt}${acSection}`;

      // ── Call LLM ─────────────────────────────────────────────────────────────
      const res = await this.llm.complete({
        system:      SYSTEM_PROMPT,
        userMessage,
        maxTokens:   150,
      });

      // ── Parse & validate — fail hard on any format deviation ─────────────────
      let parsed: { score: number; reason: string };
      try {
        parsed = JudgeResponseSchema.parse(JSON.parse(res.content));
      } catch {
        throw new AssertionError("judge failed: invalid LLM response format");
      }

      // ── Normalize to 3 dp before caching — comparison, storage, and log all
      //    read from the cache entry, guaranteeing one canonical value. ─────────
      score  = Number(parsed.score.toFixed(3));
      reason = parsed.reason;
      this.resultCache.set(key, { score, reason });
    }

    // ── Evaluate pass_if (deterministic — never delegated to the LLM) ────────
    const { op, threshold } = parsePassIf(step.pass_if);
    const passed  = applyOp(op, score, threshold);
    const verdict = passed ? "pass" : "fail";

    wlog(`      ↳ score=${score}  verdict=${verdict}  reason="${reason}"`);

    // ── Store before asserting so the result is available for debugging ───────
    if (step.store_as) {
      ctx.set(step.store_as, { score, verdict, reason });
    }

    if (!passed) {
      throw new AssertionError(
        `Judge failed (score: ${score} ${op} ${threshold})\nReason: ${reason}`
      );
    }
  }
}
