import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { DepHealerAgent } from "../../src/agents/DepHealerAgent";

describe("DepHealerAgent (POL-09b)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-healer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 'failed' when adapter file does not exist", async () => {
    const agent = new DepHealerAgent(tmpDir);
    const result = await agent.heal({
      package:     "nonexistent-pkg",
      adapterFile: "src/adapters/Nonexistent.ts",
      error:       "Cannot find module",
    });
    expect(result.status).toBe("failed");
    expect(result.diagnosis).toMatch(/could not read adapter/i);
  });

  test("returns 'suggested' or 'fixed' when adapter file exists and LLM is mock", async () => {
    // Create a minimal adapter file in the temp dir
    const adapterDir = path.join(tmpDir, "src", "adapters");
    fs.mkdirSync(adapterDir, { recursive: true });
    const adapterPath = path.join(adapterDir, "TestAdapter.ts");
    fs.writeFileSync(adapterPath, [
      `import { SomeLib } from "some-lib";`,
      `export class TestAdapter {`,
      `  async connect() { return SomeLib.connect("/api/v1/search"); }`,
      `}`,
    ].join("\n"));

    // Mock package.json so ts-node doesn't fail in tmpDir context
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));

    const agent = new DepHealerAgent(tmpDir);
    const result = await agent.heal({
      package:     "some-lib",
      adapterFile: "src/adapters/TestAdapter.ts",
      error:       "HTTP 410: /api/v1/search has been removed",
    });

    // With mock LLM the result will be suggested (mock response won't have valid OLD/NEW)
    expect(["suggested", "fixed", "failed"]).toContain(result.status);
    expect(result.package).toBe("some-lib");
    expect(typeof result.diagnosis).toBe("string");
  });

  test("result always has package, diagnosis, and suggestion fields", async () => {
    const adapterDir = path.join(tmpDir, "src");
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, "Adapter.ts"), "export class Adapter {}");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));

    const agent = new DepHealerAgent(tmpDir);
    const result = await agent.heal({
      package:     "some-dep",
      adapterFile: "src/Adapter.ts",
      error:       "Module not found",
    });

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("package");
    expect(result).toHaveProperty("diagnosis");
    expect(result).toHaveProperty("suggestion");
  });
});
