import { TestDefinition, StepAction } from "../dsl/types";

export interface StepCost {
  type:       string;
  count:      number;
  tokensEst:  number;
  costUsdEst: number;
}

export interface CostEstimate {
  steps:         StepCost[];
  totalTokens:   number;
  totalCostUsd:  number;
  provider:      string;
}

// Token estimates per step (conservative averages)
// Each figure is input+output combined in a typical call.
const TOKEN_EST: Record<string, number> = {
  judge:            600,   // ~350 input (system+value+prompt) + ~100 output
  llm_eval:        1400,   // ~500 target call + ~600 judge call + ~300 output
  llm_consistency: 1500,   // 3 runs × ~500 tokens (scaled by runs field)
  vision_assert:   2000,   // ~1500 image tokens + ~500 prompt/output
};

// USD per 1M tokens — defaults to NVIDIA llama-3.1-8b pricing
const PRICE_PER_1M: Record<string, number> = {
  anthropic: 1.00,   // haiku blended
  openai:    0.30,   // gpt-4o-mini blended
  nvidia:    0.20,   // meta/llama-3.1-8b blended
  mock:      0.00,
  ollama:    0.00,
};

function countSteps(steps: StepAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    const action = step.action;
    if (action in TOKEN_EST) {
      counts[action] = (counts[action] ?? 0) + 1;
      // llm_consistency: scale by runs
      if (action === "llm_consistency" && "runs" in step && typeof (step as { runs: number }).runs === "number") {
        counts[action] = (counts[action] ?? 0) + ((step as { runs: number }).runs - 1);
      }
    }
    // recurse into branching steps
    if (action === "if" && "steps" in step) {
      const sub = countSteps((step as { steps: StepAction[] }).steps);
      for (const [k, v] of Object.entries(sub)) counts[k] = (counts[k] ?? 0) + v;
    }
    if (action === "for_each" && "steps" in step) {
      const sub = countSteps((step as { steps: StepAction[] }).steps);
      for (const [k, v] of Object.entries(sub)) counts[k] = (counts[k] ?? 0) + v;
    }
  }
  return counts;
}

export function estimateCost(tests: TestDefinition[], provider = "mock"): CostEstimate {
  const totals: Record<string, number> = {};
  for (const t of tests) {
    const counts = countSteps(t.steps);
    for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + v;
  }

  const pricePerToken = (PRICE_PER_1M[provider] ?? 0.20) / 1_000_000;

  const steps: StepCost[] = Object.entries(totals).map(([type, count]) => {
    const tokensEst  = (TOKEN_EST[type] ?? 0) * count;
    const costUsdEst = tokensEst * pricePerToken;
    return { type, count, tokensEst, costUsdEst };
  });

  const totalTokens  = steps.reduce((s, x) => s + x.tokensEst,  0);
  const totalCostUsd = steps.reduce((s, x) => s + x.costUsdEst, 0);

  return { steps, totalTokens, totalCostUsd, provider };
}

export function formatCostTable(est: CostEstimate): string {
  if (est.steps.length === 0) {
    return `   No LLM steps found — this run has no API cost.\n`;
  }
  const lines: string[] = [];
  lines.push(`   Provider : ${est.provider}`);
  lines.push(`   ┌──────────────────┬───────┬────────────────┬──────────────┐`);
  lines.push(`   │ Step type        │ Count │ Est. tokens    │ Est. cost    │`);
  lines.push(`   ├──────────────────┼───────┼────────────────┼──────────────┤`);
  for (const s of est.steps) {
    const t   = s.type.padEnd(16);
    const cnt = String(s.count).padStart(5);
    const tok = s.tokensEst.toLocaleString().padStart(14);
    const usd = est.provider === "mock" || est.provider === "ollama"
      ? "      free"
      : `$${s.costUsdEst.toFixed(4)}`.padStart(12);
    lines.push(`   │ ${t} │ ${cnt} │ ${tok} │ ${usd} │`);
  }
  lines.push(`   ├──────────────────┼───────┼────────────────┼──────────────┤`);
  const totTok = est.totalTokens.toLocaleString().padStart(14);
  const totUsd = est.provider === "mock" || est.provider === "ollama"
    ? "      free"
    : `$${est.totalCostUsd.toFixed(4)}`.padStart(12);
  lines.push(`   │ TOTAL            │       │ ${totTok} │ ${totUsd} │`);
  lines.push(`   └──────────────────┴───────┴────────────────┴──────────────┘`);
  lines.push(`   Note: estimates assume average prompt lengths. Actual cost may vary.`);
  return lines.join("\n") + "\n";
}
