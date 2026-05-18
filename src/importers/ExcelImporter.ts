import * as ExcelJS from "exceljs";
import { RawTestCase, ColumnMap } from "./types";

const DEFAULT_COLUMNS: Required<ColumnMap> = {
  id:           "ID",
  name:         "Test Name",
  precondition: "Precondition",
  steps:        "Steps",
  expected:     "Expected Result",
};

export class ExcelImporter {
  constructor(private readonly colMap: ColumnMap = {}) {}

  async import(filePath: string, sheetName?: string): Promise<RawTestCase[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    const sheet = sheetName
      ? wb.getWorksheet(sheetName)
      : wb.worksheets[0];

    if (!sheet) {
      throw new Error(`ExcelImporter: sheet "${sheetName ?? "first sheet"}" not found in ${filePath}`);
    }

    const cols = { ...DEFAULT_COLUMNS, ...this.colMap };
    const headers = this.readHeaders(sheet);

    const idCol           = this.resolveCol(headers, [cols.id,           "ID", "Test ID", "TestID"]);
    const nameCol         = this.resolveCol(headers, [cols.name,         "Test Name", "Name", "Title", "Test Case"]);
    const preconditionCol = this.resolveCol(headers, [cols.precondition, "Precondition", "Pre-condition", "Prerequisite"]);
    const stepsCol        = this.resolveCol(headers, [cols.steps,        "Steps", "Test Steps", "Actions"]);
    const expectedCol     = this.resolveCol(headers, [cols.expected,     "Expected Result", "Expected", "Expected Outcome"]);

    if (!nameCol || !stepsCol) {
      throw new Error(
        `ExcelImporter: could not find required columns (name="${cols.name}", steps="${cols.steps}"). ` +
        `Found headers: [${Object.keys(headers).join(", ")}]`
      );
    }

    const results: RawTestCase[] = [];

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header row

      const name = this.cell(row, nameCol!);
      if (!name) return; // skip blank rows

      const rawSteps = this.cell(row, stepsCol!);
      const steps    = rawSteps
        ? rawSteps.split(/\n|;|\d+\.\s+/).map(s => s.trim()).filter(Boolean)
        : [];

      results.push({
        id:           this.cell(row, idCol)   || `row-${rowNum}`, // use actual row number, not insert count
        name,
        precondition: this.cell(row, preconditionCol) || undefined,
        steps,
        expected:     this.cell(row, expectedCol)     || undefined,
      });
    });

    return results;
  }

  private readHeaders(sheet: ExcelJS.Worksheet): Record<string, number> {
    const headers: Record<string, number> = {};
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell, colNum) => {
      const val = cell.text?.toString().trim();
      if (val) headers[val] = colNum;
    });
    return headers;
  }

  private resolveCol(headers: Record<string, number>, candidates: string[]): number | undefined {
    for (const candidate of candidates) {
      if (headers[candidate] !== undefined) return headers[candidate];
    }
    return undefined;
  }

  private cell(row: ExcelJS.Row, colNum: number | undefined): string {
    if (!colNum) return "";
    const cell = row.getCell(colNum);
    return cell.text?.toString().trim() ?? "";
  }
}
