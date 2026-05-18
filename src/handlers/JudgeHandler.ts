import * as crypto from "crypto";
import { z } from "zod";
import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { LLMProvider } from "../llm/LLMProvider";
import { wwrite, wlog } from "../execution/WorkerContext";

const SYSTEM_PROMPT =
  "You are a test evaluation judge.\n" +
  "Given a value to evaluate and evaluation criteria, respond with ONLY valid JSON " +
  "in this exact format (no markdown, no extra text):\n" +
  '{"score": <number from 0.0 to 1.0>, "reason": "<one sentence explaining the score>"}\n' +
  "score 0.0 = completely fails criteria; 1.0 = fully meets criteria.\n" +
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

export class JudgeHandler implements StepHandler {
  readonly handles = ["judge"];

  // Per-execution cache: re-evaluating the same (value, prompt) pair during a retry
  // must return the same score to keep test outcomes deterministic.
  // Scope: one JudgeHandler instance = one StepInterpreter = one test execution.
  private readonly resultCache = new Map<string, { score: number; reason: string }>();

  constructor(private readonly llm: LLMProvider) {}

  private cacheKey(value: string, prompt: string): string {
    return crypto.createHash("sha256").update(`${value}\x00${prompt}`).digest("hex");
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

    // ── Determinism cache: reuse result on retry instead of re-calling LLM ───
    // Cache stores the normalized score so every consumer (compare, store, log) sees
    // the identical value — no risk of toFixed(3) producing different results per call.
    const key    = this.cacheKey(safeValue, safePrompt);
    const cached = this.resultCache.get(key);

    let score:  number;
    let reason: string;

    if (cached) {
      wwrite(`  ▶ judge      → cache hit (skipping LLM call)`);
      score  = cached.score;
      reason = cached.reason;
    } else {
      wwrite(`  ▶ judge      → evaluating via ${this.llm.name}`);

      // ── Call LLM ─────────────────────────────────────────────────────────────
      const res = await this.llm.complete({
        system:      SYSTEM_PROMPT,
        userMessage: `Value:\n${safeValue}\n\nCriteria:\n${safePrompt}`,
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
