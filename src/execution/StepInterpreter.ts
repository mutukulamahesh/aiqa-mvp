/**
 * StepInterpreter — thin orchestrator.
 * Resolves the handler for each step and runs it.
 */
import { HandlerRegistry } from "./HandlerRegistry";
import { UIActionHandler } from "../handlers/UIActionHandler";
import { AssertionHandler } from "../handlers/AssertionHandler";
import { APIActionHandler } from "../handlers/APIActionHandler";
import { DBActionHandler } from "../handlers/DBActionHandler";
import { WaitHandler } from "../handlers/WaitHandler";
import { StoreHandler } from "../handlers/StoreHandler";
import { ConditionHandler } from "../handlers/ConditionHandler";
import { LoopHandler } from "../handlers/LoopHandler";
import { JudgeHandler }        from "../handlers/JudgeHandler";
import { LLMEvalHandler }       from "../handlers/LLMEvalHandler";
import { ConsistencyHandler }   from "../handlers/ConsistencyHandler";
import { RagAssertHandler }       from "../handlers/RagAssertHandler";
import { VisionAssertHandler }    from "../handlers/VisionAssertHandler";
import { VisualSnapshotHandler }  from "../handlers/VisualSnapshotHandler";
import { VisionAgent }            from "../vision/VisionAgent";
import { OcrEngine }              from "../vision/OcrEngine";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "./ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wrapWithDepthGuard } from "./DepthGuard";
import { createLLMProvider, ProviderName } from "../llm/LLMProvider";
import { getConfig } from "../config/ConfigLoader";
import { KnowledgeRetriever } from "../knowledge/KnowledgeRetriever";
import { IEmbedder, Embedder } from "../knowledge/Embedder";
import { BaselineStore } from "../ai-testing/BaselineStore";

export class StepInterpreter {
  private registry: HandlerRegistry;
  private dbHandler: DBActionHandler;

  /**
   * @param opts.registry    Pre-built HandlerRegistry (useful for tests with mock handlers).
   *                         When omitted, the default production registry is assembled.
   * @param opts.retriever   KnowledgeRetriever passed to JudgeHandler for requirement-aware
   *                         evaluation. When omitted, JudgeHandler uses generic LLM scoring.
   */
  constructor(opts: { registry?: HandlerRegistry; retriever?: KnowledgeRetriever; embedder?: IEmbedder } = {}) {
    this.dbHandler = new DBActionHandler();

    if (opts.registry) {
      this.registry = opts.registry;
      return;
    }

    // Sub-step executor passed to branching/looping handlers so they reuse
    // the full interpreter pipeline (healer, memory, error classification).
    const runSubStep = wrapWithDepthGuard(
      (step: StepAction, adapter: AdapterActions, ctx: ExecutionContext) =>
        this.execute(step, adapter, ctx)
    );

    const cfg        = (() => { try { return getConfig(); } catch { return undefined; } })();
    const llmConfig  = cfg?.llm;
    const llmTargets = (cfg?.llm_targets ?? {}) as Record<string, { provider: ProviderName; model?: string; baseUrl?: string }>;
    const embedder   = opts.embedder ?? new Embedder();

    this.registry = new HandlerRegistry()
      .register(new UIActionHandler())
      .register(new AssertionHandler())
      .register(new APIActionHandler())
      .register(this.dbHandler)
      .register(new WaitHandler())
      .register(new StoreHandler())
      .register(new ConditionHandler(runSubStep))
      .register(new LoopHandler(runSubStep))
      .register(new JudgeHandler(createLLMProvider(llmConfig), opts.retriever))
      .register(new LLMEvalHandler(createLLMProvider(llmConfig), opts.retriever, llmTargets, embedder, new BaselineStore()))
      .register(new ConsistencyHandler(embedder, llmTargets))
      .register(new RagAssertHandler(opts.retriever))
      .register(new VisionAssertHandler(new VisionAgent(), new OcrEngine()))
      .register(new VisualSnapshotHandler());
  }

  async execute(
    step: StepAction,
    adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    const handler = this.registry.get(step.action);
    await handler.execute(step, adapter, ctx);
  }

  /** Release the DB connection pool. Called once after all steps complete. */
  async teardown(): Promise<void> {
    await this.dbHandler.close();
  }
}
