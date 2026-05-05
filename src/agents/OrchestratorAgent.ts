import { AppExplorer }        from "./AppExplorer";
import { FlowMapper }          from "./FlowMapper";
import { ScenarioGenerator }   from "./ScenarioGenerator";
import { DebuggerAgent }        from "./DebuggerAgent";
import { ReadinessScorer }      from "./ReadinessScorer";
import { createLLMProvider, LLMProvider } from "../llm/LLMProvider";
import { parseTestDefinition }  from "../dsl/DslParser";
import { TestRunner }           from "../runner/TestRunner";
import { TestResult }           from "../runner/TestRunner";
import {
  ExplorationResult,
  UserFlow,
  GeneratedScenario,
  DebugResult,
  ReadinessReport,
  ExplorerOptions,
} from "./types";

export interface OrchestratorOptions {
  env?:        string;
  maxPages?:   number;
  headless?:   boolean;
  timeout?:    number;
  outDir?:     string;
  onProgress?: (stage: number, total: number, message: string) => void;
}

export interface OrchestratorResult {
  exploration: ExplorationResult;
  flows:       UserFlow[];
  scenarios:   GeneratedScenario[];
  results:     TestResult[];
  debugMap:    Map<string, DebugResult>;
  report:      ReadinessReport;
  narrative:   string;
}

const TOTAL_STAGES = 5;

export class OrchestratorAgent {
  private readonly llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  async run(url: string, opts: OrchestratorOptions = {}): Promise<OrchestratorResult> {
    const progress = opts.onProgress ?? defaultProgress;

    // ── Stage 1: Explore ──────────────────────────────────────────────────────
    progress(1, TOTAL_STAGES, `Exploring ${url}`);
    const explorerOpts: ExplorerOptions = {
      headless: opts.headless ?? true,
      maxPages: opts.maxPages,
    };
    const exploration = await new AppExplorer().explore(url, explorerOpts);

    // ── Stage 2: Map flows ────────────────────────────────────────────────────
    progress(2, TOTAL_STAGES, `Mapping flows (${exploration.totalPages} pages found)`);
    const flows = await new FlowMapper().map(exploration);

    // ── Stage 3: Generate scenarios ───────────────────────────────────────────
    progress(3, TOTAL_STAGES, `Generating scenarios (${flows.length} flows)`);
    const scenarios = await new ScenarioGenerator(this.llm).generate(flows, url);
    const validated  = scenarios.filter(s => s.validated);

    // ── Stage 4: Run tests ────────────────────────────────────────────────────
    progress(4, TOTAL_STAGES, `Running tests (${validated.length} scenarios)`);
    const runner  = new TestRunner({ headless: opts.headless ?? true, timeout: opts.timeout });
    const results: TestResult[] = [];

    for (const scenario of validated) {
      const def    = parseTestDefinition(scenario.yaml);
      const result = await runner.run(def);
      results.push(result);
    }

    // ── Debug failed tests ────────────────────────────────────────────────────
    const debugger_ = new DebuggerAgent(this.llm);
    const debugMap  = new Map<string, DebugResult>();

    for (const result of results) {
      if (!result.passed) {
        const failedStep = result.stepResults?.find(s => !s.passed);
        if (failedStep) {
          const debug = await debugger_.analyze({
            test_name:     result.testName,
            step_action:   failedStep.action,
            step_index:    result.stepResults!.indexOf(failedStep),
            error_message: result.error ?? failedStep.error ?? "unknown",
          });
          debugMap.set(result.testName, debug);
        }
      }
    }

    // ── Stage 5: Score readiness ──────────────────────────────────────────────
    progress(5, TOTAL_STAGES, "Scoring readiness");
    const report = new ReadinessScorer().score(results, debugMap);

    // ── Post-run narrative ────────────────────────────────────────────────────
    const narrative = await this.buildNarrative(exploration, flows, scenarios, results, report);

    return { exploration, flows, scenarios, results, debugMap, report, narrative };
  }

  // ── Narrative ─────────────────────────────────────────────────────────────

  private async buildNarrative(
    exploration: ExplorationResult,
    flows:       UserFlow[],
    scenarios:   GeneratedScenario[],
    results:     TestResult[],
    report:      ReadinessReport,
  ): Promise<string> {
    if (this.llm.name === "mock") return this.templateNarrative(exploration, scenarios, report);

    try {
      const res = await this.llm.complete({
        system: "You are a QA lead summarising a test run in 2-3 concise sentences. Be specific about numbers.",
        userMessage:
          `URL: ${exploration.baseUrl}\n` +
          `Pages explored: ${exploration.totalPages}\n` +
          `Flows mapped: ${flows.length}\n` +
          `Scenarios generated: ${scenarios.length} (${scenarios.filter(s => s.validated).length} valid)\n` +
          `Tests run: ${results.length} — ${report.passed} passed, ${report.failed} failed\n` +
          `Readiness score: ${report.score}/100 (Grade ${report.grade})\n` +
          `Recommendation: ${report.recommendation}`,
        maxTokens: 200,
      });
      return res.content.trim();
    } catch {
      return this.templateNarrative(exploration, scenarios, report);
    }
  }

  private templateNarrative(
    exploration: ExplorationResult,
    scenarios:   GeneratedScenario[],
    report:      ReadinessReport,
  ): string {
    return (
      `Explored ${exploration.totalPages} page${exploration.totalPages === 1 ? "" : "s"} · ` +
      `Generated ${scenarios.length} test${scenarios.length === 1 ? "" : "s"} · ` +
      `${report.passed} passed / ${report.failed} failed · ` +
      `Score: ${report.score}% (Grade ${report.grade})`
    );
  }
}

function defaultProgress(stage: number, total: number, message: string): void {
  console.log(`[${stage}/${total}] ${message}`);
}
