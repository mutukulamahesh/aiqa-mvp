/**
 * StepInterpreter — thin orchestrator.
 * Resolves the handler for each step and runs it.
 */
import { HandlerRegistry } from "./HandlerRegistry";
import { UIActionHandler } from "../handlers/UIActionHandler";
import { AssertionHandler } from "../handlers/AssertionHandler";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "./ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";

export class StepInterpreter {
  private registry: HandlerRegistry;

  constructor() {
    this.registry = new HandlerRegistry()
      .register(new UIActionHandler())
      .register(new AssertionHandler());
  }

  async execute(
    step: StepAction,
    adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    const handler = this.registry.get(step.action);
    await handler.execute(step, adapter, ctx);
  }
}
