import { injectConfig } from "../config/ConfigLoader";
import { parseTestDefinition } from "../dsl/DslParser";
import { TestRunner } from "../runner/TestRunner";
import type { EnvConfig } from "../config/ConfigLoader";
import type { RunEvent } from "../runner/RunEvent";

const DEMO_YAML = `
test:
  name: "AIQA Demo — SauceDemo Login"
  tags: [demo, smoke]
  steps:
    - navigate: "https://www.saucedemo.com"
    - fill:
        target: "#user-name"
        value: "standard_user"
    - fill:
        target: "#password"
        value: "secret_sauce"
    - click: "#login-button"
    - assert_text_visible: "Products"
`.trimStart();

const DEMO_CONFIG: EnvConfig = {
  environment: "dev",
  urls:        { base: "https://www.saucedemo.com", api: "https://www.saucedemo.com" },
  timeouts:    { action: 15000, navigation: 30000, api: 10000 },
  execution:   { workers: 1, retries: 0, headless: true, maxPages: 10, maxDepth: 3, circuitBreaker: 5 },
  screenshots: { onFailure: false, dir: "screenshots" },
  results:     { dir: "results" },
  features:    { llmEnabled: false },
  llm:         { provider: "mock", fallback: [] },
  llm_targets: {},
  db:          { readOnly: true },
  storage:     { maxHistory: 200, maxArtifacts: 10 },
  api:         { allowlist: [], denylist: [] },
  knowledge: {
    enabled:   false,
    indexPath: ".aiqa/knowledge",
    topK:      5,
    chunker:   "naive",
    reranker:  { strategy: "cosine", semanticWeight: 0.6, recencyWeight: 0.2, severityWeight: 0.1, sourceWeight: 0.1 },
    connectors: [],
  },
  privacy_mode: false,
};

const SEP = "═".repeat(52);

export async function runDemo(): Promise<void> {
  injectConfig(DEMO_CONFIG);

  const testDef = parseTestDefinition(DEMO_YAML);
  const total   = testDef.steps.length;

  console.log(`\n${SEP}`);
  console.log("  AIQA Demo — Enterprise AI QA Platform");
  console.log("  Zero config · No API key · Real browser");
  console.log(SEP);
  console.log();
  console.log("  Testing: https://www.saucedemo.com");
  console.log("  Mode:    headless · mock LLM (no key needed)");
  console.log();
  console.log(`  ── ${testDef.name} ${"─".repeat(Math.max(0, 44 - testDef.name.length))}`);
  console.log();

  const stepLabels: string[] = [];
  let stepsDone  = 0;
  let startMs    = Date.now();

  const runner = new TestRunner({ headless: true, timeout: 15000 });

  const result = await runner.run(testDef, (ev: RunEvent) => {
    if (ev.event === "step") {
      const action = ev.action.replace(/_/g, " ").padEnd(16);
      const target = (ev.target ?? "").slice(0, 30);
      const label  = `  step ${ev.index + 1}/${total}  ${action}  ${target}`;
      stepLabels.push(label);
      process.stdout.write(`${label}\n`);
    }
    if (ev.event === "step_result") {
      stepsDone++;
      const tick  = ev.passed ? "✓" : "✗";
      const col   = stepLabels[ev.index]?.length ?? 0;
      const fits  = col < (process.stdout.columns ?? 80);
      if (process.stdout.isTTY && fits) {
        process.stdout.write(`\x1b[1A\x1b[${col}C  ${tick}\n`);
      } else {
        process.stdout.write(`  ${tick}\n`);
      }
    }
  });

  const elapsed = Date.now() - startMs;
  console.log();

  if (result.passed) {
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  ✅  Passed  ${stepsDone}/${total} steps  (${elapsed}ms)`);
    console.log(`  ${"─".repeat(50)}`);
  } else {
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  ❌  Failed  — ${result.error ?? "unknown error"}`);
    console.log(`  ${"─".repeat(50)}`);
  }

  console.log();
  console.log("  Next — run AIQA on your own app:");
  console.log();
  console.log("    aiqa init my-project --base-url https://your-app.com");
  console.log("    aiqa explore https://your-app.com --out my-project");
  console.log("    aiqa run-all my-project/tests/ --headless");
  console.log();
  console.log(`${SEP}\n`);

  process.exit(result.passed ? 0 : 1);
}
