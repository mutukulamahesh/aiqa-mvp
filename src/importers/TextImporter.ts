import * as fs from "fs";
import { RawTestCase } from "./types";

/**
 * Parses plain text and Gherkin .feature files.
 *
 * Gherkin format:
 *   Feature: <name>
 *   Scenario: <name>
 *     Given ...
 *     When  ...
 *     And   ...
 *     Then  ...
 *
 * Plain text format (fallback):
 *   Test: <name>
 *   Steps:
 *   1. ...
 *   2. ...
 *   Expected: ...
 */
export class TextImporter {
  import(filePath: string): RawTestCase[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const ext     = filePath.split(".").pop()?.toLowerCase();

    if (ext === "feature") {
      return this.parseGherkin(content);
    }
    return this.parsePlainText(content);
  }

  // ── Gherkin ───────────────────────────────────────────────────────────────

  private parseGherkin(content: string): RawTestCase[] {
    const results: RawTestCase[]  = [];
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

    let scenarioName: string | null = null;
    let steps: string[]             = [];
    let background: string[]        = [];
    let scenarioIndex               = 0;
    let inBackground                = false;

    const STEP_KEYWORDS = /^(Given|When|Then|And|But)\s+/i;
    const flush = () => {
      if (scenarioName && steps.length > 0) {
        scenarioIndex++;
        results.push({
          id:   `scenario-${scenarioIndex}`,
          name: scenarioName,
          steps: [...background, ...steps],
        });
      }
      scenarioName = null;
      steps = [];
      inBackground = false;
    };

    for (const line of lines) {
      if (line.startsWith("#")) continue;
      if (line.startsWith("@"))  continue;   // scenario-level tags — ignored

      if (/^Feature:/i.test(line)) continue;

      if (/^Background:/i.test(line)) {
        flush();
        inBackground = true;
        continue;
      }

      if (/^Scenario(?: Outline)?:/i.test(line)) {
        flush();
        scenarioName = line.replace(/^Scenario(?: Outline)?:\s*/i, "").trim();
        continue;
      }

      if (STEP_KEYWORDS.test(line)) {
        const step = line.replace(STEP_KEYWORDS, "").trim();
        if (inBackground) { background.push(step); }
        else if (scenarioName) { steps.push(step); }
        continue;
      }

      // Examples table — skip for now
      if (/^Examples:/i.test(line) || line.startsWith("|")) continue;
    }

    flush();
    return results;
  }

  // ── Plain text ────────────────────────────────────────────────────────────

  private parsePlainText(content: string): RawTestCase[] {
    const results: RawTestCase[] = [];
    const blocks = content.split(/\n{2,}/); // split on blank lines

    let idx = 0;
    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      idx++;
      let name         = `Test Case ${idx}`;
      let precondition: string | undefined;
      let expected: string | undefined;
      const steps: string[] = [];

      for (const line of lines) {
        if (/^(Test|Test Case|Title|Name):\s*/i.test(line)) {
          name = line.replace(/^(Test|Test Case|Title|Name):\s*/i, "").trim();
        } else if (/^(Precondition|Pre-condition|Prerequisite):\s*/i.test(line)) {
          precondition = line.replace(/^(Precondition|Pre-condition|Prerequisite):\s*/i, "").trim();
        } else if (/^(Expected|Expected Result|Outcome):\s*/i.test(line)) {
          expected = line.replace(/^(Expected|Expected Result|Outcome):\s*/i, "").trim();
        } else if (/^Steps?:\s*$/i.test(line)) {
          // section header — skip
        } else if (/^\d+[.)]\s+/.test(line)) {
          steps.push(line.replace(/^\d+[.)]\s+/, "").trim());
        } else if (/^-\s+/.test(line)) {
          steps.push(line.replace(/^-\s+/, "").trim());
        } else {
          steps.push(line);
        }
      }

      if (steps.length > 0) {
        results.push({ id: `tc-${idx}`, name, precondition, steps, expected });
      }
    }

    return results;
  }
}
