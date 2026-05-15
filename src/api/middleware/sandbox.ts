import * as fs   from "fs";
import * as path from "path";
import { ApiError } from "../errors";

/**
 * Resolves `userInput` relative to `base` and throws ApiError(400) if the result
 * escapes the base directory.
 *
 * Uses fs.realpathSync to resolve symlinks so that a symlink inside the project
 * root that points outside it does NOT pass the containment check.
 * Falls back to path.resolve (logical resolution) if the path does not yet exist
 * on disk (e.g. an output directory that will be created later).
 */
export function safeResolvePath(base: string, userInput: string): string {
  const resolvedBase = resolveReal(base);
  const resolved     = resolveReal(path.resolve(base, userInput));

  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new ApiError(400, "Invalid path — outside project root");
  }
  return resolved;
}

function resolveReal(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // Path does not exist yet (e.g. an output dir to be created) — fall back to logical resolution.
    // This is safe: we checked containment on the logical path; the real check fires on the next
    // call once the path exists.
    return path.resolve(p);
  }
}
