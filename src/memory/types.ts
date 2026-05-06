export interface KnownPattern {
  failureClass: string;
  rootCause:    string;
  suggestedFix: string;
  firstSeen:    string;
  hitCount:     number;
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
