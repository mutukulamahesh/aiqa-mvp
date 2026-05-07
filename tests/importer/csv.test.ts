import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CSVImporter } from "../../src/importers/CSVImporter";

let tmpFile = "";

const writeTmp = (content: string): void => {
  tmpFile = path.join(os.tmpdir(), `aiqa-csv-${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, content, "utf-8");
};

afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  tmpFile = "";
});

describe("CSVImporter", () => {
  it("parses standard header row and one data row", async () => {
    writeTmp("Test Name,Steps,Expected Result\nLogin test,Open site;Click login,Dashboard shown");
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.name).toBe("Login test");
    expect(tc.expected).toBe("Dashboard shown");
  });

  it("splits steps by semicolon", async () => {
    writeTmp("Test Name,Steps\nMulti step,A;B;C");
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.steps).toEqual(["A", "B", "C"]);
  });

  it("splits steps by numbered-list pattern (1. 2.)", async () => {
    writeTmp("Test Name,Steps\nNumbered,1. Open app 2. Click submit");
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.steps).toContain("Open app");
    expect(tc.steps).toContain("Click submit");
  });

  it("skips rows with empty name cell", async () => {
    writeTmp("Test Name,Steps\nReal test,Step one\n,Step two\n,");
    const results = await new CSVImporter().import(tmpFile);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Real test");
  });

  it("returns empty array for header-only file", async () => {
    writeTmp("Test Name,Steps");
    expect(await new CSVImporter().import(tmpFile)).toHaveLength(0);
  });

  it("throws when required columns are absent", async () => {
    writeTmp("ID,Description\n1,Something unrelated");
    await expect(new CSVImporter().import(tmpFile)).rejects.toThrow("could not find required columns");
  });

  it("handles quoted values containing commas", async () => {
    writeTmp(`Test Name,Steps\n"Login, retry","Enter email,Click submit"`);
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.name).toBe("Login, retry");
    expect(tc.steps[0]).toBe("Enter email,Click submit");
  });

  it("resolves custom column names via colMap", async () => {
    writeTmp("TestName,TestSteps\nCustom test,Do step A");
    const [tc] = await new CSVImporter({ name: "TestName", steps: "TestSteps" }).import(tmpFile);
    expect(tc.name).toBe("Custom test");
    expect(tc.steps).toEqual(["Do step A"]);
  });

  it("assigns auto-id when ID column is absent", async () => {
    writeTmp("Test Name,Steps\nAuto test,Step one");
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.id).toBe("row-1");
  });

  it("parses precondition and expected columns when present", async () => {
    writeTmp("Test Name,Precondition,Steps,Expected Result\nTC1,User logged in,Click profile,Profile page shown");
    const [tc] = await new CSVImporter().import(tmpFile);
    expect(tc.precondition).toBe("User logged in");
    expect(tc.expected).toBe("Profile page shown");
  });
});
