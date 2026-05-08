import * as fs   from "fs";
import * as path from "path";
import { Router } from "express";
import multer       from "multer";
import { z }        from "zod";

import { jobStore }     from "../jobs/RunJobStore";
import { RunJob }       from "../jobs/RunJob";
import * as persistence from "../persistence/runPersistence";
import { validate }     from "../middleware/validate";
import { safeResolvePath } from "../middleware/sandbox";
import { RunEvent, RunSummary } from "../../runner/RunEvent";

import { parseTestDefinition, parseTestFile } from "../../dsl/DslParser";
import { TestRunner }           from "../../runner/TestRunner";
import { TestResult }           from "../../runner/TestRunner";
import { AppExplorer }          from "../../agents/AppExplorer";
import { OrchestratorAgent }    from "../../agents/OrchestratorAgent";
import { FlowMapper }           from "../../agents/FlowMapper";
import { ScenarioGenerator }    from "../../agents/ScenarioGenerator";
import { ImportOrchestrator }   from "../../importers/ImportOrchestrator";
import { JiraAdapter, PushResultItem } from "../../integrations/JiraAdapter";
import { getConfig }            from "../../config/ConfigLoader";
import { ExplorationResult }    from "../../agents/AppExplorer";
import { SelectorHealer }       from "../../healer/SelectorHealer";
import { MemoryStore }          from "../../memory/MemoryStore";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Schemas ───────────────────────────────────────────────────────────────────

const RunSchema = z.object({
  content:  z.string().optional(),
  file:     z.string().optional(),
  env:      z.string().default("dev"),
  headless: z.boolean().default(true),
  tags:     z.array(z.string()).optional(),
}).refine(d => d.content || d.file, { message: "Either 'content' or 'file' is required" });

const RunAllSchema = z.object({
  dir:       z.string().default("tests"),
  env:       z.string().default("dev"),
  headless:  z.boolean().default(true),
  workers:   z.number().int().min(1).default(4),
  tags:      z.array(z.string()).optional(),
});

const OrchestrateSchema = z.object({
  url:      z.string().url(),
  env:      z.string().default("dev"),
  headless: z.boolean().default(true),
  maxPages: z.number().int().min(1).optional(),
  timeout:  z.number().int().min(1000).optional(),
  outDir:   z.string().optional(),
});

const ExploreSchema = z.object({
  url:      z.string().url(),
  env:      z.string().default("dev"),
  headless: z.boolean().default(true),
  maxPages: z.number().int().min(1).optional(),
});

const GenerateSchema = z.object({
  explorationId: z.string(),
  outDir:        z.string().optional(),
  perPage:       z.boolean().default(false),
});

const JiraSyncSchema = z.object({
  resultsId:  z.string(),
  projectKey: z.string(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function accept(res: import("express").Response, job: RunJob): void {
  res.status(202).json({ runId: job.meta.runId });
}

function finishJob(job: RunJob, results: TestResult[]): RunSummary {
  const passed  = results.filter(r => r.passed).length;
  const summary = { passed, failed: results.length - passed, total: results.length };
  job.meta.status      = passed === results.length ? "passed" : "failed";
  job.meta.summary     = summary;
  job.meta.completedAt = new Date().toISOString();
  return summary;
}

async function runTestsParallel(
  files: string[],
  opts: { headless: boolean; workers: number; tags?: string[] },
  job: RunJob,
): Promise<TestResult[]> {
  let config: ReturnType<typeof getConfig> | null = null;
  try { config = getConfig(); } catch { /* optional */ }

  const screenshotsDir = path.join(persistence.runDir(job.meta.runId), "screenshots");
  job.meta.screenshotsDir = screenshotsDir;

  const sharedHealer = new SelectorHealer();
  const sharedMemory = new MemoryStore();
  const runnerOpts   = {
    headless:       opts.headless,
    timeout:        config?.timeouts?.action ?? 15_000,
    screenshotsDir,
    healer:         sharedHealer,
    memory:         sharedMemory,
  };

  const results: TestResult[] = new Array(files.length).fill(null);
  const queue = files.map((f, i) => ({ f, i }));
  let testIndex = 0;

  const runSlot = async () => {
    while (queue.length > 0 && !job.cancelled) {
      const item = queue.shift();
      if (!item) break;
      const { f, i } = item;
      testIndex++;

      try {
        const testDef = parseTestFile(f);
        if (opts.tags?.length && !opts.tags.some(t => testDef.tags?.includes(t))) {
          continue;
        }
        const onEvent = (e: RunEvent) => job.emit(e);
        const result  = await new TestRunner({ ...runnerOpts, healer: sharedHealer }).run(testDef, onEvent);
        results[i] = result;
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        results[i] = {
          testId: `err-${i}`, testName: path.basename(f),
          tags: [], passed: false, durationMs: 0, retryCount: 0,
          error: msg, stepResults: [],
        };
        job.emit({ event: "log", message: `Failed to load ${f}: ${msg}` });
      }
    }
  };

  await Promise.all(Array.from({ length: opts.workers }, runSlot));
  return results.filter(Boolean);
}

// ── POST /api/run — single test ───────────────────────────────────────────────

router.post("/run", validate(RunSchema), (req, res) => {
  const body = req.body as z.infer<typeof RunSchema>;
  const job  = jobStore.create("run");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    let content: string;
    if (body.content) {
      content = body.content;
    } else {
      const resolved = safeResolvePath(process.cwd(), body.file!);
      content = await fs.promises.readFile(resolved, "utf-8");
    }

    const testDef = parseTestDefinition(content);
    const screenshotsDir = path.join(persistence.runDir(job.meta.runId), "screenshots");
    job.meta.screenshotsDir = screenshotsDir;

    const runner  = new TestRunner({ headless: body.headless, screenshotsDir });
    const onEvent = (e: RunEvent) => job.emit(e);
    const result  = await runner.run(testDef, onEvent);

    const summary = finishJob(job, [result]);
    job.emit({ event: "done", status: job.meta.status as "passed" | "failed" | "error", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, [result]);
  });
});

// ── POST /api/run-all — full test suite ──────────────────────────────────────

router.post("/run-all", validate(RunAllSchema), async (req, res) => {
  const body = req.body as z.infer<typeof RunAllSchema>;
  const job  = jobStore.create("run-all");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    const testDir = safeResolvePath(process.cwd(), body.dir);
    let files: string[];
    try {
      const entries = await fs.promises.readdir(testDir, { withFileTypes: true });
      files = entries
        .filter(e => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
        .map(e => path.join(testDir, e.name));
    } catch {
      throw new Error(`Cannot read test directory: ${body.dir}`);
    }

    if (files.length === 0) throw new Error(`No YAML test files found in: ${body.dir}`);

    const results = await runTestsParallel(files, { headless: body.headless, workers: body.workers, tags: body.tags }, job);
    const summary = finishJob(job, results);
    job.emit({ event: "done", status: job.meta.status as "passed" | "failed" | "error", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, results);
  });
});

// ── POST /api/orchestrate — full pipeline ────────────────────────────────────

router.post("/orchestrate", validate(OrchestrateSchema), (req, res) => {
  const body = req.body as z.infer<typeof OrchestrateSchema>;
  const job  = jobStore.create("orchestrate");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    const orchestrator = new OrchestratorAgent();
    const result = await orchestrator.run({
      url:      body.url,
      env:      body.env,
      headless: body.headless,
      maxPages: body.maxPages,
      timeout:  body.timeout,
      outDir:   body.outDir,
    });

    const passed  = result.summary.passed;
    const failed  = result.summary.failed;
    const summary = { passed, failed, total: passed + failed };

    const jobPassed = result.status === "success" || result.status === "success_with_warnings" || result.status === "dry_run";
    job.meta.status      = jobPassed ? "passed" : "failed";
    job.meta.summary     = summary;
    job.meta.completedAt = new Date().toISOString();
    job.emit({ event: "done", status: job.meta.status as "passed" | "failed" | "error", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, result);
    if (result.stageResults.explorer) {
      await persistence.writeExploration(job.meta.runId, result.stageResults.explorer);
    }
  });
});

// ── POST /api/explore — exploration only ─────────────────────────────────────

router.post("/explore", validate(ExploreSchema), (req, res) => {
  const body = req.body as z.infer<typeof ExploreSchema>;
  const job  = jobStore.create("explore");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    const explorer = new AppExplorer();
    const result   = await explorer.explore(body.url, {
      headless: body.headless,
      maxPages: body.maxPages,
    });

    job.meta.status      = "passed";
    job.meta.completedAt = new Date().toISOString();
    const summary = { passed: 1, failed: 0, total: 1 };
    job.meta.summary = summary;
    job.emit({ event: "done", status: "passed", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeExploration(job.meta.runId, result);
  });
});

// ── POST /api/generate — generate tests from prior exploration ────────────────

router.post("/generate", validate(GenerateSchema), (req, res) => {
  const body = req.body as z.infer<typeof GenerateSchema>;
  const job  = jobStore.create("generate");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    const exploration = await persistence.readExploration(body.explorationId);
    if (!exploration) throw new Error(`Exploration not found: ${body.explorationId}`);

    const explData  = exploration as unknown as ExplorationResult;
    const mapper    = new FlowMapper();
    const generator = new ScenarioGenerator();

    const flows = body.perPage
      ? mapper.perPageFlows(explData)
      : await mapper.map(explData);

    const scenarios = await generator.generate(flows, explData.baseUrl ?? "");

    const outDir = body.outDir
      ? safeResolvePath(process.cwd(), body.outDir)
      : path.join(persistence.runDir(job.meta.runId), "generated");

    await fs.promises.mkdir(outDir, { recursive: true });

    for (const s of scenarios) {
      await fs.promises.writeFile(path.join(outDir, `${s.fileName}.yaml`), s.yaml);
    }

    job.meta.status      = "passed";
    job.meta.completedAt = new Date().toISOString();
    const summary = { passed: scenarios.length, failed: 0, total: scenarios.length };
    job.meta.summary = summary;
    job.emit({ event: "done", status: "passed", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, { outDir, scenarios: scenarios.map(s => s.fileName) });
  });
});

// ── POST /api/import — import Excel/CSV/Gherkin (multipart) ──────────────────

router.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded — use multipart field 'file'" });
    return;
  }
  const job = jobStore.create("import");
  accept(res, job);

  const buffer   = req.file.buffer;
  const filename = path.basename(req.file.originalname);

  jobStore.enqueue(job, async () => {
    const tmpDir  = path.join(persistence.runDir(job.meta.runId), "import");
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, filename);
    await fs.promises.writeFile(tmpFile, buffer);

    const outDir       = path.join(persistence.runDir(job.meta.runId), "tests");
    const orchestrator = new ImportOrchestrator();
    const result       = await orchestrator.run(tmpFile, { outDir });

    job.meta.status      = "passed";
    job.meta.completedAt = new Date().toISOString();
    const summary = { passed: result.length, failed: 0, total: result.length };
    job.meta.summary = summary;
    job.emit({ event: "done", status: "passed", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, result);
  });
});

// ── POST /api/jira-sync — push run results to Jira ───────────────────────────

router.post("/jira-sync", validate(JiraSyncSchema), (req, res) => {
  const body = req.body as z.infer<typeof JiraSyncSchema>;
  const job  = jobStore.create("jira-sync");
  accept(res, job);

  jobStore.enqueue(job, async () => {
    const results = await persistence.readResults(body.resultsId);
    if (!results) throw new Error(`Results not found for run: ${body.resultsId}`);

    let config: ReturnType<typeof getConfig> | null = null;
    try { config = getConfig(); } catch { /* optional */ }

    const jiraCfg  = config?.jira;
    const apiToken = process.env.JIRA_API_TOKEN;
    const isMock   = !(jiraCfg?.baseUrl && jiraCfg?.email && apiToken);
    if (isMock) {
      job.emit({ event: "log", message: "[jira] no credentials configured — running in mock mode, results not pushed to Jira" });
    }
    const adapter = new JiraAdapter({
      baseUrl:    jiraCfg?.baseUrl,
      email:      jiraCfg?.email,
      apiToken,
      projectKey: body.projectKey,
    });

    const testResults = (Array.isArray(results) ? results : [results]) as import("../../runner/TestRunner").TestResult[];
    const pushItems: PushResultItem[] = testResults.map(r => ({
      testName: r.testName,
      passed:   r.passed,
      error:    r.error,
    }));
    const pushResult  = await adapter.pushResults(pushItems, body.resultsId);

    job.meta.status      = "passed";
    job.meta.completedAt = new Date().toISOString();
    const summary = { passed: 1, failed: 0, total: 1 };
    job.meta.summary = summary;
    job.emit({ event: "done", status: "passed", summary });

    await persistence.writeMeta(job.meta);
    await persistence.writeResults(job.meta.runId, pushResult);
  });
});

export default router;
