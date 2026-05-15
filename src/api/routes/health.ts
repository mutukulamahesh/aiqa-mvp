import * as fs   from "fs";
import * as path from "path";
import { Router } from "express";
import { getCircuitBreaker } from "../../utils/circuitBreaker";

const router   = Router();
const startTime = Date.now();

router.get("/health", async (_req, res) => {
  const checks: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }> = {};

  // ── Disk: can we write to the .aiqa run directory? ─────────────────────────
  try {
    const testDir  = path.resolve(process.cwd(), ".aiqa");
    const testFile = path.join(testDir, ".health-probe");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    checks.disk = { status: "ok" };
  } catch (err) {
    checks.disk = { status: "error", detail: (err as Error).message };
  }

  // ── LLM circuit breaker state ─────────────────────────────────────────────
  const llmNames = ["anthropic", "openai", "nvidia", "gemini"];
  for (const name of llmNames) {
    const cb = getCircuitBreaker(name);
    if (cb.getFailures() > 0 || cb.getState() !== "closed") {
      checks[`llm.${name}`] = {
        status: cb.getState() === "open" ? "error" : "degraded",
        detail: `circuit ${cb.getState()}, ${cb.getFailures()} failure(s)`,
      };
    }
  }

  // ── Playwright: chromium binary reachable? ─────────────────────────────────
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    checks.playwright = { status: "ok" };
  } catch (err) {
    checks.playwright = { status: "error", detail: (err as Error).message };
  }

  const anyError    = Object.values(checks).some(c => c.status === "error");
  const anyDegraded = Object.values(checks).some(c => c.status === "degraded");
  const overall     = anyError ? "error" : anyDegraded ? "degraded" : "ok";

  res.status(anyError ? 503 : 200).json({
    status:   overall,
    version:  process.env.npm_package_version ?? "unknown",
    uptimeMs: Date.now() - startTime,
    checks,
  });
});

export default router;
