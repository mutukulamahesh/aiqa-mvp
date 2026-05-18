import * as path from "path";
import { TestDefinition } from "../dsl/types";

/**
 * Determines whether a test is impacted by a set of changed files.
 *
 * Three strategies are applied in priority order:
 *
 * 1. Explicit — test YAML declares `filesUnderTest: [src/auth/login.ts]`.
 *    Exact match wins; partial suffix match also accepted so tests can use
 *    short paths like `auth/login.ts` that still match `src/auth/login.ts`.
 *
 * 2. Tag heuristic — each tag is compared against the path segments of every
 *    changed file.  A test tagged `auth` is impacted when `src/auth/login.ts`
 *    changes because "auth" appears as a directory segment.
 *
 * 3. Name heuristic — words (≥ 4 chars) extracted from the test name are
 *    compared against changed-file paths (lowercase substring).  Catches common
 *    cases like "Login smoke" matching `src/auth/login.ts`.
 *
 * Conservative rule: on parse error the test is *included* (never silently
 * skipped).  Prefer false positives over false negatives — better to run an
 * extra test than miss a regression.
 */
export class ImpactMapper {
  /**
   * Returns true if the given test is affected by any of the changed files.
   */
  isImpacted(testDef: TestDefinition, changedFiles: string[]): boolean {
    if (changedFiles.length === 0) return false;

    const normalized = changedFiles.map(f => normalizePath(f));

    // Strategy 1: explicit filesUnderTest
    if (testDef.filesUnderTest?.length) {
      return testDef.filesUnderTest.some(declared => {
        const d = normalizePath(declared);
        return normalized.some(c => c === d || c.endsWith("/" + d));
      });
    }

    // Strategy 2: tag-based path segment match.
    // If tags are declared, they are authoritative — no fallthrough to name heuristic.
    if (testDef.tags?.length) {
      const tags = testDef.tags.map(t => t.toLowerCase().trim());
      return tags.some(tag => normalized.some(f => pathSegments(f).includes(tag)));
    }

    // Strategy 3: name-word heuristic — only for tests with neither filesUnderTest nor tags.
    // Words ≥ 4 chars to reduce noise from short common words.
    const nameWords = words(testDef.name).filter(w => w.length >= 4);
    return nameWords.some(w => normalized.some(f => f.includes(w)));
  }

  /**
   * Filters a list of test file paths down to those impacted by changedFiles.
   * Calls parseTest() for each; includes the file on parse error (conservative).
   *
   * @param testFiles  absolute or relative paths to YAML test files
   * @param changedFiles  git-reported changed file paths (relative to git root)
   * @param parseTest  function that parses a YAML file → TestDefinition
   * @param gitRoot    git repo root, used to resolve testFiles relative to it when comparing
   */
  filterTests(
    testFiles:    string[],
    changedFiles: string[],
    parseTest:    (f: string) => TestDefinition,
    gitRoot?:     string,
  ): string[] {
    return testFiles.filter(f => {
      let def: TestDefinition;
      try {
        def = parseTest(f);
      } catch {
        return true; // conservative: include on parse error
      }

      // If the test YAML file itself is among the changed files, always include it
      const relPath = gitRoot
        ? normalizePath(path.relative(gitRoot, path.resolve(f)))
        : normalizePath(f);
      if (changedFiles.some(c => normalizePath(c) === relPath)) return true;

      return this.isImpacted(def, changedFiles);
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function pathSegments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function words(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(Boolean);
}
