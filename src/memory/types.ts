export interface KnownPattern {
  failureClass:           string;
  rootCause:              string;
  suggestedFix:           string;
  firstSeen:              string;
  hitCount:               number;
  /** Consecutive failures since this diagnosis was stored. Reset on pass; at threshold the pattern is evicted. */
  failuresSinceDiagnosis: number;
}

export interface StepMemory {
  stepKey:        string;
  flakinessScore: number;   // 0.0 – 1.0; threshold 0.4 = flaky
  runCount:       number;
  failCount:      number;
  lastUpdated:    string;   // ISO timestamp
  knownPattern?:  KnownPattern;
}

export interface MemoryData {
  suiteId:       string;
  updated:       string;
  llmCallsSaved: number;    // incremented each time a known pattern is reused
  steps:         Record<string, StepMemory>;
}
