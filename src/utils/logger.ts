/**
 * Structured logger — thin wrapper over process.stdout/stderr.
 * Level is controlled by AIQA_LOG_LEVEL env var: debug | info | warn | error (default: info).
 * Format: [LEVEL] ISO-timestamp  message
 *
 * Using a wrapper (rather than console.*) means:
 *  - Log level filtering works uniformly across the codebase
 *  - Correlation IDs can be injected per-request
 *  - Output can be redirected to a structured sink without touching call sites
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function activeLevel(): number {
  const env = (process.env.AIQA_LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[env] ?? LEVELS.info;
}

function write(level: LogLevel, msg: string, correlationId?: string): void {
  if (LEVELS[level] < activeLevel()) return;
  const ts     = new Date().toISOString();
  const corr   = correlationId ? ` [${correlationId}]` : "";
  const line   = `[${level.toUpperCase()}] ${ts}${corr}  ${msg}\n`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  debug: (msg: string, correlationId?: string) => write("debug", msg, correlationId),
  info:  (msg: string, correlationId?: string) => write("info",  msg, correlationId),
  warn:  (msg: string, correlationId?: string) => write("warn",  msg, correlationId),
  error: (msg: string, correlationId?: string) => write("error", msg, correlationId),
};
