import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.AIQA_API_KEY;
  if (!apiKey) { next(); return; }  // open mode — no key configured
  const header = req.headers.authorization ?? "";
  if (header === `Bearer ${apiKey}`) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}
