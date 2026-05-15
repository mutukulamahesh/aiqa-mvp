import { SubStepExecutor } from "../handlers/ConditionHandler";
import { ExecutionContext } from "./ExecutionContext";

export const MAX_NESTING_DEPTH = 7;

/**
 * Wraps a SubStepExecutor with a per-execution nesting depth guard.
 *
 * Depth is stored on ExecutionContext (not in the closure) so that if an
 * interpreter or handler is ever reused across multiple test executions the
 * counters remain isolated — each ExecutionContext carries its own state.
 */
export function wrapWithDepthGuard(
  executor: SubStepExecutor,
  maxDepth: number = MAX_NESTING_DEPTH,
): SubStepExecutor {
  return async (step, adapter, ctx) => {
    ctx.incrementNestingDepth();
    if (ctx.nestingDepth > maxDepth) {
      ctx.decrementNestingDepth();
      throw new Error(`Max step nesting depth exceeded (${maxDepth})`);
    }
    try {
      await executor(step, adapter, ctx);
    } finally {
      ctx.decrementNestingDepth();
    }
  };
}
