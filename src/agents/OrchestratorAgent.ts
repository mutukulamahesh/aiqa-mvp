import * as fs   from "fs";
import * as path from "path";
import { AppExplorer }        from "./AppExplorer";
import { FlowMapper }          from "./FlowMapper";
import { ScenarioGenerator }   from "./ScenarioGenerator";
import { HealerCache }         from "../healer/HealerCache";
import { HealerAnalytics, AnalyticsReport } from "../healer/HealerAnalytics";
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
  PipelineStatus,
  PipelineStage,
  PipelineError,
  StageTimings,
  OrchestratorSummary,
  OrchestratorInput,
} from "./types";

export type { OrchestratorInput };

export interface StageResults {
  explorer?:   ExplorationResult;
  flowMapper?: UserFlow[];
  generator?:  GeneratedScenario[];
  runner?:     TestResult[];
}

export interface OrchestratorResult {
  runId:        string;
  status:       PipelineStatus;
  failedStage?: PipelineStage;
  error?:       PipelineError;
  stageResults: StageResults;
  exploration?: ExplorationResult;
  flows?:       UserFlow[];
  scenarios?:   GeneratedScenario[];
  results:      TestResult[];
  debugMap:     Map<string, DebugResult>;
  report?:      ReadinessReport;
  narrative?:   string;
  analytics?:   AnalyticsReport;
  summary:      OrchestratorSummary;
}

const TOTAL_STAGES = 5;

function makeRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class OrchestratorAgent {
  private readonly llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm ?? createLLMProvider();
  }

  async run(input: OrchestratorInput): Promise<OrchestratorResult> {
    const progress  = input.onProgress ?? defaultProgress;
    const startTime = Date.now();
    const timings: StageTimings = {};
    const runId = makeRunId();

    // ── Stage 1: Explore ──────────────────────────────────────────────────────
    progress(1, TOTAL_STAGES, `[Explorer] Exploring ${input.url}`);
    let exploration: ExplorationResult;
    const t1 = Date.now();
    try {
      const explorerOpts: ExplorerOptions = {
        headless: input.headless ?? true,
        maxPages: input.maxPages,
      };
      exploration = await new AppExplorer().explore(input.url, explorerOpts);
    } catch (err) {
      return this.partialResult("explorer", err as Error, runId, startTime, timings, input);
    }
    timings.explorer = Date.now() - t1;

    // ── Stage 1b: Authenticated re-exploration ────────────────────────────────
    // If the anonymous crawl found a login page and credentials are provided,
    // log in then BFS the post-login pages (inventory, cart, checkout, etc.)
    // and merge them into the exploration before FlowMapper sees it.
    const authPage = exploration.pages.find(p => p.inputs.some(i => i.type === "password"));
    if (authPage) {
      const creds = this.extractCredentials(input.env);
      if (creds) {
        progress(1, TOTAL_STAGES, `[Explorer] Authenticated re-exploration (${authPage.url})`);
        try {
          const authResult = await new AppExplorer().exploreAuthenticated(
            authPage.url, authPage, creds, { headless: input.headless ?? true, maxPages: input.maxPages },
          );
          if (authResult.pages.length > 0) {
            const knownUrls = new Set(exploration.pages.map(p => p.url));
            const newPages  = authResult.pages.filter(p => !knownUrls.has(p.url));
            exploration = {
              ...exploration,
              pages:      [...exploration.pages, ...newPages],
              totalPages: exploration.pages.length + newPages.length,
              totalLinks: exploration.totalLinks + authResult.totalLinks,
            };
            progress(1, TOTAL_STAGES, `[Explorer] Merged ${newPages.length} post-login page(s) — total ${exploration.totalPages}`);
          }
        } catch (err) {
          // Non-fatal: continue with anonymous pages if auth crawl fails
          console.warn(`  [Orchestrator] Auth re-exploration failed: ${(err as Error).message}`);
        }
      }
    }

    // ── Stage 2: Map flows ────────────────────────────────────────────────────
    progress(2, TOTAL_STAGES, `[FlowMapper] Mapping flows (${exploration.totalPages} pages found)`);
    let flows: UserFlow[];
    const t2 = Date.now();
    // Shared cache: FlowMapper reads validated selectors from prior runs so generated
    // steps embed known-good CSS targets directly (skips healer strategy 3/4 on re-runs).
    const selectorCache = new HealerCache();
    const analytics     = new HealerAnalytics(selectorCache);
    const flowMapper    = new FlowMapper(this.llm, selectorCache);
    try {
      flows = await flowMapper.map(exploration);
    } catch (err) {
      return this.partialResult("flow_mapper", err as Error, runId, startTime, timings, input, { exploration });
    }
    timings.flow_mapper = Date.now() - t2;

    // ── Stage 3: Generate scenarios ───────────────────────────────────────────
    progress(3, TOTAL_STAGES, `[Generator] Generating scenarios (${flows.length} flows)`);
    let scenarios: GeneratedScenario[];
    const t3 = Date.now();
    try {
      scenarios = await new ScenarioGenerator(this.llm).generate(flows, input.url);
    } catch (err) {
      return this.partialResult("scenario_generator", err as Error, runId, startTime, timings, input, { exploration, flows });
    }
    timings.scenario_generator = Date.now() - t3;

    const validated = scenarios.filter(s => s.validated);
    const warnings  = scenarios
      .filter(s => !s.validated && s.validationError)
      .map(s => `${s.testName}: ${s.validationError!}`);

    // ── Dry-run: skip execution ───────────────────────────────────────────────
    if (input.dryRun) {
      const seeded = flowMapper.getSeedCount();
      analytics.recordRun({ runId, timestamp: new Date().toISOString(), url: input.url, seededSelectors: seeded, testsPassed: 0, testsFailed: 0 });
      const summary = this.buildSummary(
        runId, input.url, "dry_run", undefined, undefined,
        flows, scenarios, [], timings, warnings, startTime, undefined, seeded,
      );
      this.persistSummary(summary, input.outDir);
      return {
        runId,
        status:      "dry_run",
        stageResults: { explorer: exploration, flowMapper: flows, generator: scenarios },
        exploration,
        flows,
        scenarios,
        results:  [],
        debugMap: new Map(),
        analytics: analytics.getReport(),
        summary,
      };
    }

    // ── Stage 4: Run tests ────────────────────────────────────────────────────
    progress(4, TOTAL_STAGES, `[Runner] Running ${validated.length} valid scenario(s)`);
    const results: TestResult[] = [];
    const t4 = Date.now();
    const runner = new TestRunner({ headless: input.headless ?? true, timeout: input.timeout });
    try {
      for (const scenario of validated) {
        const def    = parseTestDefinition(scenario.yaml);
        const result = await runner.run(def);
        results.push(result);
      }
    } catch (err) {
      return this.partialResult("test_runner", err as Error, runId, startTime, timings, input, {
        exploration, flows, scenarios, results,
      });
    }
    timings.test_runner = Date.now() - t4;

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
    progress(5, TOTAL_STAGES, "[Scorer] Scoring readiness");
    const t5 = Date.now();
    const report = new ReadinessScorer().score(results, debugMap);
    timings.scorer = Date.now() - t5;

    // ── Post-run narrative ────────────────────────────────────────────────────
    const narrative = await this.buildNarrative(exploration, flows, scenarios, results, report);

    const status: PipelineStatus = warnings.length > 0 ? "success_with_warnings" : "success";
    const seeded = flowMapper.getSeedCount();
    analytics.recordRun({
      runId,
      timestamp:       new Date().toISOString(),
      url:             input.url,
      seededSelectors: seeded,
      testsPassed:     results.filter(r => r.passed).length,
      testsFailed:     results.filter(r => !r.passed).length,
    });
    const summary = this.buildSummary(
      runId, input.url, status, report, undefined,
      flows, scenarios, results, timings, warnings, startTime, undefined, seeded,
    );
    this.persistSummary(summary, input.outDir);

    return {
      runId,
      status,
      stageResults: { explorer: exploration, flowMapper: flows, generator: scenarios, runner: results },
      exploration,
      flows,
      scenarios,
      results,
      debugMap,
      report,
      narrative,
      analytics: analytics.getReport(),
      summary,
    };
  }

  // ── Credential extraction ──────────────────────────────────────────────────

  private extractCredentials(env?: string): { username: string; password: string } | null {
    if (!env) return null;
    const vars: Record<string, string> = {};
    for (const line of env.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const username = vars.USERNAME ?? vars.USER ?? vars.EMAIL ?? vars.LOGIN;
    const password = vars.PASSWORD ?? vars.PASS ?? vars.SECRET;
    if (!username || !password) return null;
    return { username, password };
  }

  // ── Partial failure ────────────────────────────────────────────────────────

  private partialResult(
    stage:     PipelineStage,
    err:       Error,
    runId:     string,
    startTime: number,
    timings:   StageTimings,
    input:     OrchestratorInput,
    partial:   Partial<Pick<OrchestratorResult, "exploration" | "flows" | "scenarios" | "results">> = {},
  ): OrchestratorResult {
    const pipelineError: PipelineError = { message: err.message, stage, stack: err.stack };
    const summary = this.buildSummary(
      runId, input.url, "partial_failure", undefined, stage,
      partial.flows     ?? [],
      partial.scenarios ?? [],
      partial.results   ?? [],
      timings, [], startTime, pipelineError,
    );
    this.persistSummary(summary, input.outDir);
    return {
      runId,
      status:      "partial_failure",
      failedStage: stage,
      error:       pipelineError,
      stageResults: {
        explorer:   partial.exploration,
        flowMapper: partial.flows,
        generator:  partial.scenarios,
        runner:     partial.results,
      },
      exploration: partial.exploration,
      flows:       partial.flows,
      scenarios:   partial.scenarios,
      results:     partial.results ?? [],
      debugMap:    new Map(),
      summary,
    };
  }

  // ── Summary builder ────────────────────────────────────────────────────────

  private buildSummary(
    runId:            string,
    url:              string,
    status:           PipelineStatus,
    report:           ReadinessReport | undefined,
    failedStage:      PipelineStage   | undefined,
    flows:            UserFlow[],
    scenarios:        GeneratedScenario[],
    results:          TestResult[],
    timings:          StageTimings,
    warnings:         string[],
    startTime:        number,
    error?:           PipelineError,
    seededSelectors = 0,
  ): OrchestratorSummary {
    const passed = results.filter(r => r.passed).length;
    return {
      runId,
      url,
      status,
      failedStage,
      error,
      flows:            flows.length,
      scenarios:        scenarios.length,
      valid:            scenarios.filter(s => s.validated).length,
      passed,
      failed:           results.length - passed,
      score:            report?.score ?? 0,
      grade:            report?.grade ?? "F",
      durationMs:       Date.now() - startTime,
      warnings,
      timings,
      seededSelectors,
      generatedAt:      new Date().toISOString(),
    };
  }

  // ── Persist summary ────────────────────────────────────────────────────────

  private persistSummary(summary: OrchestratorSummary, outDir?: string): void {
    if (!outDir) return;
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "orchestrator-summary.json"),
        JSON.stringify(summary, null, 2),
      );
    } catch { /* best-effort — don't fail the run */ }
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
