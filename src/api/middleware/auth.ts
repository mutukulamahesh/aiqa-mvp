import * as crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Authentication middleware.
 *
 * Default behaviour: DENY all unauthenticated requests.
 * Set AIQA_ALLOW_OPEN_MODE=true to explicitly opt into unauthenticated access
 * (useful for local development without a key configured).
 *
 * When AIQA_API_KEY is set, every request must carry:
 *   Authorization: Bearer <AIQA_API_KEY>
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey    = process.env.AIQA_API_KEY;
  const openMode  = process.env.AIQA_ALLOW_OPEN_MODE?.toLowerCase() === "true";

  if (!apiKey) {
    if (openMode) { next(); return; }
    // No key and no explicit opt-in → lock down
    res.status(401).json({
      error: "API key not configured. Set AIQA_API_KEY or AIQA_ALLOW_OPEN_MODE=true for local dev.",
    });
    return;
  }

  const header = req.headers.authorization ?? "";
  // Hash both sides to fixed-length (SHA-256 = 32 bytes) before comparing.
  // This removes the byte-length side channel from the short-circuit `length ===` check
  // that would otherwise reveal the key length to an attacker probing header sizes.
  const expectedHash = crypto.createHash("sha256").update(`Bearer ${apiKey}`).digest();
  const actualHash   = crypto.createHash("sha256").update(header).digest();
  const match        = crypto.timingSafeEqual(expectedHash, actualHash);
  if (match) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}
