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

      const now   = Date.now();
      const stop  = now;
      const start = now - result.durationMs;

      // Build steps with accurate timing, error details, and screenshot attachments
      let cursor = start;
      const steps: AllureStep[] = result.stepResults.map(s => {
        const stepStart = cursor;
        cursor += s.durationMs;

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
          stop:          stepStart + s.durationMs,
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

      const allure: AllureResult = {
        uuid,
        historyId,
        name:          result.testName,
        status:        result.passed ? "passed" : "failed",
        statusDetails: result.error ? { message: result.error } : {},
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
