jest.mock("../../src/importers/CSVImporter");
jest.mock("../../src/importers/ExcelImporter");
jest.mock("../../src/importers/TextImporter");
jest.mock("../../src/importers/TestCaseTranslator");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
  mkdirSync:     jest.fn(),
}));

import * as fs from "fs";
import { ImportOrchestrator }  from "../../src/importers/ImportOrchestrator";
import { CSVImporter }         from "../../src/importers/CSVImporter";
import { ExcelImporter }       from "../../src/importers/ExcelImporter";
import { TextImporter }        from "../../src/importers/TextImporter";
import { TestCaseTranslator }  from "../../src/importers/TestCaseTranslator";

const RAW_TC = { id: "1", name: "Login test", steps: ["navigate to https://example.com"] };

const VALID_YAML =
  `test:\n  name: "Login test"\n  tags: [imported]\n  steps:\n    - navigate: "https://example.com"\n`;

const VALID_RESULT   = { yaml: VALID_YAML, warnings: [],    validated: true  };
const INVALID_RESULT = {
  yaml:      `test:\n  name: "Vague"\n  tags: [imported]\n  steps:\n    # WARNING: vague\n`,
  warnings:  ["Could not map step: vague", "YAML validation failed: steps must be non-empty"],
  validated: false,
};

const stubImporter = (tcs = [RAW_TC]) => ({ import: jest.fn().mockResolvedValue(tcs) });

const wfMock  = fs.writeFileSync as jest.Mock;
const mdMock  = fs.mkdirSync    as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (TestCaseTranslator as jest.Mock).mockImplementation(() => ({
    translate: jest.fn().mockResolvedValue(VALID_RESULT),
  }));
});

describe("ImportOrchestrator — routing", () => {
  it("routes .csv to CSVImporter", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    expect(CSVImporter).toHaveBeenCalledTimes(1);
    expect(ExcelImporter).not.toHaveBeenCalled();
    expect(TextImporter).not.toHaveBeenCalled();
  });

  it("routes .xlsx to ExcelImporter", async () => {
    (ExcelImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("cases.xlsx", { outDir: "/tmp/out" });
    expect(ExcelImporter).toHaveBeenCalledTimes(1);
    expect(CSVImporter).not.toHaveBeenCalled();
  });

  it("routes .xls to ExcelImporter", async () => {
    (ExcelImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("cases.xls", { outDir: "/tmp/out" });
    expect(ExcelImporter).toHaveBeenCalledTimes(1);
  });

  it("routes .feature to TextImporter", async () => {
    (TextImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("tests.feature", { outDir: "/tmp/out" });
    expect(TextImporter).toHaveBeenCalledTimes(1);
    expect(CSVImporter).not.toHaveBeenCalled();
  });

  it("routes .txt to TextImporter", async () => {
    (TextImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("tests.txt", { outDir: "/tmp/out" });
    expect(TextImporter).toHaveBeenCalledTimes(1);
  });

  it("throws for unsupported file extension", async () => {
    await expect(
      new ImportOrchestrator().run("cases.docx", { outDir: "/tmp/out" }),
    ).rejects.toThrow("unsupported file type");
  });
});

describe("ImportOrchestrator — output", () => {
  it("writes one YAML file per test case with slugified name", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    expect(wfMock).toHaveBeenCalledTimes(1);
    const [writtenPath] = wfMock.mock.calls[0] as [string];
    expect(writtenPath).toMatch(/login_test\.yaml$/);
  });

  it("deduplicates identical slugs with a _2 suffix counter", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() =>
      stubImporter([RAW_TC, { ...RAW_TC, id: "2" }]),
    );
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    const paths = wfMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(paths[0]).toMatch(/login_test\.yaml$/);
    expect(paths[1]).toMatch(/login_test_2\.yaml$/);
  });

  it("returns ImportResult with validated=true and empty warnings on success", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    const [result] = await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    expect(result.validated).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.yamlPath).toMatch(/login_test\.yaml$/);
  });

  it("writes a .raw.txt file to failed/ for invalid translations", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    (TestCaseTranslator as jest.Mock).mockImplementation(() => ({
      translate: jest.fn().mockResolvedValue(INVALID_RESULT),
    }));
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    const paths = wfMock.mock.calls.map((c: unknown[]) => c[0] as string);
    const failedPath = paths.find(p => p.includes("failed"));
    expect(failedPath).toBeDefined();
    expect(failedPath).toMatch(/failed.*\.raw\.txt$/);
  });

  it("passes custom tags to the translator", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    const translateMock = jest.fn().mockResolvedValue(VALID_RESULT);
    (TestCaseTranslator as jest.Mock).mockImplementation(() => ({ translate: translateMock }));
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out", tags: ["smoke"] });
    expect(translateMock).toHaveBeenCalledWith(RAW_TC, ["smoke"]);
  });

  it("returns ImportResult with validated=false for invalid translation", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    (TestCaseTranslator as jest.Mock).mockImplementation(() => ({
      translate: jest.fn().mockResolvedValue(INVALID_RESULT),
    }));
    const [result] = await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    expect(result.validated).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("creates the output directory via mkdirSync", async () => {
    (CSVImporter as jest.Mock).mockImplementation(() => stubImporter());
    await new ImportOrchestrator().run("cases.csv", { outDir: "/tmp/out" });
    expect(mdMock).toHaveBeenCalledWith("/tmp/out", { recursive: true });
  });
});
