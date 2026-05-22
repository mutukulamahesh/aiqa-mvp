import { z } from "zod";
import { LLMProvider } from "../llm/LLMProvider";
import { RetrievedChunk } from "../knowledge/types";
import { AssertionError } from "../errors";

export const JUDGE_SYSTEM_PROMPT =
  "You are a test evaluation judge.\n" +
  "Given a value to evaluate and evaluation criteria, respond with ONLY valid JSON " +
  "in this exact format (no markdown, no extra text):\n" +
  '{"score": <number from 0.0 to 1.0>, "reason": "<one sentence explaining the score>"}\n' +
  "score 0.0 = completely fails criteria; 1.0 = fully meets criteria.\n" +
  "When acceptance criteria from organisational knowledge are provided, evaluate against them specifically — " +
  "prefer the AC requirements over the generic criteria if they are more precise.\n" +
  "Always respond deterministically: the same input must always produce the same score.";

const JudgeResponseSchema = z.object({
  score:  z.number().finite().min(0).max(1),
  reason: z.string().min(1),
});

// Supported operators: >= > <= <
// Tolerates extra whitespace, case-insensitive "SCORE", decimal shorthand (.7 = 0.7)
const PASS_IF_RE = /^\s*score\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?|\.\d+)\s*$/i;

export function parsePassIf(expr: string): { op: string; threshold: number } {
  const m = PASS_IF_RE.exec(expr.trim());
  if (!m) throw new AssertionError(`judge: invalid pass_if expression "${expr}"`);
  return { op: m[1], threshold: parseFloat(m[2]) };
}

export function applyOp(op: string, score: number, threshold: number): boolean {
  switch (op) {
    case ">=": return score >= threshold;
    case "<=": return score <= threshold;
    case ">":  return score >  threshold;
    case "<":  return score <  threshold;
    default:   throw new Error(`applyOp: unknown operator "${op}"`);
  }
}

export function formatACContext(chunks: RetrievedChunk[]): string {
  const lines = chunks.map(c => {
    const bd = c.scoreBreakdown;
    const breakdown = bd
      ? ` [sem=${bd.semantic.toFixed(2)} rec=${bd.recency.toFixed(2)} sev=${bd.severity.toFixed(2)} src=${bd.sourceWeight.toFixed(2)}]`
      : "";
    return `- [${c.sourceId}] (${c.type}, relevance=${c.score.toFixed(2)}${breakdown}): ${c.text.slice(0, 400)}`;
  });
  return `Acceptance criteria from organisational knowledge:\n${lines.join("\n")}`;
}

// Core scoring function — shared by JudgeHandler and LLMEvalHandler.
// Caller is responsible for truncation, caching, and RAG retrieval.
export async function scoreByCriteria(
  llm:       LLMProvider,
  value:     string,
  criteria:  string,
  acContext  = "",
): Promise<{ score: number; reason: string }> {
  const acSection   = acContext ? `\n\n${acContext}` : "";
  const userMessage = `Value:\n${value}\n\nCriteria:\n${criteria}${acSection}`;

  const res = await llm.complete({ system: JUDGE_SYSTEM_PROMPT, userMessage, maxTokens: 150 });

  let parsed: { score: number; reason: string };
  try {
    parsed = JudgeResponseSchema.parse(JSON.parse(res.content));
  } catch {
    throw new AssertionError("judge failed: invalid LLM response format");
  }

  return { score: Number(parsed.score.toFixed(3)), reason: parsed.reason };
}
