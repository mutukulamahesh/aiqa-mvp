import { EnvConfig } from "../config/ConfigLoader";

// Arrays larger than this are trimmed to prevent unbounded memory growth.
// Deliberately above LoopHandler.MAX_ITERATIONS (100) so the loop handler's own
// guard fires first on the stored list (keeps existing test behavior correct).
const MAX_STORED_ARRAY_ITEMS = 1_000;

/**
 * Deep-clones objects/arrays to prevent callers from mutating stored state.
 * Trims oversized arrays so the context map cannot grow unboundedly under large API responses.
 * Non-array objects are cloned as-is — truncating fields would break {{ var.field }} DSL access.
 *
 * Only JSON-serializable values are supported. Non-serializable types (circular
 * references, functions, Symbols) would silently lose data during template resolution,
 * so they are rejected with a clear error.
 */
function storeClamp(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value; // primitives are immutable

  let cloned: unknown;
  try {
    cloned = JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("ExecutionContext: non-serializable value stored via store_as");
  }

  if (Array.isArray(cloned) && (cloned as unknown[]).length > MAX_STORED_ARRAY_ITEMS) {
    return (cloned as unknown[]).slice(0, MAX_STORED_ARRAY_ITEMS);
  }
  return cloned;
}

export class ExecutionContext {
  private variables: Map<string, unknown> = new Map();
  readonly config: EnvConfig | null;

  constructor(initial: Record<string, string> = {}, config: EnvConfig | null = null) {
    this.config = config;
    for (const [k, v] of Object.entries(initial)) {
      this.variables.set(k, v);
    }
    // Expose config values as resolvable template variables
    if (config) {
      this.variables.set("env.base",    config.urls.base);
      this.variables.set("env.api",     config.urls.api);
      this.variables.set("env.name",    config.environment);
    }
  }

  /** Store a value by name — deep-clones objects to prevent mutation leakage. */
  set(key: string, value: unknown): void {
    this.variables.set(key, storeClamp(value));
  }

  /** Retrieve a value by name */
  get(key: string): unknown {
    return this.variables.get(key);
  }

  /**
   * Resolve a template string, replacing {{ var }} and {{ obj.path }} expressions.
   * Dot-notation traverses stored objects: {{ user.address.city }} walks into a
   * stored "user" object. Unknown paths are left as-is.
   */
  resolve(template: string): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = this.getPath(key);
      if (value === undefined || value === null) {
        process.stderr.write(`[warn] Template variable "{{ ${key} }}" is not defined — check your test variables or store_as steps.\n`);
        return _match;
      }
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    });
  }

  /** Walk a dot-separated path into stored variables. */
  private getPath(path: string): unknown {
    const parts = path.split(".");
    let value: unknown = this.variables.get(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      if (value === null || value === undefined || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[parts[i]];
    }
    return value;
  }

  /** Convenience: update the tracked current_url */
  setCurrentUrl(url: string): void {
    this.variables.set("current_url", url);
  }

  getCurrentUrl(): string {
    return (this.variables.get("current_url") as string) ?? "";
  }

  /** Debug dump */
  dump(): Record<string, unknown> {
    return Object.fromEntries(this.variables);
  }
}
