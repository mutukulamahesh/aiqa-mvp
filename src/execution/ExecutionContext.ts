/**
 * ExecutionContext — holds the runtime state for a single test run.
 *
 * Responsibilities:
 *   - Store/retrieve named variables (set from DSL or adapter results)
 *   - Resolve {{ variable }} template expressions in strings
 *   - Track current URL (for URL assertions)
 */
export class ExecutionContext {
  private variables: Map<string, unknown> = new Map();

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) {
      this.variables.set(k, v);
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
   * Resolve a template string, replacing {{ var }} with stored values.
   * Example: "Hello {{ name }}!" → "Hello World!" if name = "World"
   * Unknown variables are left as-is.
   */
  resolve(template: string): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = this.variables.get(key);
      if (value === undefined || value === null) return _match; // leave unresolved
      return String(value);
    });
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
