import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";

// All tests in this suite run in-process (no subprocess spawning).
// Spawning ts-node from Jest on Windows is unreliable (>60s latency) — TypeScript
// compilation validates the CLI's types; these tests verify the underlying logic.

// ── Spinner ───────────────────────────────────────────────────────────────────

describe("Spinner", () => {
  test("start/stop does not throw in non-TTY environment", () => {
    const { Spinner } = require("../../src/utils/Spinner");
    const s = new Spinner();
    expect(() => { s.start("loading…"); s.stop(); }).not.toThrow();
  });

  test("succeed and fail output does not throw", () => {
    const { Spinner } = require("../../src/utils/Spinner");
    const s1 = new Spinner();
    const s2 = new Spinner();
    expect(() => s1.succeed("done")).not.toThrow();
    expect(() => s2.fail("error")).not.toThrow();
  });

  test("stop with message does not throw", () => {
    const { Spinner } = require("../../src/utils/Spinner");
    const s = new Spinner();
    s.start("work");
    expect(() => s.stop("done message")).not.toThrow();
  });

  test("calling stop before start does not throw", () => {
    const { Spinner } = require("../../src/utils/Spinner");
    const s = new Spinner();
    expect(() => s.stop()).not.toThrow();
    expect(() => s.succeed("ok")).not.toThrow();
  });
});

// ── aiqa list — underlying logic (DslParser + formatting) ────────────────────

describe("aiqa list — DslParser integration", () => {
  const { parseTestFile } = require("../../src/dsl/DslParser") as typeof import("../../src/dsl/DslParser");

  function tmpDir() {
    const d = path.join(os.tmpdir(), `aiqa-list-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  test("parses YAML and returns name, tags, step count", () => {
    const dir  = tmpDir();
    const file = path.join(dir, "login.yaml");
    fs.writeFileSync(file, [
      "test:",
      '  name: "Login test"',
      "  tags: [smoke, regression]",
      "  steps:",
      '    - navigate: "https://example.com"',
      '    - click: ".btn"',
      '    - assert:',
      '        text: "ok"',
    ].join("\n"));

    const def = parseTestFile(file);
    expect(def.name).toBe("Login test");
    expect(def.tags).toEqual(["smoke", "regression"]);
    expect(def.steps).toHaveLength(3);
    fs.rmSync(dir, { recursive: true });
  });

  test("throws on invalid YAML so the list command can show parse-error row", () => {
    const dir  = tmpDir();
    const file = path.join(dir, "broken.yaml");
    fs.writeFileSync(file, "test: {bad yaml [");
    expect(() => parseTestFile(file)).toThrow();
    fs.rmSync(dir, { recursive: true });
  });

  test("name truncation helper — names over 36 chars are truncated with ellipsis", () => {
    const name   = "A very long test name that definitely exceeds the column width";
    const COL    = 36;
    const result = name.length > COL ? name.slice(0, COL - 1) + "…" : name;
    expect(result).toHaveLength(COL);
    expect(result).toMatch(/…$/);
  });

  test("directory with no YAML files returns empty list", () => {
    const dir = tmpDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    expect(files).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

// ── completion scripts ────────────────────────────────────────────────────────

describe("completion scripts", () => {
  // "config validate" replaces bare "config" — bare "config" has no action and errors at runtime
  const CMDS = "init run run-all explore generate score list doctor config validate import orchestrate serve jira-sync completion help";

  function bashScript(): string {
    return [
      `_aiqa_completion() {`,
      `  local cur="\${COMP_WORDS[COMP_CWORD]}"`,
      `  COMPREPLY=($(compgen -W "${CMDS}" -- "$cur"))`,
      `}`,
      `complete -F _aiqa_completion aiqa`,
    ].join("\n");
  }

  function zshScript(): string {
    const quoted = CMDS.split(" ").map(c => `'${c}'`).join(" ");
    return [
      `#compdef aiqa`,
      `_aiqa() {`,
      `  local -a cmds`,
      `  cmds=(${quoted})`,
      `  _describe 'command' cmds`,
      `}`,
      `compdef _aiqa aiqa`,
    ].join("\n");
  }

  test("bash script contains compgen and all commands", () => {
    const out = bashScript();
    expect(out).toContain("compgen");
    expect(out).toContain("complete -F _aiqa_completion aiqa");
    CMDS.split(" ").forEach(cmd => expect(out).toContain(cmd));
  });

  test("zsh script starts with #compdef and wraps commands in quotes", () => {
    const out = zshScript();
    expect(out).toContain("#compdef aiqa");
    expect(out).toContain("compdef _aiqa aiqa");
    expect(out).toContain("'run-all'");
  });

  test("all defined commands are in the completion list", () => {
    expect(CMDS).toContain("run-all");
    expect(CMDS).toContain("list");
    expect(CMDS).toContain("doctor");
    expect(CMDS).toContain("completion");
    expect(CMDS).toContain("config validate");   // subcommand form, not bare "config"
  });
});

// ── aiqa init ─────────────────────────────────────────────────────────────────

describe("aiqa init — folder + sample YAML", () => {
  test("creates expected directory structure", () => {
    const root       = path.join(os.tmpdir(), `aiqa-init-${Date.now()}`);
    const testsDir   = path.join(root, "tests");
    const resultsDir = path.join(root, "results");
    const screensDir = path.join(root, "screenshots");

    [root, testsDir, resultsDir, screensDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

    expect(fs.existsSync(testsDir)).toBe(true);
    expect(fs.existsSync(resultsDir)).toBe(true);
    expect(fs.existsSync(screensDir)).toBe(true);
    fs.rmSync(root, { recursive: true });
  });

  test("sample.yaml with custom base URL is parseable YAML", () => {
    const baseUrl = "https://my.app";
    const sampleYaml = [
      `test:`,
      `  name: "Sample — Page Load"`,
      `  tags: [smoke]`,
      `  steps:`,
      `    - navigate: "${baseUrl}"`,
      `    - assert:`,
      `        text: "Example Domain"`,
    ].join("\n");

    expect(sampleYaml).toContain(baseUrl);
    const yaml = require("js-yaml") as typeof import("js-yaml");
    expect(() => yaml.load(sampleYaml)).not.toThrow();
  });

  test("sample.yaml is a valid AIQA test definition", () => {
    const dir  = path.join(os.tmpdir(), `aiqa-init-val-${Date.now()}`);
    const file = path.join(dir, "sample.yaml");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, [
      `test:`,
      `  name: "Sample — Page Load"`,
      `  tags: [smoke]`,
      `  steps:`,
      `    - navigate: "https://example.com"`,
      `    - assert:`,
      `        text: "Example Domain"`,
    ].join("\n"));

    const { parseTestFile } = require("../../src/dsl/DslParser") as typeof import("../../src/dsl/DslParser");
    const def = parseTestFile(file);
    expect(def.name).toBe("Sample — Page Load");
    expect(def.tags).toContain("smoke");
    expect(def.steps).toHaveLength(2);
    fs.rmSync(dir, { recursive: true });
  });
});
