import { DBAdapter, QueryResult } from "./DBAdapter";

/**
 * In-memory DB adapter for testing and CI.
 * Seed it with query→result pairs before running; unmatched queries return empty.
 */
export class MockDBAdapter implements DBAdapter {
  readonly name = "mock";

  private seeds = new Map<string, QueryResult>();

  /**
   * Register a canned result for a query string (exact or substring match).
   * If multiple seeds match, the first registered wins.
   */
  seed(querySubstring: string, result: QueryResult): this {
    this.seeds.set(querySubstring, result);
    return this;
  }

  async query(sql: string, _params?: unknown[]): Promise<QueryResult> {
    for (const [pattern, result] of this.seeds) {
      if (sql.includes(pattern)) return result;
    }
    return { rows: [], rowCount: 0 };
  }

  async close(): Promise<void> {
    // nothing to close
  }
}
