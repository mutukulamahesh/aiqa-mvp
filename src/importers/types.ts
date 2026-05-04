/** Normalised test case shape produced by all importers before YAML translation. */
export interface RawTestCase {
  id:            string;
  name:          string;
  precondition?: string;
  steps:         string[];   // one natural-language step per entry
  expected?:     string;
}

/** Maps source column headers → RawTestCase field names. */
export interface ColumnMap {
  id?:          string;
  name?:        string;
  precondition?: string;
  steps?:       string;
  expected?:    string;
}

/** Result of a single import-and-translate operation. */
export interface ImportResult {
  source:     string;   // original file path
  testCase:   RawTestCase;
  yamlPath:   string;   // where the generated YAML was written
  warnings:   string[]; // vague or unmappable steps
  validated:  boolean;  // true = DslParser accepted the output
}
