import * as fs   from "fs";
import * as readline from "readline";
import { RawTestCase, ColumnMap } from "./types";

const DEFAULT_COLUMNS: Required<ColumnMap> = {
  id:           "ID",
  name:         "Test Name",
  precondition: "Precondition",
  steps:        "Steps",
  expected:     "Expected Result",
};

export class CSVImporter {
  constructor(private readonly colMap: ColumnMap = {}) {}

  async import(filePath: string): Promise<RawTestCase[]> {
    const lines = await this.readLines(filePath);
    if (lines.length < 2) return [];

    const cols    = { ...DEFAULT_COLUMNS, ...this.colMap };
    const headers = this.parseRow(lines[0]);

    const idIdx           = this.resolveIdx(headers, [cols.id,           "ID", "Test ID", "TestID"]);
    const nameIdx         = this.resolveIdx(headers, [cols.name,         "Test Name", "Name", "Title", "Test Case"]);
    const preconditionIdx = this.resolveIdx(headers, [cols.precondition, "Precondition", "Pre-condition"]);
    const stepsIdx        = this.resolveIdx(headers, [cols.steps,        "Steps", "Test Steps", "Actions"]);
    const expectedIdx     = this.resolveIdx(headers, [cols.expected,     "Expected Result", "Expected"]);

    if (nameIdx === -1 || stepsIdx === -1) {
      throw new Error(
        `CSVImporter: could not find required columns. ` +
        `Found headers: [${headers.join(", ")}]`
      );
    }

    const results: RawTestCase[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row  = this.parseRow(lines[i]);
      const name = row[nameIdx]?.trim();
      if (!name) continue;

      const rawSteps = row[stepsIdx] ?? "";
      const steps    = rawSteps
        .split(/\n|;|\d+\.\s+/)
        .map(s => s.trim())
        .filter(Boolean);

      results.push({
        id:           idIdx !== -1 ? (row[idIdx]?.trim() || `row-${i}`) : `row-${i}`,
        name,
        precondition: preconditionIdx !== -1 ? row[preconditionIdx]?.trim() || undefined : undefined,
        steps,
        expected:     expectedIdx    !== -1 ? row[expectedIdx]?.trim()    || undefined : undefined,
      });
    }

    return results;
  }

  private parseRow(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current);
    return values;
  }

  private resolveIdx(headers: string[], candidates: string[]): number {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.trim() === c);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  private readLines(filePath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const rl = readline.createInterface({
        input:     fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });
      rl.on("line",  line  => lines.push(line));
      rl.on("close", ()    => resolve(lines));
      rl.on("error", (err) => reject(err));
    });
  }
}
