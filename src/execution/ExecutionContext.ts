import { EnvConfig } from "../config/ConfigLoader";

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

  /** Store a value by name */
  set(key: string, value: unknown): void {
    this.variables.set(key, value);
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
      if (value === undefined || value === null) return _match;
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
