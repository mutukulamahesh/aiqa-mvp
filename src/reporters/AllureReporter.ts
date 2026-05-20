import * as fs     from "fs";
import * as path   from "path";
import * as crypto from "crypto";
import { TestResult } from "../runner/TestRunner";

interface AllureResult {
  uuid:          string;
  historyId:     string;
  name:          string;
  status:        "passed" | "failed" | "broken" | "skipped";
  statusDetails: { message?: string; trace?: string };
  stage:         "finished";
  start:         number;
  stop:          number;
  labels:        { name: string; value: string }[];
  steps:         AllureStep[];
  attachments:   AllureAttachment[];
}

interface AllureStep {
  name:          string;
  status:        "passed" | "failed" | "broken";
  stage:         "finished";
  start:         number;
  stop:          number;
  statusDetails: { message?: string; trace?: string };
  attachments:   AllureAttachment[];
  parameters:    { name: string; value: string }[];
}

interface AllureAttachment {
  name:   string;
  source: string;
  type:   string;
}

function splitError(raw: string | undefined): { message?: string; trace?: string } {
  if (!raw) return {};
  const nl = raw.indexOf("\n");
  if (nl === -1) return { message: raw };
  return { message: raw.slice(0, nl), trace: raw.slice(nl + 1).trim() || undefined };
}

export class AllureReporter {
  /**
   * Writes one Allure JSON result file per test into `outputDir`.
   * Run `allure generate <outputDir> --clean -o allure-report` to get the HTML dashboard.
   */
  generate(results: TestResult[], outputDir: string): void {
    fs.mkdirSync(outputDir, { recursive: true });

    for (const result of results) {
      const uuid        = crypto.randomUUID();
      const historyId   = crypto.createHash("md5").update(result.testId).digest("hex");
      const testAttachments: AllureAttachment[] = [];

      // Copy all per-step screenshots into allure-results with stable names
      const screenshotMap = new Map<number, string>(); // stepIndex → allure filename
      for (const s of result.stepResults) {
        if (s.screenshotPath && fs.existsSync(s.screenshotPath)) {
          const attachName = `${uuid}-step-${s.index}.png`;
          fs.copyFileSync(s.screenshotPath, path.join(outputDir, attachName));
          screenshotMap.set(s.index, attachName);
        }
      }

      // Attach debug result as a JSON file on the test level
      if (result.debugResult) {
        const debugName = `${uuid}-debug.json`;
        fs.writeFileSync(
          path.join(outputDir, debugName),
          JSON.stringify(result.debugResult, null, 2),
          "utf-8",
        );
        testAttachments.push({ name: "Debug Analysis", source: debugName, type: "application/json" });
      }

      // Ensure every step has at least 1 ms so Allure timelines are non-zero.
      // Parent duration must wrap all children — take whichever is larger.
      const effectiveDurs = result.stepResults.map(s => Math.max(1, s.durationMs));
      const stepTotalMs   = effectiveDurs.reduce((a, b) => a + b, 0);
      const totalMs       = Math.max(result.durationMs > 0 ? result.durationMs : 0, stepTotalMs);
      const now   = Date.now();
      const stop  = now;
      const start = now - totalMs;

      // Build steps — screenshots attached at step level, debug JSON at test level
      let cursor = start;
      const steps: AllureStep[] = result.stepResults.map((s, i) => {
        const dur       = effectiveDurs[i];
        const stepStart = cursor;
        cursor += dur;

        const attachments: AllureAttachment[] = [];
        const screenshotFile = screenshotMap.get(s.index);
        if (screenshotFile) {
          attachments.push({ name: "Screenshot", source: screenshotFile, type: "image/png" });
        }

        // "broken" = unexpected exception; "failed" = assertion failure
        const stepStatus: AllureStep["status"] = s.passed
          ? "passed"
          : s.errorClass === "AssertionError" ? "failed" : "broken";

        const parameters: { name: string; value: string }[] = [];
        if (s.errorClass) parameters.push({ name: "errorClass", value: s.errorClass });

        return {
          name:          `${s.index + 1}. ${s.action}`,
          status:        stepStatus,
          stage:         "finished",
          start:         stepStart,
          stop:          stepStart + dur,
          statusDetails: s.error
            ? { message: s.error, trace: s.errorClass ?? undefined }
            : {},
          attachments,
          parameters,
        };
      });

      const labels: AllureResult["labels"] = [
        { name: "framework", value: "AIQA" },
        { name: "language",  value: "TypeScript" },
      ];
      for (const tag of (result.tags ?? [])) {
        labels.push({ name: "tag", value: tag });
      }
      if (result.debugResult?.failure_class) {
        labels.push({ name: "failureClass", value: result.debugResult.failure_class });
      }

      // Derive test-level broken/failed: broken = all failures are non-assertion errors
      const testStatus: AllureResult["status"] = result.passed
        ? "passed"
        : result.stepResults.some(s => !s.passed && s.errorClass === "AssertionError")
          ? "failed"
          : "broken";

      const allure: AllureResult = {
        uuid,
        historyId,
        name:          result.testName,
        status:        testStatus,
        statusDetails: splitError(result.error),
        stage:         "finished",
        start,
        stop,
        labels,
        steps,
        attachments:   testAttachments,
      };

      fs.writeFileSync(
        path.join(outputDir, `${uuid}-result.json`),
        JSON.stringify(allure, null, 2),
        "utf-8",
      );
    }
  }
}
