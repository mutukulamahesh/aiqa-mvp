import * as fs   from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// ── Schema ────────────────────────────────────────────────────────────────────

const EnvConfigSchema = z.object({
  environment: z.enum(["dev", "staging", "prod"]),

  urls: z.object({
    base: z.url("urls.base must be a valid URL"),
    api:  z.url("urls.api must be a valid URL"),
  }),

  timeouts: z.object({
    action:     z.number().int().positive(),
    navigation: z.number().int().positive(),
    api:        z.number().int().positive(),
  }),

  execution: z.object({
    workers:        z.number().int().min(1),
    retries:        z.number().int().min(0),
    headless:       z.boolean(),
    maxPages:       z.number().int().positive(),
    maxDepth:       z.number().int().positive(),
    circuitBreaker: z.number().int().min(1),  // abort suite after N consecutive failures
  }),

  screenshots: z.object({
    onFailure: z.boolean(),
    dir:       z.string(),
  }),

  results: z.object({
    dir: z.string(),
  }),

  features: z.object({
    llmEnabled: z.boolean(),
  }),

  llm: z.object({
    provider: z.enum(["anthropic", "openai", "nvidia", "gemini", "ollama", "mock"]).default("mock"),
    fallback: z.array(z.enum(["anthropic", "openai", "nvidia", "gemini", "ollama", "mock"])).default([]),
    model:    z.string().optional(),
  }).default({ provider: "mock", fallback: [] }),

  // Named LLM targets for llm_eval / llm_consistency steps.
  // Allows test YAML to reference "target: fast" instead of hardcoding provider/model.
  // Each target is independent of the internal AIQA judge LLM (llm.provider above).
  llm_targets: z.record(
    z.string(),
    z.object({
      provider: z.enum(["anthropic", "openai", "nvidia", "gemini", "ollama", "mock"]),
      model:    z.string().optional(),
      baseUrl:  z.string().optional(),  // for ollama: override default localhost:11434
    })
  ).default({}),

  db: z.object({
    readOnly: z.boolean().default(true),
  }).default({ readOnly: true }),

  storage: z.object({
    maxHistory:   z.number().int().positive().default(200), // entries kept in history.json + healer-runs.json
    maxArtifacts: z.number().int().positive().default(10),  // run artifact sets retained by --retain-runs
  }).default({ maxHistory: 200, maxArtifacts: 10 }),

  // api security — empty allowlist blocks ALL outbound api: calls; denylist is always checked first.
  api: z.object({
    allowlist: z.array(z.string()).default([]),  // URL prefixes that are permitted (empty = block all)
    denylist:  z.array(z.string()).default([]),  // URL prefixes that are always blocked
  }).default({ allowlist: [], denylist: [] }),

  // Jira integration — API token stays in .env as JIRA_API_TOKEN (never commit it here).
  jira: z.object({
    baseUrl:                z.string().optional(),   // e.g. "https://aiqajira.atlassian.net"
    projectKey:             z.string().optional(),   // e.g. "AIQA"
    email:                  z.string().email().optional(),
    createDefectsOnFailure: z.boolean().default(false),
    xraySyncEnabled:        z.boolean().default(false),
    testPlanKey:            z.string().optional(),   // Xray test plan issue key
  }).optional(),

  // knowledge — RAG Knowledge Layer config (opt-in; disabled by default).
  knowledge: z.object({
    enabled:   z.boolean().default(false),
    indexPath: z.string().default(".aiqa/knowledge"),
    topK:      z.number().int().min(1).default(5),
    chunker: z.enum(["naive", "ac-aware"]).default("naive"),
    reranker: z.object({
      strategy:       z.enum(["cosine", "hybrid"]).default("cosine"),
      semanticWeight: z.number().min(0).max(1).default(0.6),
      recencyWeight:  z.number().min(0).max(1).default(0.2),
      severityWeight: z.number().min(0).max(1).default(0.1),
      sourceWeight:   z.number().min(0).max(1).default(0.1),
    }).default({ strategy: "cosine", semanticWeight: 0.6, recencyWeight: 0.2, severityWeight: 0.1, sourceWeight: 0.1 }),
    connectors: z.array(z.object({
      type:         z.string(),
      projectKey:   z.string().optional(),
      acField:      z.string().optional(),
      spaceKey:     z.string().optional(),
      url:          z.string().optional(),
      weight:       z.number().positive().optional(),
      lookbackDays: z.number().int().positive().optional(),  // git connector
    })).default([]),
    // RAG3-03: token-aware budget — prevents context explosion with large indexes
    budget: z.object({
      maxChunks:       z.number().int().min(1).default(20),
      maxTokensApprox: z.number().int().min(1).default(4000),
    }).optional(),
  }).default({ enabled: false, indexPath: ".aiqa/knowledge", topK: 5, chunker: "naive", reranker: { strategy: "cosine", semanticWeight: 0.6, recencyWeight: 0.2, severityWeight: 0.1, sourceWeight: 0.1 }, connectors: [] }),

  // LOCAL-04: block all outbound LLM calls — only "ollama" and "mock" are permitted when true.
  privacy_mode: z.boolean().default(false),

  // db_schema — optional route→table hints used by FlowMapper to suggest db: validation steps.
  // Keys are route prefixes (e.g. "/api/users"); values declare the target table and primary key.
  // Omitting this section disables DB suggestion entirely — no runtime effect otherwise.
  db_schema: z.record(
    z.string(),
    z.object({
      table:  z.string(),
      pk:     z.string().default("id"),
      method: z.array(z.enum(["POST", "PUT", "PATCH", "DELETE"])).default(["POST", "PUT", "PATCH", "DELETE"]),
    })
  ).optional(),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;

// ── Loader ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.resolve(process.cwd(), "config", "environments");

let _loaded: EnvConfig | null = null;

// Node.js is single-threaded: the _loaded check and assignment below cannot race
// within one process. If worker_threads are introduced, each thread has its own
// module scope and its own _loaded — this remains safe per-thread.
export function loadConfig(env: string = "dev"): EnvConfig {
  if (_loaded) {
    if (_loaded.environment !== env) {
      throw new Error(
        `Config already loaded for "${_loaded.environment}" — cannot reload for "${env}" in the same process. Call resetConfig() first.`
      );
    }
    return _loaded;
  }

  const filePath = path.join(CONFIG_DIR, `${env}.yaml`);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Config file not found: ${filePath}\n` +
      `Available environments: ${availableEnvs().join(", ")}`
    );
  }

  const raw = yaml.load(fs.readFileSync(filePath, "utf-8"));
  const result = EnvConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config (${env}.yaml):\n${issues}`);
  }

  _loaded = result.data;
  return _loaded;
}

export function getConfig(): EnvConfig {
  if (!_loaded) throw new Error("Config not loaded — call loadConfig(env) first");
  return _loaded;
}

export function resetConfig(): void {
  _loaded = null;
}

export function injectConfig(config: EnvConfig): void {
  _loaded = config;
}

function availableEnvs(): string[] {
  if (!fs.existsSync(CONFIG_DIR)) return [];
  return fs.readdirSync(CONFIG_DIR)
    .filter(f => f.endsWith(".yaml"))
    .map(f => f.replace(".yaml", ""));
}

// ── Secrets check ─────────────────────────────────────────────────────────────

export function checkSecrets(): { missing: string[]; warnings: string[] } {
  const missing:  string[] = [];
  const warnings: string[] = [];

  // Determine which provider is active: YAML config → LLM_PROVIDER env → auto-detect
  const configuredProvider = (() => {
    try { return _loaded?.llm?.provider; } catch { return undefined; }
  })() ?? process.env.LLM_PROVIDER;

  const KEY_MAP: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai:    "OPENAI_API_KEY",
    nvidia:    "NVIDIA_API_KEY",
    gemini:    "GEMINI_API_KEY",
  };

  if (configuredProvider && configuredProvider !== "mock" && configuredProvider !== "ollama") {
    // Explicit provider selected — check its key
    const required = KEY_MAP[configuredProvider];
    if (required && !process.env[required]) {
      missing.push(`${required} is required for provider "${configuredProvider}"`);
    }
  } else if (configuredProvider === "ollama") {
    // Ollama needs no API key — runs locally. Warn if OLLAMA_BASE_URL looks wrong.
    const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    warnings.push(`Ollama provider configured — ensure Ollama is running at ${base} and model is pulled`);
  } else if (!configuredProvider) {
    // Auto-detect mode — warn if no key at all (will silently use mock)
    const hasAny = Object.values(KEY_MAP).some(k => process.env[k]);
    if (!hasAny) {
      missing.push("No LLM API key found — healer and debugger will use mock provider");
    }
  }

  const hasJiraToken = !!process.env["JIRA_API_TOKEN"];
  const jiraCfg = _loaded?.jira;

  if (jiraCfg?.baseUrl || jiraCfg?.email || hasJiraToken) {
    if (!jiraCfg?.baseUrl)   warnings.push("jira.baseUrl not set — Jira integration will use mock mode");
    if (!jiraCfg?.email)     warnings.push("jira.email not set — Jira integration will use mock mode");
    if (!jiraCfg?.projectKey)warnings.push("jira.projectKey not set — Jira commands require a project key");
    if (!hasJiraToken)       warnings.push("JIRA_API_TOKEN not set — Jira integration will use mock mode");
  }

  if (hasJiraToken && !jiraCfg?.email) {
    warnings.push("JIRA_API_TOKEN set but jira.email missing in config — Jira integration will fail");
  }

  return { missing, warnings };
}
