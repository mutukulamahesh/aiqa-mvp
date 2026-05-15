import { Router } from "express";
import { issueToken } from "../ws/wsTokenStore";

const router = Router();

/**
 * POST /api/ws-token
 * Issues a short-lived (60s) one-time token for WS upgrade authentication.
 * The client must be authenticated (Authorization: Bearer <AIQA_API_KEY>) to call this.
 * The returned token is passed as ?token= in the WebSocket URL.
 */
router.post("/ws-token", (_req, res) => {
  res.json({ token: issueToken(), expiresInMs: 60_000 });
});

export default router;
