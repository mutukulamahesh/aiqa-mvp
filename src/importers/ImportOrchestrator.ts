import * as fs   from "fs";
import * as path from "path";
import { ExcelImporter }        from "./ExcelImporter";
import { CSVImporter }          from "./CSVImporter";
import { TextImporter }         from "./TextImporter";
import { TestCaseTranslator }   from "./TestCaseTranslator";
import { RawTestCase, ColumnMap, ImportResult } from "./types";

export interface OrchestratorOptions {
  outDir:     string;
  sheetName?: string;
  colMap?:    ColumnMap;
  tags?:      string[];
}

export class ImportOrchestrator {
  private readonly translator: TestCaseTranslator;

  constructor() {
    this.translator = new TestCaseTranslator();
  }

  async run(filePath: string, opts: OrchestratorOptions): Promise<ImportResult[]> {
    const rawCases = await this.load(filePath, opts);
    fs.mkdirSync(opts.outDir, { recursive: true });

    const results: ImportResult[] = [];
    const usedNames = new Set<string>();

    for (const tc of rawCases) {
      const translation = await this.translator.translate(tc, opts.tags ?? ["imported"]);

      // Deterministic slug — deduplicated with suffix counter
      const base = tc.name
        .replace(/[^a-z0-9]+/gi, "_")
        .toLowerCase()
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "test_case";

      let safeName = base;
      let counter  = 2;
      while (usedNames.has(safeName)) safeName = `${base}_${counter++}`;
      usedNames.add(safeName);

      const yamlPath = path.join(opts.outDir, `${safeName}.yaml`);
      fs.writeFileSync(yamlPath, translation.yaml, "utf-8");

      // Save raw source for invalid tests so users can fix manually
      if (!translation.validated) {
        const failedDir = path.join(opts.outDir, "failed");
        fs.mkdirSync(failedDir, { recursive: true });
        const rawLines = [
          `# Import validation failed — review and fix manually`,
          `# Source: ${filePath}`,
          ``,
          `name: ${tc.name}`,
          ...(tc.precondition ? [`precondition: ${tc.precondition}`] : []),
          `steps:`,
          ...tc.steps.map(s => `  - ${s}`),
          ...(tc.expected ? [`expected: ${tc.expected}`] : []),
        ];
        fs.writeFileSync(
          path.join(failedDir, `${safeName}.raw.txt`),
          rawLines.join("\n") + "\n",
          "utf-8",
        );
      }

      results.push({
        source:    filePath,
        testCase:  tc,
        yamlPath,
        warnings:  translation.warnings,
        validated: translation.validated,
      });
    }

    return results;
  }

  private async load(filePath: string, opts: OrchestratorOptions): Promise<RawTestCase[]> {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

    switch (ext) {
      case "xlsx":
      case "xls":
        return new ExcelImporter(opts.colMap).import(filePath, opts.sheetName);

      case "csv":
        return new CSVImporter(opts.colMap).import(filePath);

      case "feature":
      case "txt":
        return new TextImporter().import(filePath);

      default:
        throw new Error(
          `ImportOrchestrator: unsupported file type ".${ext}". ` +
          `Supported: .xlsx, .xls, .csv, .feature, .txt`
        );
    }
  }
}
