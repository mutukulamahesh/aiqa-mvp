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
    provider: z.enum(["anthropic", "openai", "nvidia", "gemini", "mock"]).default("mock"),
    fallback: z.array(z.enum(["anthropic", "openai", "nvidia", "gemini", "mock"])).default([]),
    model:    z.string().optional(),
  }).default({ provider: "mock", fallback: [] }),

  db: z.object({
    readOnly: z.boolean().default(true),
  }).default({ readOnly: true }),

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

export function loadConfig(env: string = "dev"): EnvConfig {
  if (_loaded) return _loaded;

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

  if (configuredProvider && configuredProvider !== "mock") {
    // Explicit provider selected — check its key
    const required = KEY_MAP[configuredProvider];
    if (required && !process.env[required]) {
      missing.push(`${required} is required for provider "${configuredProvider}"`);
    }
  } else if (!configuredProvider) {
    // Auto-detect mode — warn if no key at all (will silently use mock)
    const hasAny = Object.values(KEY_MAP).some(k => process.env[k]);
    if (!hasAny) {
      missing.push("No LLM API key found — healer and debugger will use mock provider");
    }
  }

  if (process.env["JIRA_API_TOKEN"] && !process.env["JIRA_EMAIL"]) {
    warnings.push("JIRA_API_TOKEN set but JIRA_EMAIL missing — Jira integration will fail");
  }

  return { missing, warnings };
}
