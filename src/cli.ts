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
import { TrendTracker } from "./reporters/TrendTracker";
import { SlackNotifier } from "./reporters/SlackNotifier";
import { EmailNotifier } from "./reporters/EmailNotifier";
import { AllureReporter } from "./reporters/AllureReporter";
import { JUnitReporter } from "./reporters/JUnitReporter";
import { Spinner } from "./utils/Spinner";
import { loadConfig, resetConfig, checkSecrets, EnvConfig } from "./config/ConfigLoader";
import { ImportOrchestrator } from "./importers/ImportOrchestrator";
import { SelectorHealer } from "./healer/SelectorHealer";
import { MemoryStore } from "./memory/MemoryStore";
import { HealerAnalytics } from "./healer/HealerAnalytics";
import { cleanArtifacts, warnLargeFile } from "./utils/StorageManager";
import { getChangedFiles, getGitRoot, isShallowClone } from "./impact/GitDiffParser";
import { ImpactMapper } from "./impact/ImpactMapper";

const program = new Command();

// Global env flag — parsed before subcommands run
let _envName = "dev";

program
  .name("aiqa")
  .description("Enterprise AI QA Platform")
  .version("1.0.0")
  .option("--env <environment>", "Environment profile to load (dev | staging | prod)", "dev")
  .hook("preAction", (thisCommand) => {
    _envName = (thisCommand.opts() as { env: string }).env ?? "dev";
    try {
      loadConfig(_envName);
    } catch (err) {
      console.error(`\n❌ Config error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    const { missing, warnings } = checkSecrets();
    for (const w of warnings) console.warn(`⚠️  ${w}`);
    for (const m of missing)  console.warn(`⚠️  Missing secret: ${m}`);
  });

function cfg(): EnvConfig {
  return loadConfig(_envName);
}

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
  .command("init [project]")
  .description("Create a new AIQA project workspace with folder structure and a sample test")
  .option("--base-url <url>", "Base URL to pre-fill in the sample test (default: https://example.com)")
  .action(async (project: string | undefined, opts: { baseUrl?: string }) => {
    // 5-7: interactive mode — prompt when project name is omitted
    if (!project) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      project = await new Promise<string>(resolve => {
        rl.question("Project name: ", ans => { rl.close(); resolve(ans.trim()); });
      });
      if (!project) {
        console.error("❌ Project name is required.");
        process.exit(1);
      }
    }

    const baseUrl    = opts.baseUrl ?? "https://example.com";
    const root       = path.resolve(process.cwd(), project);
    const testsDir   = path.join(root, "tests");
    const resultsDir = path.join(root, "results");
    const screensDir = path.join(root, "screenshots");

    [root, testsDir, resultsDir, screensDir].forEach(ensureDir);

    const sampleYaml = [
      `test:`,
      `  name: "Sample — Page Load"`,
      `  tags: [smoke]`,
      `  steps:`,
      `    - navigate: "${baseUrl}"`,
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
    console.log(`   aiqa explore ${baseUrl} --out ${project}`);
    console.log(`   aiqa generate --out ${project} --per-page`);
    console.log(`   aiqa run-all --out ${project} --headless`);
    console.log();
  });

// ── run ───────────────────────────────────────────────────────────────────────

program
  .command("run <file>")
  .description("Run a single DSL test file")
  .option("--headless", "Run browser in headless mode (default: from env config)")
  .option("--out <folder>", "Project folder — saves screenshots, results JSON, and HTML report here")
  .option("--report <file>", "Explicit HTML report output path (overrides --out)")
  .action(async (file: string, opts: { headless?: boolean; out?: string; report?: string }) => {
    const config       = cfg();
    const headless     = opts.headless ?? config.execution.headless;
    const testFilePath = path.resolve(process.cwd(), file);
    const outRoot      = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;

    console.log(`\n🚀 AIQA Runner  [env: ${config.environment}]`);
    console.log(`   File    : ${testFilePath}`);
    console.log(`   Headless: ${headless}`);
    if (outRoot) console.log(`   Out     : ${outRoot}`);
    console.log(`─────────────────────────────────────────\n`);

    let testDef;
    try {
      testDef = parseTestFile(testFilePath);
    } catch (err) {
      console.error(`❌ Failed to parse test file: ${(err as Error).message}`);
      console.error(`   → Check YAML syntax. Validate with: aiqa list ${path.dirname(path.relative(process.cwd(), testFilePath)) || "."}`);
      process.exit(1);
    }

    const runner = new TestRunner({
      headless,
      timeout:        config.timeouts.action,
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
    const healerReport = runner.getHealerReport();
    if (healerReport) console.log(healerReport);

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
  .option("--max-pages <n>", "Maximum pages to crawl (default: from env config)")
  .option("--depth <n>",     "Maximum BFS link depth (default: from env config)")
  .option("--out <folder>",  "Project folder — saves exploration.json inside it")
  .option("--output <file>", "Explicit output file path (overrides --out)")
  .action(async (url: string, opts: { maxPages?: string; depth?: string; out?: string; output?: string }) => {
    const config   = cfg();
    const maxPages = opts.maxPages ? parseInt(opts.maxPages, 10) : config.execution.maxPages;
    const maxDepth = opts.depth    ? parseInt(opts.depth, 10)    : config.execution.maxDepth;

    const outPath = opts.output
      ? path.resolve(process.cwd(), opts.output)
      : opts.out
        ? path.join(path.resolve(process.cwd(), opts.out), "exploration.json")
        : path.resolve(process.cwd(), "exploration.json");

    console.log(`\n🔍 AIQA Explorer  [env: ${config.environment}]`);
    console.log(`   URL      : ${url}`);
    console.log(`   Max pages: ${maxPages}`);
    console.log(`   Max depth: ${maxDepth}`);
    console.log(`─────────────────────────────────────────\n`);

    const explorer = new AppExplorer();
    const explSpin = new Spinner();
    explSpin.start(`Crawling ${url} (max ${maxPages} pages, depth ${maxDepth})…`);
    try {
      const result = await explorer.explore(url, {
        headless: config.execution.headless,
        maxPages,
        maxDepth,
        timeout: config.timeouts.navigation,
      });
      explSpin.stop();

      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

      console.log(`\n─────────────────────────────────────────`);
      console.log(`✅ Explored ${result.totalPages} page(s), ${result.totalLinks} internal link(s)`);
      result.pages.forEach(p => console.log(`   • ${p.url} — ${p.title}`));
      console.log(`\n   Saved → ${outPath}`);
      console.log(`─────────────────────────────────────────\n`);
    } catch (err) {
      explSpin.stop();
      const msg = (err as Error).message;
      console.error(`❌ Exploration failed: ${msg}`);
      if (msg.includes("net::ERR") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
        console.error(`   → Is the app running at ${url}? Check connectivity first.`);
      }
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
  .option("--sprint <id>",     "Filter Jira stories by sprint ID or name (used with --jira)")
  .option("--per-page",        "Generate one test file per discovered page instead of per flow")
  .action(async (exploration: string | undefined, opts: { out?: string; output?: string; jira?: string; sprint?: string; perPage?: boolean }) => {
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

    // RAG context — must happen BEFORE mapper.map() so FlowMapper gets knowledge context
    let ragContext: string | undefined;
    let ragSourceIds: string[] = [];
    if (cfg().knowledge.enabled) {
      try {
        const { KnowledgeStore }     = await import("./knowledge/KnowledgeStore");
        const { KnowledgeRetriever } = await import("./knowledge/KnowledgeRetriever");
        const { KnowledgeIngester }  = await import("./knowledge/KnowledgeIngester");
        const { HealthScorer }       = await import("./knowledge/HealthScorer");
        const kCfg    = cfg().knowledge;
        const metaPath = path.join(kCfg.indexPath, "meta.json");
        const health  = new HealthScorer().score(KnowledgeIngester.readMetaFrom(metaPath));
        if (health.status === "WARN") {
          console.warn(`   ⚠  RAG index is ${health.ageDays} days old — consider refreshing (aiqa knowledge ingest)`);
        } else if (health.status === "STALE") {
          console.warn(`   ⚠  RAG index is STALE (${health.ageDays} days old) — results may be outdated`);
        }
        // Build source weight map for HybridReranker: sourceName → weight
        const sourceWeights: Record<string, number> = {};
        for (const c of kCfg.connectors) {
          if (c.weight !== undefined) sourceWeights[c.type] = c.weight;
        }
        const reranker = kCfg.reranker === "hybrid"
          ? new (await import("./knowledge/rerankers/HybridReranker")).HybridReranker(sourceWeights)
          : undefined; // undefined → KnowledgeStore uses CosineSimilarityReranker default
        const store     = new KnowledgeStore({ indexPath: kCfg.indexPath, reranker });
        const retriever = new KnowledgeRetriever(store, kCfg.topK);
        // Build query from page vocabulary; cap at 800 chars (≈256 tokens for all-MiniLM-L6-v2)
        const pages: Array<{ title?: string; headings?: string[] }> = exploration_data.pages ?? [];
        const rawQuery = pages.length > 0
          ? pages.map(p => [p.title ?? "", ...(p.headings ?? []).slice(0, 3)].join(" ")).join(" ").trim()
          : (exploration_data.baseUrl ?? outDir);
        const query = rawQuery.slice(0, 800);
        const ragSpin = new Spinner();
        ragSpin.start("Retrieving knowledge context (downloads model on first run)…");
        const chunks = await retriever.retrieve(query);
        ragSpin.stop();
        if (chunks.length > 0) {
          ragContext   = KnowledgeRetriever.formatContext(chunks);
          ragSourceIds = [...new Set(chunks.map(c => c.sourceId))];
          console.log(`   RAG: retrieved ${chunks.length} chunks (${ragSourceIds.join(", ")})`);
        }
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        console.warn(`   ⚠  RAG unavailable: ${msg} — continuing without knowledge context`);
      }
    }

    let flows = opts.perPage
      ? mapper.perPageFlows(exploration_data)
      : await mapper.map(exploration_data, ragContext);

    if (opts.jira) {
      const sprintLabel = opts.sprint ? ` sprint=${opts.sprint}` : "";
      console.log(`   Pulling Jira stories for project: ${opts.jira}${sprintLabel}`);
      const jira      = new JiraAdapter({ useMock: true });
      const stories   = await jira.fetchStories(opts.jira, opts.sprint);
      const jiraFlows = await jira.convertToFlows(stories);
      flows = [...flows, ...jiraFlows];
      console.log(`   Added ${jiraFlows.length} flow(s) from Jira\n`);
    }

    // Persist flows so the orchestrator (and humans) can inspect them
    const flowsPath = outRoot ? path.join(outRoot, "flows.json") : null;
    if (flowsPath) {
      ensureDir(path.dirname(flowsPath));
      fs.writeFileSync(flowsPath, JSON.stringify(flows, null, 2));
      console.log(`   Flows → ${flowsPath}`);
    }

    const scenarios = await generator.generate(flows, exploration_data.baseUrl ?? "", ragContext, ragSourceIds);

    ensureDir(outDir);
    let validCount = 0;
    let invalidCount = 0;
    scenarios.forEach(s => {
      const filePath = path.join(outDir, `${s.fileName}.yaml`);
      fs.writeFileSync(filePath, s.yaml);
      warnLargeFile(filePath, Buffer.byteLength(s.yaml, "utf-8"));
      if (s.validated) {
        console.log(`   ✔ ${s.fileName}.yaml  [${s.flowType}]`);
        validCount++;
      } else {
        console.warn(`   ⚠ ${s.fileName}.yaml  [${s.flowType}] — DSL validation failed: ${s.validationError}`);
        invalidCount++;
      }
    });
    if (invalidCount > 0) {
      console.warn(`\n   ⚠  ${invalidCount} file(s) failed validation — review before running`);
    }

    console.log(`\n─────────────────────────────────────────`);
    console.log(`✅ Generated ${validCount} valid / ${scenarios.length} total scenario(s) → ${outDir}/`);
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
  .option("--headless",        "Run browser in headless mode (default: from env config)")
  .option("--out <folder>",    "Project folder — runs <folder>/tests/, saves results to <folder>/results/")
  .option("--report <file>",   "Explicit HTML report output path (overrides --out)")
  .option("--results <file>",  "Explicit JSON results output path (overrides --out)")
  .option("--base-url <url>",  "Base URL shown in the report header")
  .option("--workers <n>",          "Number of tests to run in parallel (default: from env config)")
  .option("--tags <tags>",          "Only run tests whose tags include at least one of these (comma-separated)")
  .option("--circuit-breaker <n>",  "Abort suite after N consecutive failures (default: from env config)")
  .option("--allure [dir]",         "Generate Allure JSON results (default dir: allure-results/)")
  .option("--slack",                "Post run summary to Slack (reads SLACK_WEBHOOK_URL from env)")
  .option("--email <recipients>",   "Email HTML report to comma-separated addresses (reads SMTP_* from env)")
  .option("--retain-runs <n>",      "Delete screenshots and allure artifacts older than last N runs (default: from config)")
  .option("--jira-defects",         "Auto-create Jira bug for every failed test (reads JIRA_API_TOKEN from env)")
  .option("--dry-run",              "List tests that would run without executing them")
  .option("--impact-only [base]",   "Only run tests impacted by git changes since <base> (default: origin/main). Requires a full clone (fetch-depth: 0 in CI).")
  .option("--junit <file>",         "Write JUnit XML report to <file> (for CI test result parsers)")
  .action(async (dir: string | undefined, opts: {
    headless?: boolean; out?: string; report?: string; results?: string; baseUrl?: string; workers?: string; tags?: string; circuitBreaker?: string;
    allure?: string | boolean; slack?: boolean; email?: string; retainRuns?: string; jiraDefects?: boolean; dryRun?: boolean;
    impactOnly?: string | boolean; junit?: string;
  }) => {
    const config       = cfg();
    const headless     = opts.headless ?? config.execution.headless;
    const workers      = opts.workers ? Math.max(1, parseInt(opts.workers, 10)) : config.execution.workers;
    const cbThreshold  = opts.circuitBreaker ? Math.max(1, parseInt(opts.circuitBreaker, 10)) : config.execution.circuitBreaker;
    const outRoot  = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;

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

    const filterTags = opts.tags
      ? opts.tags.split(",").map(t => t.trim()).filter(Boolean)
      : [];

    let files = fs.readdirSync(testsDir)
      .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map(f => path.join(testsDir, f));

    if (filterTags.length > 0) {
      files = files.filter(f => {
        try {
          const def = parseTestFile(f);
          return filterTags.some(tag => (def.tags ?? []).includes(tag));
        } catch {
          return false;
        }
      });
      console.log(`   Tag filter: [${filterTags.join(", ")}] → ${files.length} matching file(s)`);
    }

    let impactFilterActive = false;
    const impactBase = opts.impactOnly !== undefined
      ? (typeof opts.impactOnly === "string" ? opts.impactOnly : "origin/main")
      : undefined;

    if (impactBase !== undefined) {
      impactFilterActive = true;
      try {
        if (isShallowClone()) {
          console.warn(`   ⚠️  Shallow clone detected — --impact-only may miss changes (use fetch-depth: 0 in CI)`);
        }
        const changed = getChangedFiles({ base: impactBase });
        const gitRoot = getGitRoot();
        const before  = files.length;
        files = changed.length > 0
          ? new ImpactMapper().filterTests(files, changed, parseTestFile, gitRoot ?? undefined)
          : [];
        console.log(`   Impact filter: [${impactBase}] → ${changed.length} changed file(s) → ${files.length}/${before} test(s) impacted`);
      } catch (err) {
        console.warn(`   ⚠️  Impact filter failed (${(err as Error).message}) — running all tests`);
        impactFilterActive = false;
      }
    }

    if (files.length === 0) {
      if (opts.dryRun) {
        // Let dry-run block show the "0 tests" summary instead of silently exiting
        const nothingMsg = impactFilterActive
          ? " (no tests impacted by recent changes)"
          : filterTags.length ? ` matching tags [${filterTags.join(", ")}]` : "";
        console.log(`\n🔍 AIQA Dry Run — 0 test(s) would run${nothingMsg}\n`);
        console.log(`─────────────────────────────────────────`);
        if (filterTags.length)   console.log(`   Tag filter    : [${filterTags.join(", ")}]`);
        if (impactBase)          console.log(`   Impact filter : [${impactBase}]`);
        if (outRoot)             console.log(`   Out           : ${outRoot}`);
        console.log(`─────────────────────────────────────────\n`);
        process.exit(0);
      }
      if (impactFilterActive) {
        console.log(`   ℹ️  No tests impacted by changes since [${impactBase}] — nothing to run`);
        process.exit(0);
      }
      console.error(`❌ No YAML files found in ${testsDir}${filterTags.length ? ` matching tags [${filterTags.join(", ")}]` : ""}`);
      console.error(`   → Run "aiqa list ${path.relative(process.cwd(), testsDir) || "."}" to see what's there, or "aiqa init <project>" to scaffold a new project.`);
      process.exit(1);
    }

    if (opts.dryRun) {
      console.log(`\n🔍 AIQA Dry Run — ${files.length} test(s) would run:\n`);
      for (const f of files) {
        try {
          const def = parseTestFile(f);
          const tags = def.tags?.length ? `  [${def.tags.join(", ")}]` : "";
          console.log(`   • ${def.name}${tags}`);
          console.log(`     ${f}`);
        } catch {
          console.log(`   ⚠️  ${path.basename(f)} — parse error`);
        }
      }
      console.log(`\n─────────────────────────────────────────`);
      console.log(`   Would run : ${files.length} test(s)`);
      if (filterTags.length)          console.log(`   Tag filter    : [${filterTags.join(", ")}]`);
      if (opts.impactOnly !== undefined) console.log(`   Impact filter : [${typeof opts.impactOnly === "string" ? opts.impactOnly : "origin/main"}]`);
      if (outRoot)                    console.log(`   Out           : ${outRoot}`);
      console.log(`─────────────────────────────────────────\n`);
      process.exit(0);
    }

    const screenshotsDir = outRoot ? path.join(outRoot, "screenshots") : undefined;

    console.log(`\n🚀 AIQA Run-All  [env: ${config.environment}]`);
    console.log(`   Directory: ${testsDir}`);
    console.log(`   Files    : ${files.length}`);
    console.log(`   Headless : ${headless}`);
    console.log(`   Workers  : ${workers}`);
    if (outRoot) console.log(`   Out      : ${outRoot}`);
    console.log(`─────────────────────────────────────────\n`);

    const memoryPath   = outRoot ? path.join(outRoot, "results", "memory.json") : undefined;
    const sharedMemory = memoryPath
      ? new MemoryStore(memoryPath, path.basename(testsDir))
      : undefined;

    const runnerOpts = { headless, timeout: config.timeouts.action, screenshotsDir, memory: sharedMemory };

    console.log(`   Circuit: stop after ${cbThreshold} consecutive failures`);
    console.log(`─────────────────────────────────────────\n`);

    // ── Concurrency-limited runner with circuit breaker ──────────────────────
    const sharedHealer = new SelectorHealer();
    const orderedResults: (Awaited<ReturnType<TestRunner["run"]>> | null)[] = new Array(files.length).fill(null);
    let cursor = 0;

    // Circuit breaker state — declared here so they reset fresh for every run-all
    // invocation (new stack frame). Global across all worker slots for this run;
    // JS single-threaded event loop guarantees safe reads/writes without a mutex.
    let consecutiveFails = 0;
    let circuitOpen      = false;
    let skippedByCircuit = 0;
    let skippedByParse   = 0;

    const runSlot = async () => {
      while (cursor < files.length) {
        if (circuitOpen) {
          console.log(`  ⊘ Skipped: ${path.basename(files[cursor])} (circuit breaker open)`);
          skippedByCircuit++;
          cursor++;
          continue;
        }

        const idx  = cursor++;
        const file = files[idx];
        let testDef;
        try {
          testDef = parseTestFile(file);
        } catch (err) {
          const msg = (err as Error).message;
          // 5-3: include relative path + actionable hint
          console.error(`  ⚠️  Skipped ${path.relative(process.cwd(), file)}: ${msg}`);
          console.error(`       → Check YAML syntax with: aiqa list ${path.dirname(path.relative(process.cwd(), file))}`);
          skippedByParse++;
          continue;
        }

        const result = await new TestRunner({ ...runnerOpts, healer: sharedHealer }).run(testDef);
        orderedResults[idx] = result;

        if (result.passed) {
          consecutiveFails = 0;
        } else {
          consecutiveFails++;
          if (consecutiveFails >= cbThreshold && !circuitOpen) {
            circuitOpen = true;
            console.log(`\n⚡ Circuit breaker open — ${cbThreshold} consecutive failures, aborting remaining tests\n`);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, runSlot));

    const allResults = orderedResults.filter((r): r is NonNullable<typeof r> => r !== null);
    const passed     = allResults.filter(r => r.passed).length;
    const retried    = allResults.filter(r => r.retryCount > 0).length;
    const failed     = allResults.length - passed;
    // Capture once — reused for trend tracker, Slack, and email so all three share the same runId.
    const runId = runTimestamp();
    const rpt = new ReadinessScorer().score(allResults, new Map());

    console.log(`─────────────────────────────────────────`);
    console.log(`   Ran    : ${allResults.length} test(s)${skippedByCircuit ? `  (${skippedByCircuit} skipped by circuit breaker)` : ""}${skippedByParse ? `  (${skippedByParse} skipped — parse error)` : ""}`);
    console.log(`   Passed : ${passed}   Failed: ${failed}${retried ? `   Retried: ${retried}` : ""}`);
    if (circuitOpen) console.log(`   ⚡ Suite aborted — circuit breaker triggered at ${cbThreshold} consecutive failures`);

    const resultsDir = outRoot ? path.join(outRoot, "results") : undefined;
    let jsonPath: string | null = null;
    if (opts.results) {
      jsonPath = path.resolve(process.cwd(), opts.results);
      ensureDir(path.dirname(jsonPath));
      fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
    } else if (resultsDir) {
      jsonPath = saveResults(allResults, resultsDir);
    }
    if (jsonPath) console.log(`   JSON  → ${jsonPath}`);

    const reportPath = opts.report
      ? path.resolve(process.cwd(), opts.report)
      : resultsDir
        ? path.join(resultsDir, "report.html")
        : path.resolve(process.cwd(), "report/index.html");

    const baseUrlLabel = opts.baseUrl ?? (outRoot ? path.basename(outRoot) : dir ?? "");

    // Read trend history before HTML generation so the chart shows the current run context.
    // Trend is appended after so this is the history up to (not including) the current run.
    const tracker = resultsDir ? new TrendTracker(resultsDir, config.storage.maxHistory) : undefined;
    const trendHistory = tracker?.read() ?? [];

    new HTMLReporter().generate(allResults, reportPath, {
      baseUrl: baseUrlLabel,
      circuitBreaker: circuitOpen
        ? { triggered: true, threshold: cbThreshold, skipped: skippedByCircuit }
        : undefined,
      trendHistory,
    });
    console.log(`   HTML  → ${reportPath}`);

    // Allure results
    if (opts.allure !== undefined) {
      const allureDir = typeof opts.allure === "string"
        ? path.resolve(process.cwd(), opts.allure)
        : path.resolve(process.cwd(), "allure-results");
      new AllureReporter().generate(allResults, allureDir);
      console.log(`   Allure→ ${allureDir}`);
    }

    // JUnit XML
    if (opts.junit) {
      const junitPath = path.resolve(process.cwd(), opts.junit);
      new JUnitReporter().generate(allResults, junitPath);
      console.log(`   JUnit → ${junitPath}`);
    }

    // Trend tracking (always when --out is set)
    if (tracker && resultsDir) {
      tracker.append({
        runId,
        date:        new Date().toISOString(),
        passed,
        failed,
        total:       allResults.length,
        score:       rpt.score,
        grade:       rpt.grade,
        durationMs:  allResults.reduce((s, r) => s + r.durationMs, 0),
        url:         baseUrlLabel || undefined,
        testResults: allResults.map(r => ({ name: r.testName, passed: r.passed })),
      });
      const trendLine = tracker.formatTrend();
      if (trendLine) console.log(trendLine);

      // Artifact cleanup when --retain-runs is specified
      const retainN = opts.retainRuns
        ? Math.max(1, parseInt(opts.retainRuns, 10))
        : undefined;
      if (retainN !== undefined) {
        const historyPath  = path.join(resultsDir, "history.json");
        const screenshotDir = config.screenshots.dir
          ? path.resolve(process.cwd(), config.screenshots.dir)
          : undefined;
        const allureDir    = typeof opts.allure === "string"
          ? path.resolve(process.cwd(), opts.allure)
          : opts.allure !== undefined
            ? path.resolve(process.cwd(), "allure-results")
            : undefined;
        const dirs = [screenshotDir, allureDir].filter((d): d is string => !!d);
        if (dirs.length > 0) cleanArtifacts({ historyPath, dirs, retainRuns: retainN });
      }
    }

    console.log(`─────────────────────────────────────────\n`);
    const suiteHealerReport = sharedHealer.getReport();
    if (suiteHealerReport) console.log(suiteHealerReport);

    if (sharedMemory) {
      sharedMemory.save();
      const memReport = sharedMemory.getReport();
      if (memReport) console.log(memReport);
    }

    // Slack notification
    if (opts.slack) {
      const slack = SlackNotifier.fromEnv();
      if (slack) {
        await slack.send({
          runId, passed, failed, total: allResults.length,
          score: rpt.score, grade: rpt.grade,
          durationMs: allResults.reduce((s, r) => s + r.durationMs, 0),
          baseUrl: baseUrlLabel || undefined,
          reportUrl: undefined,
        }).catch(e => console.warn(`   ⚠️  Slack notification failed: ${e.message}`));
        console.log(`   Slack → sent`);
      } else {
        console.warn(`   ⚠️  --slack set but SLACK_WEBHOOK_URL is not in env`);
      }
    }

    // Email notification
    if (opts.email) {
      const recipients = opts.email.split(",").map(s => s.trim()).filter(Boolean);
      const mailer = EmailNotifier.fromEnv(recipients);
      if (mailer) {
        await mailer.send({
          runId, passed, failed, total: allResults.length,
          score: rpt.score, grade: rpt.grade,
          durationMs: allResults.reduce((s, r) => s + r.durationMs, 0),
          baseUrl: baseUrlLabel || undefined,
          reportPath,
        }).catch(e => console.warn(`   ⚠️  Email notification failed: ${e.message}`));
        console.log(`   Email → sent to ${recipients.join(", ")}`);
      } else {
        console.warn(`   ⚠️  --email set but SMTP_HOST is not in env`);
      }
    }

    // Jira defect auto-creation
    // Jira failure intentionally only warns — it must never affect the suite exit code.
    // (jira-sync exits 1 on failure because that's its sole purpose; run-all's purpose is running tests.)
    if (opts.jiraDefects) {
      const jiraCfg  = config.jira;
      const apiToken = process.env.JIRA_API_TOKEN;
      if (!apiToken) {
        console.warn(`   ⚠️  --jira-defects set but JIRA_API_TOKEN is not in env`);
      } else if (!jiraCfg?.baseUrl || !jiraCfg?.email) {
        console.warn(`   ⚠️  --jira-defects set but jira.baseUrl / jira.email not configured`);
      } else {
        const adapter = new JiraAdapter({
          baseUrl:    jiraCfg.baseUrl,
          email:      jiraCfg.email,
          apiToken,
          projectKey: jiraCfg?.projectKey,
        });
        const failedResults = allResults
          .filter(r => !r.passed)
          .map(r => ({ testName: r.testName, passed: false, error: r.error, screenshotPath: r.screenshotPath }));
        if (failedResults.length === 0) {
          console.log(`   Jira  → no failures, nothing to create`);
        } else {
          const summary = await adapter.pushResults(failedResults, runId)
            .catch(e => { console.warn(`   ⚠️  Jira defect creation failed: ${(e as Error).message}`); return null; });
          if (summary) {
            const { created, commented, failed } = summary;
            console.log(`   Jira  → created=${created.length}, updated=${commented.length}, failed=${failed.length}`);
            if (created.length)   console.log(`           created:  ${created.join(", ")}`);
            if (commented.length) console.log(`           updated:  ${commented.join(", ")}`);
            if (failed.length)    console.log(`           failed:   ${failed.map(f => f.testName).join(", ")}`);
          }
        }
      }
    }

    process.exit(failed > 0 ? 1 : 0);
  });

// ── jira-sync ─────────────────────────────────────────────────────────────────

program
  .command("jira-sync <results>")
  .description("Push a run-results JSON file to Jira — create bugs for failures, sync Xray if configured")
  .option("--project <key>",        "Override jira.projectKey from config")
  .option("--dry-run",              "Print what would be created without calling Jira")
  .option("--xray <executionKey>",  "Sync results to an Xray test execution (e.g. AIQA-99)")
  .action(async (resultsFile: string, opts: { project?: string; dryRun?: boolean; xray?: string }) => {
    const config   = cfg();
    const jiraCfg  = config.jira;
    const apiToken = process.env.JIRA_API_TOKEN;

    const resultsPath = path.resolve(process.cwd(), resultsFile);
    if (!fs.existsSync(resultsPath)) {
      console.error(`❌ Results file not found: ${resultsPath}`);
      process.exit(1);
    }

    let allResults: { testName: string; passed: boolean; error?: string; screenshotPath?: string }[];
    try {
      allResults = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
    } catch (err) {
      console.error(`❌ Failed to parse results JSON: ${(err as Error).message}`);
      process.exit(1);
    }

    const projectKey = opts.project ?? jiraCfg?.projectKey;
    if (!projectKey) {
      console.error("❌ No project key — set jira.projectKey in config or pass --project <key>");
      process.exit(1);
    }

    const failures = allResults.filter(r => !r.passed);
    const passes   = allResults.length - failures.length;

    console.log(`\n📋 AIQA Jira Sync  [env: ${config.environment}]`);
    console.log(`   Results file : ${resultsPath}`);
    console.log(`   Project key  : ${projectKey}`);
    console.log(`   Total tests  : ${allResults.length}  (${passes} passed, ${failures.length} failed)`);
    if (opts.dryRun) console.log(`   Mode         : DRY RUN — no Jira calls will be made`);
    console.log(`─────────────────────────────────────────\n`);

    if (failures.length === 0) {
      console.log(`✅ All tests passed — nothing to create in Jira.\n`);
      process.exit(0);
    }

    if (opts.dryRun) {
      console.log(`Would create ${failures.length} bug(s) in project "${projectKey}":`);
      failures.forEach((r, i) => {
        console.log(`  ${i + 1}. [AIQA] Test failed: ${r.testName}`);
        if (r.error)          console.log(`     Error:      ${r.error.slice(0, 120)}`);
        if (r.screenshotPath) console.log(`     Screenshot: ${r.screenshotPath}`);
      });
      if (opts.xray) {
        console.log(`\nWould sync ${allResults.length} result(s) to Xray execution: ${opts.xray}`);
      }
      console.log();
      process.exit(0);
    }

    // Early credential check — fail fast before making any API calls.
    // jira-sync exits 1 on credential failure; run-all --jira-defects only warns.
    // The asymmetry is intentional: jira-sync's sole purpose is Jira I/O, so failure is fatal.
    if (!apiToken) {
      console.error("❌ JIRA_API_TOKEN not set — add it to your .env file");
      process.exit(1);
    }
    if (!jiraCfg?.baseUrl || !jiraCfg?.email) {
      console.error("❌ jira.baseUrl and jira.email must be set in your environment config");
      process.exit(1);
    }

    const adapter = new JiraAdapter({
      baseUrl:    jiraCfg?.baseUrl,
      email:      jiraCfg?.email,
      apiToken,
      projectKey,
    });

    // Derive run ID from the results filename so Jira issues link back to the same run.
    const runIdFromFile = path.basename(resultsPath, ".json").replace(/^run-/, "");
    const summary = await adapter.pushResults(failures, runIdFromFile)
      .catch(e => { console.error(`❌ Jira push failed: ${(e as Error).message}`); process.exit(1); });

    const { created, commented, failed: syncFailed } = summary;
    console.log(`✅ Jira sync: created=${created.length}, updated=${commented.length}, failed=${syncFailed.length}`);
    if (created.length)   console.log(`   Created:  ${created.join(", ")}`);
    if (commented.length) console.log(`   Updated:  ${commented.join(", ")}`);
    if (syncFailed.length) {
      console.log(`   Failed (${syncFailed.length}):`);
      syncFailed.forEach(f => console.log(`     - ${f.testName}: ${f.error.slice(0, 120)}`));
    }

    if (opts.xray) {
      await adapter.syncXrayResults(opts.xray, allResults.map(r => ({ ...r })))
        .catch(e => console.warn(`⚠️  Xray sync failed: ${(e as Error).message}`));
    }

    console.log();
    process.exit(0);
  });

// ── help ──────────────────────────────────────────────────────────────────────

program
  .command("help")
  .description("Show a quick-start guide and command reference")
  .action(() => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║          AIQA — Enterprise AI QA Platform            ║
╚══════════════════════════════════════════════════════╝

QUICK START
  1. aiqa init my-project             Create project workspace
  2. aiqa orchestrate --url <url> --out .   Full pipeline in one command
  — or run stages individually —
  3. aiqa explore <url> --out .       Crawl app → exploration.json
  4. aiqa generate --out .            Generate YAML tests from crawl
  5. aiqa run-all --out . --headless  Run all tests + HTML report

COMMANDS — Setup
  init <project>        Create workspace (tests/, results/, screenshots/)
  doctor                Check environment and dependencies

COMMANDS — Discovery
  explore <url>         Crawl app and save page map
    --max-pages <n>       Max pages to visit  (default: 10)
    --depth <n>           BFS link depth       (default: 3)
    --out <folder>        Project folder → saves exploration.json + flows.json
  generate [file]       Generate YAML tests from exploration
    --per-page            One test per discovered page
    --jira <key>          Also pull Jira stories (mock)
    --out <folder>        Project folder

COMMANDS — Execution
  orchestrate           Full pipeline: explore → map → generate → run → score
    --url <url>           Target URL to explore and test (required)
    --max-pages <n>       Max pages to crawl  (default: from env config)
    --headless            Run browser headlessly
    --out <folder>        Write all artifacts here
  run <file>            Run a single YAML test
    --headless            Run browser headlessly
    --out <folder>        Save results + report here
  run-all [dir]         Run every YAML test in a directory
    --headless            Run browser headlessly
    --workers <n>         Parallel workers        (default: 1)
    --tags <tag,...>      Only run tests with these tags
    --circuit-breaker <n> Stop after N consecutive failures
    --out <folder>        Project folder
  import                Import CSV/Excel/Gherkin/TXT test cases → YAML DSL

COMMANDS — Analysis
  score <results.json>  Compute 0-100 readiness score
  help                  Show this guide

COMMANDS — Jira Integration
  jira-sync <results>   Push test results JSON to Jira
    --project <key>       Override jira.projectKey from config
    --dry-run             Preview without creating issues
    --xray <execKey>      Also sync to Xray test execution

  run-all also accepts:
    --jira-defects        Auto-create Jira bug for each failed test

  Required env vars:
    JIRA_API_TOKEN        Your Atlassian API token (never commit!)

  Required config (config/environments/<env>.yaml):
    jira:
      baseUrl:    https://yourorg.atlassian.net
      projectKey: AIQA
      email:      you@example.com

EXAMPLES
  aiqa orchestrate --url https://example.com --out my-app --headless
  aiqa explore https://example.com --out my-app --max-pages 20 --depth 4
  aiqa generate --out my-app --per-page
  aiqa run-all --out my-app --headless --workers 4
  aiqa run-all --out my-app --tags smoke --jira-defects
  aiqa jira-sync my-app/results/run-2024-01-01.json --dry-run
  aiqa jira-sync my-app/results/run-2024-01-01.json
  aiqa score my-app/results/run-2024-01-01.json
`);
  });

// ── doctor ────────────────────────────────────────────────────────────────────

program
  .command("doctor")
  .description("Check your environment and print a diagnostic report")
  .action(async () => {
    console.log(`\n🩺 AIQA Doctor — environment check`);
    console.log(`─────────────────────────────────────────`);

    const issues: string[] = [];

    // Node.js version
    const nodeVer   = process.versions.node;
    const nodeMajor = parseInt(nodeVer.split(".")[0], 10);
    const nodeOk    = nodeMajor >= 18;
    console.log(`${nodeOk ? "✅" : "❌"} Node.js  ${nodeVer}${nodeOk ? "" : "  → need ≥18. Download: https://nodejs.org"}`);
    if (!nodeOk) issues.push("Node.js ≥18 required");

    // Anthropic API key
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    console.log(`${hasKey ? "✅" : "⚠️ "} ANTHROPIC_API_KEY  ${hasKey ? "set (real LLM enabled)" : "not set → using mock LLM. Set in .env or shell."}`);

    // @anthropic-ai/sdk installed
    let sdkInstalled = false;
    try { require.resolve("@anthropic-ai/sdk"); sdkInstalled = true; } catch { /* ok */ }
    console.log(`${sdkInstalled ? "✅" : "⚠️ "} @anthropic-ai/sdk  ${sdkInstalled ? "installed" : "not installed → run: npm install @anthropic-ai/sdk"}`);

    // Playwright browsers (slow — show spinner)
    const spin = new Spinner();
    spin.start("Playwright Chromium — launching test browser…");
    let playwrightOk = false;
    let playwrightErr = "";
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      playwrightOk = true;
    } catch (e) {
      playwrightErr = (e as Error).message.split("\n")[0];
    }
    spin.stop();
    console.log(`${playwrightOk ? "✅" : "❌"} Playwright Chromium  ${playwrightOk ? "ready" : `not ready → run: npx playwright install chromium\n   Detail: ${playwrightErr}`}`);
    if (!playwrightOk) issues.push("Playwright Chromium not installed");

    // js-yaml
    let yamlOk = false;
    try { require.resolve("js-yaml"); yamlOk = true; } catch { /* ok */ }
    console.log(`${yamlOk ? "✅" : "❌"} js-yaml  ${yamlOk ? "installed" : "not installed → run: npm install"}`);
    if (!yamlOk) issues.push("js-yaml not installed");

    // zod
    let zodOk = false;
    try { require.resolve("zod"); zodOk = true; } catch { /* ok */ }
    console.log(`${zodOk ? "✅" : "❌"} zod  ${zodOk ? "installed" : "not installed → run: npm install"}`);
    if (!zodOk) issues.push("zod not installed");

    // Config file present
    const configDir  = path.resolve(process.cwd(), "config", "environments");
    const configFile = path.join(configDir, `${process.env.AIQA_ENV ?? "dev"}.yaml`);
    const configOk   = fs.existsSync(configFile);
    console.log(`${configOk ? "✅" : "⚠️ "} Config  ${configOk ? configFile : `not found at ${configFile} → run: aiqa init <project>`}`);

    // .env file presence (informational)
    const envFile = path.resolve(process.cwd(), ".env");
    const hasEnv  = fs.existsSync(envFile);
    console.log(`${hasEnv ? "✅" : "⚠️ "} .env file  ${hasEnv ? "found" : "not found — secrets can also be set as shell env vars"}`);

    // Disk space (warn if < 100 MB free on cwd drive)
    try {
      const { spawnSync } = await import("child_process");
      // Cross-platform: df on Unix, wmic on Windows — array args avoids shell injection
      let freeMB = Infinity;
      if (process.platform === "win32") {
        const drive = path.parse(process.cwd()).root.replace(/\\/g, "");
        const out   = spawnSync("wmic", ["LogicalDisk", `where DeviceID="${drive}"`, "get", "FreeSpace", "/Value"], { encoding: "utf-8", timeout: 5000 }).stdout ?? "";
        const match = out.match(/FreeSpace=(\d+)/);
        if (match) freeMB = parseInt(match[1], 10) / 1024 / 1024;
      } else {
        const out   = spawnSync("df", ["-k", process.cwd()], { encoding: "utf-8", timeout: 5000 }).stdout ?? "";
        const lines = out.trim().split("\n");
        const cols  = lines[lines.length - 1].trim().split(/\s+/);
        if (cols[3]) freeMB = parseInt(cols[3], 10) / 1024;
      }
      const diskOk = freeMB > 100;
      console.log(`${diskOk ? "✅" : "⚠️ "} Disk space  ${Math.round(freeMB)} MB free${diskOk ? "" : " — less than 100 MB, screenshots/results may fail"}`);
      if (!diskOk) issues.push("Low disk space (<100 MB)");
    } catch { /* disk check optional — skip on error */ }

    console.log(`─────────────────────────────────────────`);
    const critical = !nodeOk || !playwrightOk || !yamlOk;
    if (issues.length === 0) {
      console.log(`✅ All checks passed. Run "aiqa help" for usage.\n`);
    } else if (critical) {
      console.log(`❌ ${issues.length} issue(s) found — fix before running tests:\n   ${issues.join("\n   ")}\n`);
      process.exit(1);
    } else {
      console.log(`⚠️  ${issues.length} warning(s) — non-critical, AIQA will still run:\n   ${issues.join("\n   ")}\n`);
    }
  });

// ── import ────────────────────────────────────────────────────────────────────

program
  .command("import")
  .description("Import test cases from Excel, CSV, or Gherkin and generate AIQA YAML files")
  .requiredOption("--file <path>",    "Source file (.xlsx, .xls, .csv, .feature, .txt)")
  .option("--sheet <name>",           "Excel sheet name (default: first sheet)")
  .option("--out <dir>",              "Output directory for generated YAML files (default: ./imported-tests)")
  .option("--tags <tags>",            "Comma-separated tags to add to generated tests (default: imported)")
  .option("--run",                    "Execute generated tests immediately after import")
  .option("--workers <n>",            "Workers for --run (default: from env config)")
  .option("--headless",               "Headless mode for --run")
  .option("--report",                 "Write import-report.json to the output directory")
  .action(async (opts: {
    file: string; sheet?: string; out?: string; tags?: string;
    run?: boolean; workers?: string; headless?: boolean; report?: boolean;
  }) => {
    const config  = cfg();
    const srcFile = path.resolve(process.cwd(), opts.file);
    const outDir  = path.resolve(process.cwd(), opts.out ?? "imported-tests");
    const tags    = opts.tags ? opts.tags.split(",").map(t => t.trim()).filter(Boolean) : ["imported"];

    if (!fs.existsSync(srcFile)) {
      console.error(`❌ File not found: ${srcFile}`);
      process.exit(1);
    }

    console.log(`\n📥 AIQA Import  [env: ${config.environment}]`);
    console.log(`   Source : ${srcFile}`);
    if (opts.sheet) console.log(`   Sheet  : ${opts.sheet}`);
    console.log(`   Out    : ${outDir}`);
    console.log(`   Tags   : [${tags.join(", ")}]`);
    console.log(`─────────────────────────────────────────\n`);

    const orchestrator = new ImportOrchestrator();
    let results;
    try {
      results = await orchestrator.run(srcFile, { outDir, sheetName: opts.sheet, tags });
    } catch (err) {
      console.error(`❌ Import failed: ${(err as Error).message}`);
      process.exit(1);
    }

    let totalWarnings = 0;
    for (const r of results) {
      const status   = r.validated ? "✅" : "⚠️ ";
      const tagLabel = `[${tags.join(", ")}]`;
      console.log(`  ${status} ${r.testCase.name}  ${tagLabel}`);
      console.log(`      → ${r.yamlPath}`);
      for (const w of r.warnings) {
        console.log(`      ⚠️  ${w}`);
        totalWarnings++;
      }
    }

    const valid   = results.filter(r => r.validated).length;
    const invalid = results.length - valid;

    console.log(`\n─────────────────────────────────────────`);
    console.log(`   Imported : ${results.length}`);
    console.log(`   Valid    : ${valid}`);
    console.log(`   Invalid  : ${invalid}${invalid ? `  → ${outDir}/failed/` : ""}`);
    if (totalWarnings) console.log(`   Warnings : ${totalWarnings}`);
    console.log(`   Saved    : ${outDir}/`);
    console.log(`─────────────────────────────────────────`);

    if (opts.report) {
      const reportFile = path.join(outDir, "import-report.json");
      const report = {
        timestamp: new Date().toISOString(),
        source:    srcFile,
        outDir,
        tags,
        summary:   { total: results.length, valid, invalid, warnings: totalWarnings },
        results:   results.map(r => ({
          name:      r.testCase.name,
          yamlPath:  r.yamlPath,
          validated: r.validated,
          warnings:  r.warnings,
        })),
      };
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
      console.log(`   Report   : ${reportFile}`);
    }
    console.log();

    if (opts.run) {
      const validFiles = results.filter(r => r.validated).map(r => r.yamlPath);
      if (validFiles.length === 0) {
        console.error("❌ No valid test files to run.");
        process.exit(1);
      }

      console.log(`\n🚀 Running ${validFiles.length} imported test(s)...\n`);

      const workers       = opts.workers ? Math.max(1, parseInt(opts.workers, 10)) : config.execution.workers;
      const headless      = opts.headless ?? config.execution.headless;
      const runnerOpts    = { headless, timeout: config.timeouts.action };

      const orderedImport: (Awaited<ReturnType<TestRunner["run"]>> | null)[] = new Array(validFiles.length).fill(null);
      let importCursor = 0;
      const runSlot = async () => {
        while (importCursor < validFiles.length) {
          const idx  = importCursor++;
          const file = validFiles[idx];
          const testDef = parseTestFile(file);
          orderedImport[idx] = await new TestRunner(runnerOpts).run(testDef);
        }
      };
      await Promise.all(Array.from({ length: workers }, runSlot));
      const allResults = orderedImport.filter((r): r is NonNullable<typeof r> => r !== null);

      const passed = allResults.filter(r => r.passed).length;
      const failed = allResults.length - passed;

      const reportPath = path.join(outDir, "report.html");
      new HTMLReporter().generate(allResults, reportPath, { baseUrl: opts.file });

      console.log(`─────────────────────────────────────────`);
      console.log(`   Passed : ${passed}   Failed: ${failed}`);
      console.log(`   HTML  → ${reportPath}`);
      console.log(`─────────────────────────────────────────\n`);

      process.exit(failed > 0 ? 1 : 0);
    }
  });

// ── orchestrate ───────────────────────────────────────────────────────────────

program
  .command("orchestrate")
  .description("Full pipeline: explore → map flows → generate → run → score")
  .requiredOption("--url <url>",   "Target URL to explore and test")
  .option("--max-pages <n>",       "Max pages to crawl (default: from env config)")
  .option("--headless",            "Run browser in headless mode")
  .option("--dry-run",             "Explore, map flows and generate scenarios without running tests")
  .option("--out <dir>",           "Write exploration.json, flows.json, YAMLs and report here")
  .option("--report <path>",       "Path for HTML report (default: <out>/report.html)")
  .option("--allure [dir]",        "Generate Allure JSON results (default dir: allure-results/)")
  .option("--slack",               "Post run summary to Slack (reads SLACK_WEBHOOK_URL from env)")
  .option("--email <recipients>",  "Email HTML report to comma-separated addresses (reads SMTP_* from env)")
  .action(async (opts: {
    url:       string;
    maxPages?: string;
    headless?: boolean;
    dryRun?:   boolean;
    out?:      string;
    report?:   string;
    allure?:   string | boolean;
    slack?:    boolean;
    email?:    string;
  }) => {
    const { OrchestratorAgent } = await import("./agents/OrchestratorAgent");
    const config = cfg();

    const url        = opts.url;
    const outRoot    = opts.out ? path.resolve(process.cwd(), opts.out) : null;
    const reportPath = opts.report
      ? path.resolve(process.cwd(), opts.report)
      : outRoot ? path.join(outRoot, "report.html") : null;

    if (outRoot) fs.mkdirSync(outRoot, { recursive: true });

    console.log(`\naiqa orchestrate  [env: ${config.environment}]  →  ${url}`);
    if (opts.dryRun) console.log(`  (dry run — execution skipped)`);
    console.log();

    const result = await new OrchestratorAgent().run({
      url,
      env:      config.environment,
      maxPages: opts.maxPages ? Number(opts.maxPages) : config.execution.maxPages,
      headless: opts.headless ?? config.execution.headless,
      timeout:  config.timeouts.action,
      outDir:   outRoot ?? undefined,
      dryRun:   opts.dryRun,
      onProgress: (stage: number, total: number, message: string) => {
        console.log(`[${stage}/${total}] ${message}`);
      },
    });

    // Persist artifacts (exploration and flows present on success + dry-run)
    if (outRoot && result.exploration) {
      const explorationPath = path.join(outRoot, "exploration.json");
      fs.writeFileSync(explorationPath, JSON.stringify(result.exploration, null, 2));
      console.log(`\n   Exploration → ${explorationPath}`);
    }
    if (outRoot && result.flows) {
      const flowsPath = path.join(outRoot, "flows.json");
      fs.writeFileSync(flowsPath, JSON.stringify(result.flows, null, 2));
      console.log(`   Flows       → ${flowsPath}`);
    }
    if (outRoot && result.scenarios) {
      const yamlDir = path.join(outRoot, "tests");
      fs.mkdirSync(yamlDir, { recursive: true });
      for (const s of result.scenarios) {
        if (s.validated) {
          const yPath = path.join(yamlDir, `${s.fileName}.yaml`);
          fs.writeFileSync(yPath, s.yaml);
          warnLargeFile(yPath, Buffer.byteLength(s.yaml, "utf-8"));
        }
      }
      console.log(`   Tests       → ${yamlDir}/ (${result.scenarios.filter(s => s.validated).length} files)`);
    }
    if (outRoot) {
      console.log(`   Summary     → ${path.join(outRoot, "orchestrator-summary.json")}`);
    }

    // HTML report (skipped on dry-run)
    if (reportPath && !opts.dryRun && result.results.length > 0) {
      new HTMLReporter().generate(result.results, reportPath, { baseUrl: url });
      console.log(`   Report      → ${reportPath}`);
    }

    // Allure results
    if (opts.allure !== undefined && result.results.length > 0) {
      const allureDir = typeof opts.allure === "string"
        ? path.resolve(process.cwd(), opts.allure)
        : outRoot ? path.join(outRoot, "allure-results") : path.resolve(process.cwd(), "allure-results");
      new AllureReporter().generate(result.results, allureDir);
      console.log(`   Allure      → ${allureDir}`);
    }

    // Trend tracking
    if (outRoot && result.results.length > 0 && result.report) {
      const tracker = new TrendTracker(path.join(outRoot, "results"), config.storage.maxHistory);
      tracker.append({
        runId:      result.runId,
        date:       new Date().toISOString(),
        passed:     result.summary.passed,
        failed:     result.summary.failed,
        total:      result.summary.scenarios,
        score:      result.summary.score,
        grade:      result.summary.grade,
        durationMs: result.summary.timings.test_runner ?? 0,
        url,
      });
      const trendLine = tracker.formatTrend();
      if (trendLine) console.log(trendLine);
    }

    // Slack notification
    if (opts.slack && result.results.length > 0) {
      const slack = SlackNotifier.fromEnv();
      if (slack) {
        await slack.send({
          runId:      result.runId,
          passed:     result.summary.passed,
          failed:     result.summary.failed,
          total:      result.summary.scenarios,
          score:      result.summary.score,
          grade:      result.summary.grade,
          durationMs: result.summary.timings.test_runner ?? 0,
          baseUrl:    url,
          reportUrl:  undefined,
        }).catch(e => console.warn(`   ⚠️  Slack notification failed: ${e.message}`));
        console.log(`   Slack       → sent`);
      } else {
        console.warn(`   ⚠️  --slack set but SLACK_WEBHOOK_URL is not in env`);
      }
    }

    // Email notification
    if (opts.email && result.results.length > 0) {
      const recipients = opts.email.split(",").map(s => s.trim()).filter(Boolean);
      const mailer = EmailNotifier.fromEnv(recipients);
      if (mailer) {
        await mailer.send({
          runId:      result.runId,
          passed:     result.summary.passed,
          failed:     result.summary.failed,
          total:      result.summary.scenarios,
          score:      result.summary.score,
          grade:      result.summary.grade,
          durationMs: result.summary.timings.test_runner ?? 0,
          baseUrl:    url,
          reportPath: reportPath ?? undefined,
        }).catch(e => console.warn(`   ⚠️  Email notification failed: ${e.message}`));
        console.log(`   Email       → sent to ${recipients.join(", ")}`);
      } else {
        console.warn(`   ⚠️  --email set but SMTP_HOST is not in env`);
      }
    }

    // Warnings
    if (result.summary.warnings.length > 0) {
      console.log(`\n   Warnings: ${result.summary.warnings.length}`);
      result.summary.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
    }

    // Stage timings
    const t = result.summary.timings;
    const timingParts: string[] = [];
    if (t.explorer            !== undefined) timingParts.push(`Explorer: ${(t.explorer / 1000).toFixed(1)}s`);
    if (t.flow_mapper         !== undefined) timingParts.push(`Flows: ${(t.flow_mapper / 1000).toFixed(1)}s`);
    if (t.scenario_generator  !== undefined) timingParts.push(`Gen: ${(t.scenario_generator / 1000).toFixed(1)}s`);
    if (t.test_runner         !== undefined) timingParts.push(`Run: ${(t.test_runner / 1000).toFixed(1)}s`);
    if (t.scorer              !== undefined) timingParts.push(`Score: ${(t.scorer / 1000).toFixed(1)}s`);
    if (timingParts.length > 0) console.log(`\n   Timings: ${timingParts.join("  ·  ")}`);

    const seeded = result.summary.seededSelectors ?? 0;
    if (seeded > 0) {
      console.log(`   Memory reuse: seeded selectors: ${seeded}  ·  heals avoided: ${seeded}`);
    }

    // Summary
    console.log(`\n${"─".repeat(50)}`);
    if (result.status === "partial_failure") {
      console.log(`❌ Pipeline failed at stage: ${result.failedStage}`);
      console.log(`   Error: ${result.error?.message}`);
    } else if (result.status === "dry_run") {
      console.log(`✅ Dry run complete`);
      console.log(`   Flows: ${result.summary.flows}  ·  Scenarios: ${result.summary.scenarios} (${result.summary.valid} valid)`);
    } else {
      const icon = result.status === "success_with_warnings" ? "⚠️ " : "✅";
      if (result.narrative) console.log(result.narrative);
      console.log(`${icon} Score: ${result.summary.score}/100  Grade: ${result.summary.grade}  ` +
        `Passed: ${result.summary.passed}/${result.summary.scenarios}`);
      if (result.report?.topIssues.length) {
        console.log(`Issues: ${result.report.topIssues.join("  ·  ")}`);
      }
      if (result.report?.recommendation) {
        console.log(`Recommendation: ${result.report.recommendation}`);
      }
    }
    console.log(`   Run ID: ${result.runId}`);
    console.log(`${"─".repeat(50)}\n`);

    if (result.analytics) {
      const analyticsText = HealerAnalytics.format(result.analytics);
      if (analyticsText) console.log(analyticsText);
    }

    // exit 2 = pipeline failure, exit 1 = test failures, exit 0 = success / warnings
    if (result.status === "partial_failure") process.exit(2);
    if (result.summary.failed > 0) process.exit(1);
    process.exit(0);
  });

// ── knowledge ─────────────────────────────────────────────────────────────────

const knowledgeCmd = program.command("knowledge").description("RAG Knowledge Layer — ingest and query organisational knowledge");

knowledgeCmd
  .command("ingest")
  .description("Ingest Jira stories and defects into the local knowledge index")
  .option("--jira <projectKey>", "Jira project key (overrides knowledge.connectors in config)")
  .action(async (opts: { jira?: string }) => {
    const config    = cfg();
    const apiToken  = process.env.JIRA_API_TOKEN;
    const jiraCfg   = config.jira;
    const knowledgeCfg = config.knowledge;
    const indexPath = knowledgeCfg.indexPath;
    const metaPath  = path.join(indexPath, "meta.json");

    if (!apiToken)        { console.error("❌ JIRA_API_TOKEN not set in .env"); process.exit(1); }
    if (!jiraCfg?.baseUrl || !jiraCfg?.email) {
      console.error("❌ jira.baseUrl and jira.email must be set in config");
      process.exit(1);
    }

    const projectKey = opts.jira ?? knowledgeCfg.connectors.find(c => c.type === "jira")?.projectKey ?? jiraCfg.projectKey;
    if (!projectKey) { console.error("❌ No Jira project key — use --jira <key> or set knowledge.connectors in config"); process.exit(1); }

    const { KnowledgeStore }    = await import("./knowledge/KnowledgeStore");
    const { KnowledgeIngester } = await import("./knowledge/KnowledgeIngester");
    const { JiraConnector }     = await import("./knowledge/connectors/JiraConnector");
    const { HealthScorer }      = await import("./knowledge/HealthScorer");

    console.log(`\n🧠 AIQA Knowledge Ingest  [env: ${config.environment}]`);
    console.log(`   Project : ${projectKey}`);
    console.log(`   Index   : ${indexPath}`);
    console.log(`─────────────────────────────────────────\n`);

    // Build chunker based on config
    const chunkerType = knowledgeCfg.chunker;
    const chunker = chunkerType === "ac-aware"
      ? new (await import("./knowledge/chunkers/ACChunker")).ACChunker()
      : new (await import("./knowledge/chunkers/NaiveChunker")).NaiveChunker();

    // Build reranker based on config
    const ingestSourceWeights: Record<string, number> = {};
    for (const c of knowledgeCfg.connectors) {
      if (c.weight !== undefined) ingestSourceWeights[c.type] = c.weight;
    }
    const ingestReranker = knowledgeCfg.reranker === "hybrid"
      ? new (await import("./knowledge/rerankers/HybridReranker")).HybridReranker(ingestSourceWeights)
      : undefined;

    const store     = new KnowledgeStore({ indexPath, reranker: ingestReranker });
    const jiraConnCfg = knowledgeCfg.connectors.find(c => c.type === "jira");
    const acField   = jiraConnCfg?.acField;
    const connector = new JiraConnector({ baseUrl: jiraCfg.baseUrl!, email: jiraCfg.email!, apiToken, projectKey: projectKey!, acField, chunker });
    const ingester  = new KnowledgeIngester({ store, metaPath, connectors: [connector] });

    const spin = new Spinner();
    spin.start("Fetching from Jira and embedding chunks…");
    try {
      const meta   = await ingester.run();
      spin.stop();
      const health = new HealthScorer().score(meta);
      console.log(`✅ Ingested ${meta.totalChunks} chunks from ${meta.sources.length} source(s)`);
      meta.sources.forEach(s => console.log(`   ${s.name.padEnd(14)} ${s.chunks} chunks`));
      console.log(`\n   Health : ${health.status}  —  ${health.message}`);
      console.log(`   Index  → ${indexPath}\n`);
    } catch (err) {
      spin.stop();
      console.error(`❌ Ingest failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

knowledgeCmd
  .command("status")
  .description("Show knowledge index health, chunk count, and source breakdown")
  .action(async () => {
    const config   = cfg();
    const metaPath = path.join(config.knowledge.indexPath, "meta.json");

    const { KnowledgeIngester } = await import("./knowledge/KnowledgeIngester");
    const { HealthScorer }      = await import("./knowledge/HealthScorer");

    const meta = KnowledgeIngester.readMetaFrom(metaPath);
    const health   = new HealthScorer().score(meta);

    console.log(`\n🧠 AIQA Knowledge Status  [env: ${config.environment}]`);
    console.log(`─────────────────────────────────────────`);
    console.log(`   Status  : ${health.status}`);
    console.log(`   Chunks  : ${health.totalChunks}`);
    console.log(`   Age     : ${health.ageDays !== null ? `${health.ageDays} day(s)` : "—"}`);
    if (health.sources.length > 0) {
      console.log(`   Sources :`);
      health.sources.forEach(s => console.log(`     ${s.name.padEnd(14)} ${s.chunks} chunks`));
    }
    console.log(`\n   ${health.message}`);
    console.log(`─────────────────────────────────────────\n`);
  });

// ── serve ─────────────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the AIQA REST + WebSocket API server")
  .option("--port <n>",  "Port to listen on (default: 7432 or AIQA_PORT env var)")
  .option("--env <env>", "Environment name (default: dev)")
  .action(async (opts: { port?: string; env?: string }) => {
    const { startServer } = await import("./server");
    await startServer({
      port: opts.port ? parseInt(opts.port, 10) : undefined,
      env:  opts.env,
    });
    // Keep process alive
    process.on("SIGINT",  () => { console.log("\nShutting down..."); process.exit(0); });
    process.on("SIGTERM", () => { console.log("\nShutting down..."); process.exit(0); });
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command("list [dir]")
  .description("List all YAML test files in a directory with name, tags and step count")
  .option("--out <folder>", "Project folder — lists tests from <folder>/tests/")
  .action((dir: string | undefined, opts: { out?: string }) => {
    const outRoot  = opts.out ? path.resolve(process.cwd(), opts.out) : undefined;
    const testsDir = dir
      ? path.resolve(process.cwd(), dir)
      : outRoot
        ? path.join(outRoot, "tests")
        : process.cwd();

    let files: string[];
    try {
      files = fs.readdirSync(testsDir)
        .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
        .sort()
        .map(f => path.join(testsDir, f));
    } catch {
      console.error(`❌ Cannot read directory: ${testsDir}`);
      console.error(`   Check the path exists or use --out <project-folder>`);
      process.exit(1);
    }

    if (files.length === 0) {
      console.log(`\nNo YAML test files found in: ${testsDir}`);
      console.log(`   Create one with: aiqa init <project>  or write a test.yaml manually.\n`);
      return;
    }

    // Column widths
    const COL_NAME = 36, COL_TAGS = 26, COL_STEPS = 6;
    const header = [
      "Name".padEnd(COL_NAME),
      "Tags".padEnd(COL_TAGS),
      "Steps".padStart(COL_STEPS),
      "File",
    ].join("  ");
    const divider = "─".repeat(header.length);

    console.log(`\n${files.length} test(s) in ${testsDir}\n`);
    console.log(header);
    console.log(divider);

    let parsed = 0, errCount = 0;
    for (const f of files) {
      try {
        const def  = parseTestFile(f);
        const name = def.name.length > COL_NAME ? def.name.slice(0, COL_NAME - 1) + "…" : def.name;
        const tags = (def.tags ?? []).join(", ");
        const tagsStr = tags.length > COL_TAGS ? tags.slice(0, COL_TAGS - 1) + "…" : tags;
        console.log([
          name.padEnd(COL_NAME),
          tagsStr.padEnd(COL_TAGS),
          String(def.steps.length).padStart(COL_STEPS),
          `  ${path.relative(process.cwd(), f)}`,
        ].join("  "));
        parsed++;
      } catch (err) {
        const rel = path.relative(process.cwd(), f);
        console.log(`${"(parse error)".padEnd(COL_NAME)}  ${"".padEnd(COL_TAGS)}  ${"?".padStart(COL_STEPS)}  ${rel}  ⚠`);
        errCount++;
      }
    }

    console.log(divider);
    console.log(`${parsed} parseable  ${errCount > 0 ? `${errCount} with errors` : ""}\n`.trim() + "\n");
  });

// ── config validate ───────────────────────────────────────────────────────────

program
  .command("config validate")
  .description("Validate the current environment config and print all resolved values")
  .option("--env <env>", "Environment name (default: AIQA_ENV or 'dev')")
  .action((opts: { env?: string }) => {
    const env = opts.env ?? process.env.AIQA_ENV ?? "dev";
    console.log(`\n🔧 AIQA Config Validate  [env: ${env}]`);
    console.log(`─────────────────────────────────────────`);

    let config: ReturnType<typeof cfg>;
    try {
      resetConfig();
      config = loadConfig(env);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`❌ Config invalid:\n   ${msg.replace(/\n/g, "\n   ")}`);
      console.error(`\n   Fix: edit config/environments/${env}.yaml and re-run: aiqa config validate`);
      process.exit(1);
    }

    const print = (key: string, val: unknown) =>
      console.log(`   ${key.padEnd(30)} ${JSON.stringify(val)}`);

    print("environment",              config.environment);
    print("urls.base",                config.urls.base);
    print("urls.api",                 config.urls.api);
    print("execution.workers",        config.execution.workers);
    print("execution.headless",       config.execution.headless);
    print("execution.retries",        config.execution.retries);
    print("execution.circuitBreaker", config.execution.circuitBreaker);
    print("timeouts.action",          config.timeouts.action);
    print("timeouts.navigation",      config.timeouts.navigation);
    print("screenshots.onFailure",    config.screenshots.onFailure);
    print("screenshots.dir",          config.screenshots.dir);
    print("llm.provider",             config.llm.provider);
    print("features.llmEnabled",      config.features.llmEnabled);
    if (config.jira?.baseUrl) {
      print("jira.baseUrl",           config.jira.baseUrl);
      print("jira.projectKey",        config.jira.projectKey);
    }
    console.log(`─────────────────────────────────────────`);
    console.log(`✅ Config is valid.\n`);
  });

// ── completion ────────────────────────────────────────────────────────────────

program
  .command("completion [shell]")
  .description("Print shell completion script. Supported: bash, zsh (default: bash)")
  .action((shell: string | undefined) => {
    const sh = (shell ?? "bash").toLowerCase();
    const cmds = [
      "init", "run", "run-all", "explore", "generate", "score",
      "list", "doctor", "config validate", "import", "orchestrate", "serve",
      "jira-sync", "completion", "help",
    ].join(" ");

    if (sh === "bash") {
      console.log(`# Add to ~/.bashrc:\n# eval "$(aiqa completion bash)"\n`);
      console.log(`_aiqa_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=($(compgen -W "${cmds}" -- "$cur"))
}
complete -F _aiqa_completion aiqa`);
    } else if (sh === "zsh") {
      console.log(`# Add to ~/.zshrc:\n# eval "$(aiqa completion zsh)"\n`);
      console.log(`#compdef aiqa
_aiqa() {
  local -a cmds
  cmds=(${cmds.split(" ").map(c => `'${c}'`).join(" ")})
  _describe 'command' cmds
}
compdef _aiqa aiqa`);
    } else {
      console.error(`❌ Unsupported shell: ${sh}. Supported: bash, zsh`);
      process.exit(1);
    }
  });

program.parse(process.argv);
