/**
 * HandlerRegistry — maps action names to their handler implementation.
 */
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "./ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";

/** Interface every handler must implement */
export interface StepHandler {
  readonly handles: string[];
  execute(step: StepAction, adapter: AdapterActions, ctx: ExecutionContext): Promise<void>;
}

export class HandlerRegistry {
  private handlers = new Map<string, StepHandler>();

  register(handler: StepHandler): this {
    for (const action of handler.handles) {
      this.handlers.set(action, handler);
    }
    return this;
  }

  get(action: string): StepHandler {
    const h = this.handlers.get(action);
    if (!h) {
      throw new Error(
        `No handler registered for action: "${action}". ` +
        `Registered: [${[...this.handlers.keys()].join(", ")}]`
      );
    }
    return h;
  }
}
