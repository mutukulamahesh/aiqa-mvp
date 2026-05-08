import cors from "cors";
import { IncomingMessage } from "http";

function getAllowedOrigins(): string[] {
  const raw = process.env.AIQA_ALLOWED_ORIGINS;
  if (!raw) return [];  // empty = wildcard
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function corsMiddleware() {
  const origins = getAllowedOrigins();
  return cors({
    origin:         origins.length === 0 ? "*" : origins,
    methods:        ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
}

/** Used by ws.Server verifyClient to enforce the same origin policy for WebSockets. */
export function verifyWsOrigin(req: IncomingMessage): boolean {
  const origins = getAllowedOrigins();
  if (origins.length === 0) return true;  // wildcard
  const origin = req.headers.origin ?? "";
  return origins.some(allowed => {
    if (allowed === "*") return true;
    if (allowed.endsWith("*")) return origin.startsWith(allowed.slice(0, -1));
    return allowed === origin;
  });
}
