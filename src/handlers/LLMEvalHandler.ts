import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { LLMProvider, createLLMProvider, ProviderName } from "../llm/LLMProvider";
import { KnowledgeRetriever } from "../knowledge/KnowledgeRetriever";
import { RetrievedChunk } from "../knowledge/types";
import { IEmbedder } from "../knowledge/Embedder";
import { BaselineStore } from "../ai-testing/BaselineStore";
import { cosineDist } from "../ai-testing/VarianceComputer";
import { wwrite, wlog } from "../execution/WorkerContext";
import { scoreByCriteria, parsePassIf, applyOp, formatACContext } from "./judgeUtils";

const MAX_AC_CHUNKS = 3;

type LLMTargets = Record<string, { provider: ProviderName; model?: string; baseUrl?: string }>;

export class LLMEvalHandler implements StepHandler {
  readonly handles = ["llm_eval"];

  constructor(
    private readonly judgeLlm:       LLMProvider,
    private readonly retriever?:     KnowledgeRetriever,
    private readonly llmTargets:     LLMTargets = {},
    private readonly embedder?:      IEmbedder,
    private readonly baselineStore?: BaselineStore,
  ) {}

  async execute(step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "llm_eval") return;

    // ── Resolve target LLM (the system under test) ────────────────────────────
    const targetLlm = this.resolveTarget(step);

    const prompt = ctx.resolve(step.prompt);
    const system = step.system ? ctx.resolve(step.system) : "You are a helpful assistant.";

    wwrite(`  ▶ llm_eval   → calling ${targetLlm.name}${step.model ? ` (${step.model})` : ""}`);

    // ── Call target LLM ───────────────────────────────────────────────────────
    const res = await targetLlm.complete({ system, userMessage: prompt, maxTokens: step.max_tokens ?? 1024 });
    const response = res.content;

    wlog(`      ↳ response (${response.length} chars): ${response.slice(0, 120)}${response.length > 120 ? "…" : ""}`);

    // ── Baseline record mode — fires before quality assertion ─────────────────
    // Capture intent is unconditional: record whatever the LLM actually said.
    // Quality assertion is about the live run, not about what to store.
    if (step.baseline_key && this.baselineStore?.recordMode) {
      if (!this.embedder) {
        throw new AssertionError("llm_eval: baseline_key requires an embedder — check StepInterpreter setup");
      }
      const embedding = await this.embedder.embed(response);
      await this.baselineStore.write(step.baseline_key, { embedding, response, recordedAt: new Date().toISOString() });
      wwrite(`  ▶ llm_eval   → baseline recorded: ${step.baseline_key}`);
      if (step.store_as) ctx.set(step.store_as, { response, baseline_recorded: true });
      return;
    }

    // ── Quality assertion (optional) ──────────────────────────────────────────
    let score:   number | undefined;
    let verdict: string | undefined;
    let reason:  string | undefined;

    if (step.assert_quality) {
      const criteria = ctx.resolve(step.assert_quality.criteria);

      // Retrieve AC context using the criteria as the query
      let acChunks: RetrievedChunk[] = [];
      if (this.retriever) acChunks = await this.retriever.retrieve(criteria, MAX_AC_CHUNKS);
      const acContext = acChunks.length > 0 ? formatACContext(acChunks) : "";

      if (acChunks.length > 0 && process.env.AIQA_DEBUG_RAG) {
        for (const c of acChunks) {
          wlog(`      ↳ AC chunk ${c.sourceId} relevance=${c.score.toFixed(3)}`);
        }
      }

      const acLabel = acChunks.length > 0 ? ` + ${acChunks.length} AC chunk(s)` : "";
      wwrite(`  ▶ llm_eval   → judging via ${this.judgeLlm.name}${acLabel}`);

      ({ score, reason } = await scoreByCriteria(this.judgeLlm, response, criteria, acContext));

      const { op, threshold } = parsePassIf(step.assert_quality.pass_if);
      const passed = applyOp(op, score, threshold);
      verdict = passed ? "pass" : "fail";

      wlog(`      ↳ score=${score}  verdict=${verdict}  reason="${reason}"`);

      if (step.store_as) ctx.set(step.store_as, { response, score, verdict, reason });

      if (!passed) {
        throw new AssertionError(
          `llm_eval failed (score: ${score} ${op} ${threshold})\nReason: ${reason}`
        );
      }
    } else {
      if (step.store_as) ctx.set(step.store_as, { response });
    }

    // ── Baseline compare mode (optional) ─────────────────────────────────────
    // Record mode is handled above and returns early; this block is compare-only.
    if (step.baseline_key) {
      if (!this.embedder || !this.baselineStore) {
        throw new AssertionError("llm_eval: baseline_key requires an embedder — check StepInterpreter setup");
      }

      const embedding = await this.embedder.embed(response);
      const baseline = await this.baselineStore.read(step.baseline_key);
      if (!baseline) {
        throw new AssertionError(
          `llm_eval: no baseline for "${step.baseline_key}" — run with AIQA_BASELINE_RECORD=true first`
        );
      }

      const drift    = cosineDist(embedding, baseline.embedding);
      const maxDrift = step.max_drift ?? 0.2;
      const passed   = drift <= maxDrift;
      const bVerdict = passed ? "pass" : "fail";

      wlog(`      ↳ baseline drift=${drift.toFixed(4)}  verdict=${bVerdict}`);

      if (step.store_as) {
        const prev = ctx.get(step.store_as) as Record<string, unknown> | undefined ?? {};
        ctx.set(step.store_as, { ...prev, baseline_distance: drift, baseline_verdict: bVerdict });
      }

      if (!passed) {
        throw new AssertionError(
          `llm_eval regression: drift ${drift.toFixed(4)} > ${maxDrift} for baseline "${step.baseline_key}"`
        );
      }
    }
  }

  // Priority: named target from llmTargets > inline provider/model > mock
  private resolveTarget(step: StepAction & { action: "llm_eval" }): LLMProvider {
    if (step.target) {
      const cfg = this.llmTargets[step.target];
      if (!cfg) throw new AssertionError(`llm_eval: unknown target "${step.target}" — check config.llm_targets`);
      return createLLMProvider({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl });
    }

    if (step.provider) {
      return createLLMProvider({ provider: step.provider as ProviderName, model: step.model });
    }

    wlog("      ↳ [warn] no target or provider specified — using mock LLM (responses are not real)");
    return createLLMProvider({ provider: "mock" });
  }
}
