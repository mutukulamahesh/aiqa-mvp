/**
 * StepInterpreter — thin orchestrator.
 * Resolves the handler for each step and runs it.
 */
import { HandlerRegistry } from "./HandlerRegistry";
import { UIActionHandler } from "../handlers/UIActionHandler";
import { AssertionHandler } from "../handlers/AssertionHandler";
import { APIActionHandler } from "../handlers/APIActionHandler";
import { DBActionHandler } from "../handlers/DBActionHandler";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "./ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";

export class StepInterpreter {
  private registry: HandlerRegistry;
  private dbHandler: DBActionHandler;

  constructor() {
    this.dbHandler = new DBActionHandler();
    this.registry  = new HandlerRegistry()
      .register(new UIActionHandler())
      .register(new AssertionHandler())
      .register(new APIActionHandler())
      .register(this.dbHandler);
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
