import * as path from "path";
import { ApiError } from "../errors";

/**
 * Resolves `userInput` relative to `base` and throws ApiError(400) if the result
 * escapes the base directory. Guards all filesystem endpoints against path traversal.
 */
export function safeResolvePath(base: string, userInput: string): string {
  const resolvedBase = path.resolve(base);
  const resolved     = path.resolve(base, userInput);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new ApiError(400, "Invalid path — outside project root");
  }
  return resolved;
}
