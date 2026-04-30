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

// ── run ───────────────────────────────────────────────────────────────────────

program
  .command("run <file>")
  .description("Run a DSL test file")
  .option("--headless", "Run browser in headless mode", false)
  .option("--report <file>", "Write an HTML report to this path")
  .action(async (file: string, opts: { headless: boolean; report?: string }) => {
    const testFilePath = path.resolve(process.cwd(), file);

    console.log(`\n🚀 AIQA Runner`);
    console.log(`   File    : ${testFilePath}`);
    console.log(`   Headless: ${opts.headless}`);
    console.log(`─────────────────────────────────────────\n`);

    let testDef;
    try {
      testDef = parseTestFile(testFilePath);
    } catch (err) {
      console.error(`❌ Failed to parse test file: ${(err as Error).message}`);
      process.exit(1);
    }

    const runner = new TestRunner({ headless: opts.headless });
    const result = await runner.run(testDef);

    console.log(`\n─────────────────────────────────────────`);
    if (result.passed) {
      console.log(`✅ Test passed: "${result.testName}" (${result.durationMs}ms)`);
    } else {
      console.log(`❌ Test FAILED: "${result.testName}"`);
      console.log(`   Reason: ${result.error}`);
    }
    console.log(`─────────────────────────────────────────\n`);

    if (opts.report) {
      const reporter  = new HTMLReporter();
      const reportPath = path.resolve(process.cwd(), opts.report);
      reporter.generate([result], reportPath);
      console.log(`📄 Report saved → ${reportPath}\n`);
    }

    process.exit(result.passed ? 0 : 1);
  });

// ── explore ───────────────────────────────────────────────────────────────────

program
  .command("explore <url>")
  .description("Crawl an application and save a structured map to JSON")
  .option("--max-pages <n>", "Maximum pages to crawl", "10")
  .option("--output <file>", "Output file path", "exploration.json")
  .action(async (url: string, opts: { maxPages: string; output: string }) => {
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

      const outPath = path.resolve(process.cwd(), opts.output);
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
  .command("generate <exploration>")
  .description("Generate YAML test scenarios from an exploration JSON file")
  .option("--output <dir>", "Output directory for generated YAML files", "generated")
  .option("--jira <projectKey>", "Also pull stories from Jira (mock) and generate scenarios")
  .option("--per-page", "Generate one test file per discovered page instead of per flow")
  .action(async (explorationFile: string, opts: { output: string; jira?: string; perPage?: boolean }) => {
    console.log(`\n⚙️  AIQA Generator`);
    console.log(`   Input : ${explorationFile}`);
    console.log(`   Output: ${opts.output}/`);
    console.log(`─────────────────────────────────────────\n`);

    // Load exploration result
    let exploration;
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), explorationFile), "utf-8");
      exploration = JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Could not read exploration file: ${(err as Error).message}`);
      process.exit(1);
    }

    const mapper    = new FlowMapper();
    const generator = new ScenarioGenerator();

    // Flows from exploration
    let flows = opts.perPage
      ? mapper.perPageFlows(exploration)
      : await mapper.map(exploration);

    // Optionally merge flows from Jira mock stories
    if (opts.jira) {
      console.log(`   Pulling Jira stories for project: ${opts.jira}`);
      const jira    = new JiraAdapter({ useMock: true });
      const stories = await jira.fetchStories(opts.jira);
      const jiraFlows = await jira.convertToFlows(stories);
      flows = [...flows, ...jiraFlows];
      console.log(`   Added ${jiraFlows.length} flow(s) from Jira\n`);
    }

    const scenarios = await generator.generate(flows, exploration.baseUrl ?? "");

    // Write output files
    const outDir = path.resolve(process.cwd(), opts.output);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    scenarios.forEach(s => {
      const filePath = path.join(outDir, `${s.fileName}.yaml`);
      fs.writeFileSync(filePath, s.yaml);
      console.log(`   ✔ ${s.fileName}.yaml  [${s.flowType}]`);
    });

    console.log(`\n─────────────────────────────────────────`);
    console.log(`✅ Generated ${scenarios.length} scenario(s) → ${outDir}/`);
    console.log(`   Run them with: aiqa run ${opts.output}/<file>.yaml --headless`);
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
  .command("run-all <dir>")
  .description("Run every YAML test file in a directory and generate an HTML report")
  .option("--headless", "Run browser in headless mode", false)
  .option("--report <file>", "HTML report output path", "report/index.html")
  .option("--results <file>", "Save raw JSON results to this path")
  .option("--base-url <url>", "Base URL shown in the report header")
  .action(async (dir: string, opts: { headless: boolean; report: string; results?: string; baseUrl?: string }) => {
    const dirPath = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      console.error(`❌ Directory not found: ${dirPath}`);
      process.exit(1);
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map(f => path.join(dirPath, f));

    if (files.length === 0) {
      console.error(`❌ No YAML files found in ${dirPath}`);
      process.exit(1);
    }

    console.log(`\n🚀 AIQA Run-All`);
    console.log(`   Directory: ${dirPath}`);
    console.log(`   Files    : ${files.length}`);
    console.log(`   Headless : ${opts.headless}`);
    console.log(`─────────────────────────────────────────\n`);

    const runner  = new TestRunner({ headless: opts.headless });
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

    if (opts.results) {
      const rPath = path.resolve(process.cwd(), opts.results);
      fs.mkdirSync(path.dirname(rPath), { recursive: true });
      fs.writeFileSync(rPath, JSON.stringify(allResults, null, 2));
      console.log(`   JSON  → ${rPath}`);
    }

    const reportPath = path.resolve(process.cwd(), opts.report);
    const reporter   = new HTMLReporter();
    reporter.generate(allResults, reportPath, { baseUrl: opts.baseUrl ?? dir });
    console.log(`   HTML  → ${reportPath}`);
    console.log(`─────────────────────────────────────────\n`);

    process.exit(failed > 0 ? 1 : 0);
  });

program.parse(process.argv);
