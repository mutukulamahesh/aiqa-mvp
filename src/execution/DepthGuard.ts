import { SubStepExecutor } from "../handlers/ConditionHandler";

export const MAX_NESTING_DEPTH = 7;

export function wrapWithDepthGuard(
  executor: SubStepExecutor,
  maxDepth: number = MAX_NESTING_DEPTH,
): SubStepExecutor {
  let depth = 0;
  return async (step, adapter, ctx) => {
    depth++;
    if (depth > maxDepth) {
      depth--;
      throw new Error(`Max step nesting depth exceeded (${maxDepth})`);
    }
    try {
      await executor(step, adapter, ctx);
    } finally {
      depth--;
    }
  };
}
