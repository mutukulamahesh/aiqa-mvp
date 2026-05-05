// Shared data contracts for all AIQA agents.
// Import from here — never re-declare in individual agent files.

// ── AppExplorer ───────────────────────────────────────────────────────────────

export interface InputField {
  type:         string;
  name?:        string;
  placeholder?: string;
}

export interface PageLink {
  text: string;
  href: string;
}

export interface ExploredPage {
  url:           string;
  title:         string;
  headings:      string[];
  buttons:       string[];
  inputs:        InputField[];
  links:         PageLink[];
  internalLinks: string[];
}

export interface ExplorationResult {
  baseUrl:     string;
  exploredAt:  string;
  pages:       ExploredPage[];
  totalPages:  number;
  totalLinks:  number;
}

export interface ExplorerOptions {
  headless?:       boolean;
  maxPages?:       number;
  maxDepth?:       number;
  timeout?:        number;
  ignorePatterns?: RegExp[];
}

// ── FlowMapper ────────────────────────────────────────────────────────────────

export interface FlowStep {
  action:       string;
  target?:      string;
  value?:       string;
  description?: string;
}

export interface UserFlow {
  name:        string;
  description: string;
  type:        "authentication" | "form_submission" | "navigation" | "crud";
  priority:    "high" | "medium" | "low";
  pages:       string[];
  steps:       FlowStep[];
}

// ── ScenarioGenerator ─────────────────────────────────────────────────────────

export interface GeneratedScenario {
  fileName:         string;
  testName:         string;
  flowType:         string;
  yaml:             string;
  validated:        boolean;
  validationError?: string;
}

// ── DebuggerAgent ─────────────────────────────────────────────────────────────

export type FailureClass =
  | "locator_failure"
  | "timing_issue"
  | "assertion_failure"
  | "api_failure"
  | "network_error"
  | "unknown";

export interface DebugParams {
  test_name:     string;
  step_action:   string;
  step_index:    number;
  error_message: string;
}

export interface DebugResult {
  failure_class:  FailureClass;
  root_cause:     string;
  suggested_fix:  string;
  confidence:     number;
  from_mock:      boolean;
}

// ── ReadinessScorer ───────────────────────────────────────────────────────────

export interface ReadinessReport {
  score:            number;
  grade:            "A" | "B" | "C" | "D" | "F";
  totalTests:       number;
  passed:           number;
  failed:           number;
  passRatePct:      number;
  coverageLayers:   string[];
  failureBreakdown: Partial<Record<FailureClass, number>>;
  topIssues:        string[];
  recommendation:   string;
  generatedAt:      string;
}

// ── RunSummary (HTMLReporter / run-all) ───────────────────────────────────────

export interface CircuitBreakerSummary {
  triggered: boolean;
  threshold: number;
  skipped:   number;
}

// ── OrchestratorAgent ─────────────────────────────────────────────────────────

export type PipelineStatus = "success" | "success_with_warnings" | "partial_failure" | "dry_run";

export interface PipelineError {
  message: string;
  stage:   PipelineStage;
  stack?:  string;
  code?:   string;
}

export type PipelineStage =
  | "explorer"
  | "flow_mapper"
  | "scenario_generator"
  | "test_runner"
  | "scorer";

export interface StageTimings {
  explorer?:            number;
  flow_mapper?:         number;
  scenario_generator?:  number;
  test_runner?:         number;
  scorer?:              number;
}

export interface OrchestratorSummary {
  runId:        string;
  url:          string;
  status:       PipelineStatus;
  failedStage?: PipelineStage;
  error?:       PipelineError;
  flows:        number;
  scenarios:    number;
  valid:        number;
  passed:       number;
  failed:       number;
  score:        number;
  grade:        "A" | "B" | "C" | "D" | "F";
  durationMs:   number;
  warnings:     string[];
  timings:      StageTimings;
  generatedAt:  string;
}

export interface OrchestratorInput {
  url:         string;
  env?:        string;
  maxPages?:   number;
  headless?:   boolean;
  timeout?:    number;
  outDir?:     string;
  dryRun?:     boolean;
  onProgress?: (stage: number, total: number, message: string) => void;
}
