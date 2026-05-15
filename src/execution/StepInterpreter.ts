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
import { JudgeHandler } from "../handlers/JudgeHandler";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "./ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wrapWithDepthGuard } from "./DepthGuard";
import { createLLMProvider } from "../llm/LLMProvider";
import { getConfig } from "../config/ConfigLoader";

export class StepInterpreter {
  private registry: HandlerRegistry;
  private dbHandler: DBActionHandler;

  /**
   * @param registry  Optional pre-built HandlerRegistry.  When provided, it is used
   *                  as-is (useful for testing with mock handlers injected).
   *                  When omitted, the default production registry is assembled.
   */
  constructor(registry?: HandlerRegistry) {
    this.dbHandler = new DBActionHandler();

    if (registry) {
      this.registry = registry;
      return;
    }

    // Sub-step executor passed to branching/looping handlers so they reuse
    // the full interpreter pipeline (healer, memory, error classification).
    const runSubStep = wrapWithDepthGuard(
      (step: StepAction, adapter: AdapterActions, ctx: ExecutionContext) =>
        this.execute(step, adapter, ctx)
    );

    const llmConfig = (() => { try { return getConfig().llm; } catch { return undefined; } })();

    this.registry = new HandlerRegistry()
      .register(new UIActionHandler())
      .register(new AssertionHandler())
      .register(new APIActionHandler())
      .register(this.dbHandler)
      .register(new WaitHandler())
      .register(new StoreHandler())
      .register(new ConditionHandler(runSubStep))
      .register(new LoopHandler(runSubStep))
      .register(new JudgeHandler(createLLMProvider(llmConfig)));
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
