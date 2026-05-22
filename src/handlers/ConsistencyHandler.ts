import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { AssertionError } from "../errors";
import { LLMProvider, createLLMProvider, ProviderName } from "../llm/LLMProvider";
import { IEmbedder } from "../knowledge/Embedder";
import { VarianceComputer } from "../ai-testing/VarianceComputer";
import { wwrite, wlog } from "../execution/WorkerContext";

type LLMTargets = Record<string, { provider: ProviderName; model?: string; baseUrl?: string }>;

export class ConsistencyHandler implements StepHandler {
  readonly handles = ["llm_consistency"];

  constructor(
    private readonly embedder:    IEmbedder,
    private readonly llmTargets:  LLMTargets = {},
  ) {}

  async execute(step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext): Promise<void> {
    if (step.action !== "llm_consistency") return;

    const targetLlm = this.resolveTarget(step);
    const prompt    = ctx.resolve(step.prompt);
    const system    = step.system ? ctx.resolve(step.system) : "You are a helpful assistant.";
    const runs      = step.runs ?? 3;
    const metric    = step.assert_variance?.metric ?? "max";

    wwrite(`  ▶ llm_consistency → ${runs} runs via ${targetLlm.name}`);

    const responses: string[] = [];
    for (let i = 0; i < runs; i++) {
      const res = await targetLlm.complete({ system, userMessage: prompt, maxTokens: step.max_tokens ?? 1024 });
      responses.push(res.content);
      wlog(`      ↳ run ${i + 1}: ${res.content.slice(0, 80)}${res.content.length > 80 ? "…" : ""}`);
    }

    const computer = new VarianceComputer(this.embedder);
    const variance = await computer.compute(responses, metric);

    wlog(`      ↳ variance (${metric}): ${variance.toFixed(4)}`);

    if (step.assert_variance) {
      const maxAllowed = step.assert_variance.max;
      const passed     = variance <= maxAllowed;
      const verdict    = passed ? "pass" : "fail";

      if (step.store_as) ctx.set(step.store_as, { responses, variance, metric, verdict });

      if (!passed) {
        throw new AssertionError(
          `llm_consistency failed: ${metric} pairwise distance ${variance.toFixed(4)} > ${maxAllowed}`
        );
      }
    } else {
      if (step.store_as) ctx.set(step.store_as, { responses, variance, metric });
    }
  }

  // Priority: named target from llmTargets > inline provider/model > mock
  private resolveTarget(step: StepAction & { action: "llm_consistency" }): LLMProvider {
    if (step.target) {
      const cfg = this.llmTargets[step.target];
      if (!cfg) throw new AssertionError(`llm_consistency: unknown target "${step.target}" — check config.llm_targets`);
      return createLLMProvider({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl });
    }

    if (step.provider) {
      return createLLMProvider({ provider: step.provider as ProviderName, model: step.model });
    }

    wlog("      ↳ [warn] no target or provider specified — using mock LLM (responses are not real)");
    return createLLMProvider({ provider: "mock" });
  }
}
