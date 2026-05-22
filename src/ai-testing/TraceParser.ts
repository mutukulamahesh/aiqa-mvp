/**
 * GEN-03 spike — TraceParser
 *
 * Normalises OpenAI Assistants run steps and LangChain run trees into a
 * common AgentTrace schema so AgentTraceHandler can assert on both without
 * knowing which provider produced the trace.
 *
 * Spike verdict is at the bottom of this file.
 */

// ── Common schema ─────────────────────────────────────────────────────────────

export type TraceStepType = "llm" | "tool" | "retrieval" | "chain";
export type TraceStepStatus = "success" | "error" | "cancelled";

export interface TraceStep {
  type:        TraceStepType;
  name:        string;
  input?:      unknown;
  output?:     unknown;
  status:      TraceStepStatus;
  durationMs?: number;
}

export interface AgentTrace {
  provider: "openai" | "langchain";
  steps:    TraceStep[];
  raw:      unknown;
}

// ── OpenAI Assistants raw types ───────────────────────────────────────────────

interface OpenAIFunctionCall {
  name:       string;
  arguments:  string;
  output?:    string | null;
}

interface OpenAIToolCall {
  id:       string;
  type:     "function" | "code_interpreter" | "file_search";
  function?: OpenAIFunctionCall;
}

interface OpenAIRunStep {
  id:           string;
  type:         "tool_calls" | "message_creation";
  status:       "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  step_details: {
    type: "tool_calls";
    tool_calls: OpenAIToolCall[];
  } | {
    type: "message_creation";
    message_creation: { message_id: string };
  };
  created_at:    number;
  completed_at?: number | null;
}

// ── LangChain raw types ───────────────────────────────────────────────────────

interface LangChainRun {
  id:         string;
  name:       string;
  run_type:   "llm" | "tool" | "retriever" | "chain" | string;
  inputs:     unknown;
  outputs?:   unknown;
  error?:     string;
  start_time: string;   // ISO
  end_time?:  string;   // ISO
  child_runs: LangChainRun[];
}

// ── OpenAI normaliser ─────────────────────────────────────────────────────────

function openAIStepStatus(raw: OpenAIRunStep["status"]): TraceStepStatus {
  if (raw === "completed")                    return "success";
  if (raw === "cancelled" || raw === "expired") return "cancelled";
  return "error";
}

export function normaliseOpenAI(steps: OpenAIRunStep[]): AgentTrace {
  const normalised: TraceStep[] = [];

  for (const step of steps) {
    const status     = openAIStepStatus(step.status);
    const durationMs = step.completed_at != null
      ? (step.completed_at - step.created_at) * 1000
      : undefined;

    if (step.step_details.type === "tool_calls") {
      for (const tc of step.step_details.tool_calls) {
        if (tc.type === "function" && tc.function) {
          normalised.push({
            type:   "tool",
            name:   tc.function.name,
            input:  tc.function.arguments,
            output: tc.function.output ?? undefined,
            status,
            durationMs,
          });
        } else {
          // code_interpreter / file_search — map as tool with raw type as name
          normalised.push({ type: "tool", name: tc.type, status, durationMs });
        }
      }
    } else {
      // message_creation — the LLM produced a reply
      normalised.push({ type: "llm", name: "message_creation", status, durationMs });
    }
  }

  return { provider: "openai", steps: normalised, raw: steps };
}

// ── LangChain normaliser ──────────────────────────────────────────────────────

function langChainType(runType: string): TraceStepType {
  if (runType === "tool")      return "tool";
  if (runType === "retriever") return "retrieval";
  if (runType === "llm")       return "llm";
  return "chain";
}

function langChainStatus(run: LangChainRun): TraceStepStatus {
  if (run.error)    return "error";
  if (!run.outputs) return "error";
  return "success";
}

function langChainDuration(run: LangChainRun): number | undefined {
  if (!run.end_time) return undefined;
  return new Date(run.end_time).getTime() - new Date(run.start_time).getTime();
}

function flattenLangChain(run: LangChainRun, out: TraceStep[]): void {
  out.push({
    type:        langChainType(run.run_type),
    name:        run.name,
    input:       run.inputs,
    output:      run.outputs,
    status:      langChainStatus(run),
    durationMs:  langChainDuration(run),
  });
  for (const child of run.child_runs) {
    flattenLangChain(child, out);
  }
}

export function normaliseLangChain(root: LangChainRun): AgentTrace {
  const steps: TraceStep[] = [];
  flattenLangChain(root, steps);
  return { provider: "langchain", steps, raw: root };
}

// ── Generic entry point ───────────────────────────────────────────────────────

export function parseTrace(
  provider: "openai" | "langchain",
  raw:      unknown,
): AgentTrace {
  if (provider === "openai")    return normaliseOpenAI(raw as OpenAIRunStep[]);
  if (provider === "langchain") return normaliseLangChain(raw as LangChainRun);
  throw new Error(`TraceParser: unknown provider "${provider}"`);
}

/*
 * ── GEN-03 SPIKE VERDICT ─────────────────────────────────────────────────────
 *
 * Schema: CLEAN. Both formats normalise to TraceStep[] with ~60 lines each.
 * The common schema (type/name/input/output/status/durationMs) covers all
 * meaningful assertions a test author would write.
 *
 * Integration blockers:
 *
 * 1. OpenAI Assistants — trace data is NOT a local object. AgentTraceHandler
 *    would need to call openai.beta.threads.runs.steps.list(thread_id, run_id)
 *    over HTTPS after the agent run completes. Requires OPENAI_API_KEY and
 *    returns paginated results. The handler must fetch + concat all pages before
 *    normalising. This is a live network dependency — not mockable without an
 *    injectable HTTP transport.
 *
 * 2. LangChain — local callback traces ARE available without a network call
 *    (LangSmith is optional). A CallbackHandler captures runs in memory as
 *    LangChainRun objects. However, integrating this requires the LangChain SDK
 *    (@langchain/core) as a peer dependency, which is not currently installed.
 *    Adding it brings ~12 MB and a non-trivial version matrix.
 *
 * 3. Trace timing — both formats are only available AFTER the agent finishes.
 *    The DSL step must either (a) execute the agent inline and capture the
 *    trace, or (b) receive a pre-captured trace ID via store_as from a prior
 *    step. Option (b) is cleaner but requires a two-step YAML pattern that
 *    diverges from all other handlers.
 *
 * Recommendation: DEFER GEN-03.
 *   - The normalisation schema is proven clean (see tests).
 *   - The blockers are integration concerns, not schema concerns.
 *   - Unblock when: (a) OpenAI injectable transport pattern is designed, OR
 *     (b) LangChain peer dep decision is made, OR (c) a real use case drives
 *     the priority above GEN-02 refinement / EPIC-DEX work.
 *   - TraceParser.ts ships as-is — the schema + normalizers are complete and
 *     tested. AgentTraceHandler can be built on top without schema changes.
 */
