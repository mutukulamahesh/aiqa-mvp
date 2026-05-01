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
    base: z.string().url("urls.base must be a valid URL"),
    api:  z.string().url("urls.api must be a valid URL"),
  }),

  timeouts: z.object({
    action:     z.number().int().positive(),
    navigation: z.number().int().positive(),
    api:        z.number().int().positive(),
  }),

  execution: z.object({
    workers:  z.number().int().min(1),
    retries:  z.number().int().min(0),
    headless: z.boolean(),
    maxPages: z.number().int().positive(),
    maxDepth: z.number().int().positive(),
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

  if (!process.env["ANTHROPIC_API_KEY"]) {
    missing.push("ANTHROPIC_API_KEY — LLM features will fall back to mock provider");
  }

  if (process.env["JIRA_API_TOKEN"] && !process.env["JIRA_EMAIL"]) {
    warnings.push("JIRA_API_TOKEN set but JIRA_EMAIL missing — Jira integration will fail");
  }

  return { missing, warnings };
}
