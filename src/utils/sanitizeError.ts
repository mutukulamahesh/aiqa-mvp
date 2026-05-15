/**
 * Strips internal details (file paths, stack frames, internal module names)
 * from error messages before they are forwarded to API clients or WS streams.
 * Full error details are logged server-side before sanitization.
 */

const INTERNAL_PATTERNS = [
  /\s+at\s+\S+\s*\(.*?\)/g,                // stack frames: "  at Function (/path/to/file:1:2)"
  /\s+at\s+\S+:\d+:\d+/g,                  // bare stack lines
  /[A-Za-z]:[/\\][^\s)]+/g,               // Windows absolute paths C:\...
  /\/[a-z][^\s)]+\.(ts|js|mjs|cjs)/g,    // POSIX absolute paths ending in source file
  /node:internal\/[^\s)]+/g,              // Node internals
];

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let sanitized = raw;
  for (const pattern of INTERNAL_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  // Collapse multiple spaces/newlines left after stripping
  return sanitized.replace(/\s{2,}/g, " ").trim() || "An internal error occurred";
}
