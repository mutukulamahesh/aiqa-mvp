#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { parseTestFile } from "./dsl/DslParser";
import { TestRunner } from "./runner/TestRunner";
import { AppExplorer } from "./agents/AppExplorer";
import { FlowMapper } from "./agents/FlowMapper";
import { ScenarioGenerator } from "./agents/ScenarioGenerator";
import { ReadinessScorer } from "./agents/ReadinessScorer";
import { JiraAdapter } from "./integrations/JiraAdapter";
import { HTMLReporter } from "./reporters/HTMLReporter";

const program = new Command();

program
  .name("aiqa")
  .description("Enterprise AI QA Platform — MVP")
  .version("1.0.0");

// ── helpers ───────────────────────────────────────────────────────────────────

function runTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveResults(results: unknown[], dir: string): string {
  ensureDir(dir);
  const filePath = path.join(dir, `run-${runTimestamp()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
  return filePath;
}

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command("init <project>")
  .description("Create a new AIQA project workspace with folder structure and a sample test")
  .action((project: string) => {
    const root        = path.resolve(process.cwd(), project);
    const testsDir    = path.join(root, "tests");
    const resultsDir  = path.join(root, "results");
    const screensDir  = path.join(root, "screenshots");

    [root, testsDir, resultsDir, screensDir].forEach(ensureDir);

    const sampleYaml = [
      `test:`,
      `  name: "Sample — Page Load"`,
      `  steps:`,
      `    - navigate: "https://example.com"`,
      `    - assert:`,
      `        text: "Example Domain"`,
      ``,
    ].join("\n");

    const samplePath = path.join(testsDir, "sample.yaml");
    fs.writeFileSync(samplePath, sampleYaml);

    console.log(`\n✅ Project created: ${root}`);
    console.log(`   ${project}/tests/         ← put your YAML test files here`);
    console.log(`   ${project}/results/        ← run results and HTML reports saved here`);
    console.log(`   ${project}/screenshots/    ← failure screenshots saved here`);
    console.log(`   ${project}/tests/sample.yaml  ← starter test`);
    console.log(`\nNext steps:`);
    console.log(`   aiqa explore <url> --out ${project}`);
    console.log(`   aiqa generate --out ${project} --per-page`);
    console.log(`   aiqa run-all --out ${project} --headless`);
    console.log();
  });

// ── run ───────────────────────────────────────────────────────────────────────

program
  .command("run <file>")
  .description("Run a single DSL test file")
  .option("--headless", "Run browser in headless mode", false)
  .option("--out <folder>", "Project folder — saves screenshots, results JSON, and HTML report here")
  .option("--report <file>", "Explicit HTML report output path (overrides --out)")
  .action(async (file: string, opts: { headless: boolean; out?: string; report?: string }) => {
    const testFilePath = path.resolve(process.cwd(), file);
    const outRoot      = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;

    console.log(`\n🚀 AIQA Runner`);
    console.log(`   File    : ${testFilePath}`);
    console.log(`   Headless: ${opts.headless}`);
    if (outRoot) console.log(`   Out     : ${outRoot}`);
    console.log(`─────────────────────────────────────────\n`);

    let testDef;
    try {
      testDef = parseTestFile(testFilePath);
    } catch (err) {
      console.error(`❌ Failed to parse test file: ${(err as Error).message}`);
      process.exit(1);
    }

    const runner = new TestRunner({
      headless: opts.headless,
      screenshotsDir: outRoot ? path.join(outRoot, "screenshots") : undefined,
    });
    const result = await runner.run(testDef);

    console.log(`\n─────────────────────────────────────────`);
    if (result.passed) {
      console.log(`✅ Test passed: "${result.testName}" (${result.durationMs}ms)`);
    } else {
      console.log(`❌ Test FAILED: "${result.testName}"`);
      console.log(`   Reason: ${result.error}`);
    }
    console.log(`─────────────────────────────────────────`);

    if (outRoot) {
      const resultsDir = path.join(outRoot, "results");
      const jsonPath   = saveResults([result], resultsDir);
      const reportPath = opts.report
        ? path.resolve(process.cwd(), opts.report)
        : path.join(resultsDir, "report.html");
      new HTMLReporter().generate([result], reportPath);
      console.log(`   JSON    → ${jsonPath}`);
      console.log(`   HTML    → ${reportPath}`);
    } else if (opts.report) {
      const reportPath = path.resolve(process.cwd(), opts.report);
      new HTMLReporter().generate([result], reportPath);
      console.log(`   HTML    → ${reportPath}`);
    }
    console.log();

    process.exit(result.passed ? 0 : 1);
  });

// ── explore ───────────────────────────────────────────────────────────────────

program
  .command("explore <url>")
  .description("Crawl an application and save a structured page map to JSON")
  .option("--max-pages <n>", "Maximum pages to crawl", "10")
  .option("--out <folder>",  "Project folder — saves exploration.json inside it")
  .option("--output <file>", "Explicit output file path (overrides --out)")
  .action(async (url: string, opts: { maxPages: string; out?: string; output?: string }) => {
    const outPath = opts.output
      ? path.resolve(process.cwd(), opts.output)
      : opts.out
        ? path.join(path.resolve(process.cwd(), opts.out), "exploration.json")
        : path.resolve(process.cwd(), "exploration.json");

    console.log(`\n🔍 AIQA Explorer`);
    console.log(`   URL      : ${url}`);
    console.log(`   Max pages: ${opts.maxPages}`);
    console.log(`─────────────────────────────────────────\n`);

    const explorer = new AppExplorer();
    try {
      const result = await explorer.explore(url, {
        headless: true,
        maxPages: parseInt(opts.maxPages, 10),
      });

      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

      console.log(`\n─────────────────────────────────────────`);
      console.log(`✅ Explored ${result.totalPages} page(s), ${result.totalLinks} internal link(s)`);
      result.pages.forEach(p => console.log(`   • ${p.url} — ${p.title}`));
      console.log(`\n   Saved → ${outPath}`);
      console.log(`─────────────────────────────────────────\n`);
    } catch (err) {
      console.error(`❌ Exploration failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── generate ──────────────────────────────────────────────────────────────────

program
  .command("generate [exploration]")
  .description("Generate YAML test scenarios from an exploration JSON file")
  .option("--out <folder>",    "Project folder — reads <folder>/exploration.json, writes to <folder>/tests/")
  .option("--output <dir>",    "Explicit output directory for generated YAML files")
  .option("--jira <projectKey>", "Also pull stories from Jira (mock) and generate scenarios")
  .option("--per-page",        "Generate one test file per discovered page instead of per flow")
  .action(async (exploration: string | undefined, opts: { out?: string; output?: string; jira?: string; perPage?: boolean }) => {
    const outRoot = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;

    const explorationFile = exploration
      ? path.resolve(process.cwd(), exploration)
      : outRoot
        ? path.join(outRoot, "exploration.json")
        : null;

    if (!explorationFile) {
      console.error("❌ Provide an exploration file or use --out <project-folder>");
      process.exit(1);
    }

    const outDir = opts.output
      ? path.resolve(process.cwd(), opts.output)
      : outRoot
        ? path.join(outRoot, "tests")
        : path.resolve(process.cwd(), "generated");

    console.log(`\n⚙️  AIQA Generator`);
    console.log(`   Input : ${explorationFile}`);
    console.log(`   Output: ${outDir}/`);
    console.log(`─────────────────────────────────────────\n`);

    let exploration_data;
    try {
      const raw = fs.readFileSync(explorationFile, "utf-8");
      exploration_data = JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Could not read exploration file: ${(err as Error).message}`);
      process.exit(1);
    }

    const mapper    = new FlowMapper();
    const generator = new ScenarioGenerator();

    let flows = opts.perPage
      ? mapper.perPageFlows(exploration_data)
      : await mapper.map(exploration_data);

    if (opts.jira) {
      console.log(`   Pulling Jira stories for project: ${opts.jira}`);
      const jira      = new JiraAdapter({ useMock: true });
      const stories   = await jira.fetchStories(opts.jira);
      const jiraFlows = await jira.convertToFlows(stories);
      flows = [...flows, ...jiraFlows];
      console.log(`   Added ${jiraFlows.length} flow(s) from Jira\n`);
    }

    const scenarios = await generator.generate(flows, exploration_data.baseUrl ?? "");

    ensureDir(outDir);
    scenarios.forEach(s => {
      const filePath = path.join(outDir, `${s.fileName}.yaml`);
      fs.writeFileSync(filePath, s.yaml);
      console.log(`   ✔ ${s.fileName}.yaml  [${s.flowType}]`);
    });

    console.log(`\n─────────────────────────────────────────`);
    console.log(`✅ Generated ${scenarios.length} scenario(s) → ${outDir}/`);
    console.log(`   Run them with: aiqa run-all --out ${opts.out ?? outDir} --headless`);
    console.log(`─────────────────────────────────────────\n`);
  });

// ── score ─────────────────────────────────────────────────────────────────────

program
  .command("score <results>")
  .description("Compute a readiness score from a saved test results JSON file")
  .action((resultsFile: string) => {
    let data;
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), resultsFile), "utf-8");
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Could not read results file: ${(err as Error).message}`);
      process.exit(1);
    }

    const results = Array.isArray(data) ? data : [data];
    const scorer  = new ReadinessScorer();
    const report  = scorer.score(results);

    console.log(`\n📊 Readiness Report`);
    console.log(`─────────────────────────────────────────`);
    console.log(`   Score   : ${report.score}/100  (${report.grade})`);
    console.log(`   Tests   : ${report.passed}/${report.totalTests} passed  (${report.passRatePct}%)`);
    console.log(`   Coverage: ${report.coverageLayers.join(", ") || "none"}`);
    if (report.topIssues.length > 0) {
      console.log(`   Issues  : ${report.topIssues.join(", ")}`);
    }
    console.log(`\n   ${report.recommendation}`);
    console.log(`─────────────────────────────────────────\n`);
  });

// ── run-all ───────────────────────────────────────────────────────────────────

program
  .command("run-all [dir]")
  .description("Run every YAML test file in a directory and generate an HTML report")
  .option("--headless",        "Run browser in headless mode", false)
  .option("--out <folder>",    "Project folder — runs <folder>/tests/, saves results to <folder>/results/")
  .option("--report <file>",   "Explicit HTML report output path (overrides --out)")
  .option("--results <file>",  "Explicit JSON results output path (overrides --out)")
  .option("--base-url <url>",  "Base URL shown in the report header")
  .action(async (dir: string | undefined, opts: {
    headless: boolean; out?: string; report?: string; results?: string; baseUrl?: string;
  }) => {
    const outRoot = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;

    const testsDir = dir
      ? path.resolve(process.cwd(), dir)
      : outRoot
        ? path.join(outRoot, "tests")
        : null;

    if (!testsDir) {
      console.error("❌ Provide a test directory or use --out <project-folder>");
      process.exit(1);
    }

    if (!fs.existsSync(testsDir)) {
      console.error(`❌ Directory not found: ${testsDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(testsDir)
      .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map(f => path.join(testsDir, f));

    if (files.length === 0) {
      console.error(`❌ No YAML files found in ${testsDir}`);
      process.exit(1);
    }

    const screenshotsDir = outRoot ? path.join(outRoot, "screenshots") : undefined;

    console.log(`\n🚀 AIQA Run-All`);
    console.log(`   Directory: ${testsDir}`);
    console.log(`   Files    : ${files.length}`);
    console.log(`   Headless : ${opts.headless}`);
    if (outRoot) console.log(`   Out      : ${outRoot}`);
    console.log(`─────────────────────────────────────────\n`);

    const runner     = new TestRunner({ headless: opts.headless, screenshotsDir });
    const allResults = [];
    let passed = 0;

    for (const file of files) {
      let testDef;
      try {
        testDef = parseTestFile(file);
      } catch (err) {
        console.error(`  ⚠️  Skipped ${path.basename(file)}: ${(err as Error).message}`);
        continue;
      }
      const result = await runner.run(testDef);
      allResults.push(result);
      if (result.passed) passed++;
      console.log();
    }

    const failed = allResults.length - passed;
    console.log(`─────────────────────────────────────────`);
    console.log(`   Ran   : ${allResults.length} test(s)`);
    console.log(`   Passed: ${passed}   Failed: ${failed}`);

    const resultsDir   = outRoot ? path.join(outRoot, "results") : undefined;
    const jsonPath     = opts.results
      ? path.resolve(process.cwd(), opts.results)
      : resultsDir
        ? saveResults(allResults, resultsDir)
        : null;
    if (jsonPath && !opts.results) {
      console.log(`   JSON  → ${jsonPath}`);
    } else if (opts.results && jsonPath) {
      const dir2 = path.dirname(jsonPath);
      ensureDir(dir2);
      fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
      console.log(`   JSON  → ${jsonPath}`);
    }

    const reportPath = opts.report
      ? path.resolve(process.cwd(), opts.report)
      : resultsDir
        ? path.join(resultsDir, "report.html")
        : path.resolve(process.cwd(), "report/index.html");

    new HTMLReporter().generate(allResults, reportPath, {
      baseUrl: opts.baseUrl ?? (outRoot ? path.basename(outRoot) : dir ?? ""),
    });
    console.log(`   HTML  → ${reportPath}`);
    console.log(`─────────────────────────────────────────\n`);

    process.exit(failed > 0 ? 1 : 0);
  });

program.parse(process.argv);
