jest.mock("exceljs", () => ({ Workbook: jest.fn() }));

import * as ExcelJS from "exceljs";
import { ExcelImporter } from "../../src/importers/ExcelImporter";

type CellMap = (string | undefined)[];

function makeSheet(headers: string[], rows: CellMap[]) {
  const headerRow = {
    eachCell: (cb: (cell: { text: string }, col: number) => void) =>
      headers.forEach((h, i) => cb({ text: h }, i + 1)),
  };
  const dataRows = rows.map(cells => ({
    getCell: (col: number): { text: string } => ({ text: cells[col - 1] ?? "" }),
  }));
  return {
    getRow: (rowNum: number) =>
      rowNum === 1 ? headerRow : (dataRows[rowNum - 2] ?? { getCell: () => ({ text: "" }) }),
    eachRow: (cb: (row: any, rowNum: number) => void) => {
      cb(headerRow, 1);
      dataRows.forEach((r, i) => cb(r, i + 2));
    },
  };
}

function mockWorkbook(sheets: Record<string, ReturnType<typeof makeSheet>>) {
  (ExcelJS.Workbook as jest.Mock).mockImplementation(() => ({
    xlsx: { readFile: jest.fn().mockResolvedValue(undefined) },
    worksheets: Object.values(sheets),
    getWorksheet: (name: string) => sheets[name] ?? undefined,
  }));
}

beforeEach(() => jest.clearAllMocks());

describe("ExcelImporter", () => {
  it("reads from first sheet when no sheetName given", async () => {
    mockWorkbook({ Sheet1: makeSheet(["Test Name", "Steps"], [["Login", "Open site;Click submit"]]) });
    const [tc] = await new ExcelImporter().import("fake.xlsx");
    expect(tc.name).toBe("Login");
    expect(tc.steps).toEqual(["Open site", "Click submit"]);
  });

  it("selects a named sheet", async () => {
    mockWorkbook({
      SheetA: makeSheet(["Test Name", "Steps"], [["TC-A", "Step A"]]),
      SheetB: makeSheet(["Test Name", "Steps"], [["TC-B", "Step B"]]),
    });
    const [tc] = await new ExcelImporter().import("fake.xlsx", "SheetB");
    expect(tc.name).toBe("TC-B");
  });

  it("auto-detects headers using fallback names", async () => {
    mockWorkbook({
      Sheet1: makeSheet(
        ["Name", "Actions", "Expected"],
        [["Checkout", "Add to cart;Pay", "Order created"]],
      ),
    });
    const [tc] = await new ExcelImporter().import("fake.xlsx");
    expect(tc.name).toBe("Checkout");
    expect(tc.steps).toEqual(["Add to cart", "Pay"]);
    expect(tc.expected).toBe("Order created");
  });

  it("skips rows with empty name cell", async () => {
    mockWorkbook({
      Sheet1: makeSheet(["Test Name", "Steps"], [["Valid", "Step one"], ["", "Orphan step"]]),
    });
    const results = await new ExcelImporter().import("fake.xlsx");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Valid");
  });

  it("throws when required columns are missing", async () => {
    mockWorkbook({ Sheet1: makeSheet(["ID", "Description"], [["1", "Something"]]) });
    await expect(new ExcelImporter().import("fake.xlsx")).rejects.toThrow("could not find required columns");
  });

  it("throws when a named sheet does not exist", async () => {
    mockWorkbook({ Sheet1: makeSheet(["Test Name", "Steps"], []) });
    await expect(new ExcelImporter().import("fake.xlsx", "Missing")).rejects.toThrow("sheet");
  });

  it("applies custom colMap to override header matching", async () => {
    mockWorkbook({ Sheet1: makeSheet(["Case", "StepList"], [["Register", "Fill form;Submit"]]) });
    const [tc] = await new ExcelImporter({ name: "Case", steps: "StepList" }).import("fake.xlsx");
    expect(tc.name).toBe("Register");
    expect(tc.steps).toEqual(["Fill form", "Submit"]);
  });

  it("assigns auto-id from row index when ID column is absent", async () => {
    mockWorkbook({ Sheet1: makeSheet(["Test Name", "Steps"], [["My test", "Step"]]) });
    const [tc] = await new ExcelImporter().import("fake.xlsx");
    expect(tc.id).toBe("row-1");
  });
});
