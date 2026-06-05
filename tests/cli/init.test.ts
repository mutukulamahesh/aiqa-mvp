import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import * as yaml from "js-yaml";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CLI          = path.join(PROJECT_ROOT, "src", "cli.ts");

function runInit(projectDir: string, extraArgs = ""): { stdout: string; stderr: string; code: number } {
  // Always run from project root so ts-node + node_modules are available.
  // Pass absolute path as the project arg so init writes to a temp dir.
  try {
    const stdout = execSync(
      `npx ts-node "${CLI}" init "${projectDir}" ${extraArgs}`,
      { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

describe("aiqa init (POL-01)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiqa-init-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates all expected files", () => {
    const result = runInit(tmpDir, "--base-url https://example.com");
    expect(result.code).toBe(0);

    expect(fs.existsSync(path.join(tmpDir, "tests", "smoke.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "config", "environments", "dev.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "results"))).toBe(true);
  });

  test("generated dev.yaml passes Zod validation — all required fields present (C1 fix)", () => {
    runInit(tmpDir, "--base-url https://example.com");
    const raw = yaml.load(
      fs.readFileSync(path.join(tmpDir, "config", "environments", "dev.yaml"), "utf-8")
    ) as Record<string, unknown>;

    const exec = raw.execution as Record<string, unknown>;
    expect(typeof exec.maxPages).toBe("number");
    expect(typeof exec.maxDepth).toBe("number");
    expect(typeof exec.circuitBreaker).toBe("number");

    const features = raw.features as Record<string, unknown>;
    expect(typeof features.llmEnabled).toBe("boolean");
  });

  test("smoke.yaml uses hostname (not full URL) in assert step (M1 fix verification)", () => {
    runInit(tmpDir, "--base-url https://saucedemo.com");
    const smoke = fs.readFileSync(path.join(tmpDir, "tests", "smoke.yaml"), "utf-8");
    expect(smoke).toContain("saucedemo.com");
    // hostname only — not the full URL with protocol
    expect(smoke).not.toMatch(/assert:\s*\n\s*url: "https:\/\//);
  });

  test("dev.yaml contains the --base-url value", () => {
    runInit(tmpDir, "--base-url https://myapp.io");
    const devYaml = fs.readFileSync(
      path.join(tmpDir, "config", "environments", "dev.yaml"), "utf-8"
    );
    expect(devYaml).toContain("https://myapp.io");
  });

  test("idempotency — re-running does not overwrite existing smoke.yaml (M2 fix)", () => {
    runInit(tmpDir, "--base-url https://example.com");

    const smokePath = path.join(tmpDir, "tests", "smoke.yaml");
    fs.writeFileSync(smokePath, "# custom content");

    runInit(tmpDir, "--base-url https://example.com");
    expect(fs.readFileSync(smokePath, "utf-8")).toBe("# custom content");
  });

  test("idempotency — re-running does not overwrite existing dev.yaml (M2 fix)", () => {
    runInit(tmpDir, "--base-url https://example.com");

    const devPath = path.join(tmpDir, "config", "environments", "dev.yaml");
    fs.writeFileSync(devPath, "# custom config");

    runInit(tmpDir, "--base-url https://example.com");
    expect(fs.readFileSync(devPath, "utf-8")).toBe("# custom config");
  });

  test("invalid --base-url exits with readable error (M1 fix)", () => {
    const result = runInit(tmpDir, "--base-url notaurl");
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/invalid.*base-url|must be a full URL/i);
  });

  test("missing protocol in --base-url exits with readable error (M1 fix)", () => {
    const result = runInit(tmpDir, "--base-url myapp.com");
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/invalid.*base-url|must be a full URL/i);
  });
});
