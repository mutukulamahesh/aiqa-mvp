/**
 * One-time WebSocket upgrade tokens.
 *
 * The browser WebSocket API cannot send custom headers during the upgrade
 * handshake, so we cannot use Authorization: Bearer there.
 * Instead, the client:
 *   1. POSTs to /api/ws-token (authenticated via Authorization header)  → gets a short-lived token
 *   2. Opens WS with ?token=<that value>
 *
 * Each token is single-use with a 60-second TTL.
 */

import * as crypto from "crypto";

interface TokenEntry {
  expiresAt: number;
}

const TTL_MS  = 60_000;   // 60 seconds — enough for any reasonable client startup
const MAX_TOKENS = 500;    // prevent unbounded memory growth

const store = new Map<string, TokenEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (entry.expiresAt < now) store.delete(token);
  }
}

export function issueToken(): string {
  purgeExpired();
  if (store.size >= MAX_TOKENS) {
    // Evict oldest entry to stay under cap
    const oldest = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) store.delete(oldest[0]);
  }
  const token = crypto.randomBytes(32).toString("hex");
  store.set(token, { expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Validates and consumes the token (single-use). Returns true if valid. */
export function consumeToken(token: string): boolean {
  const entry = store.get(token);
  if (!entry) return false;
  store.delete(token); // single-use
  return entry.expiresAt >= Date.now();
}
