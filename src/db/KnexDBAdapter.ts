import { DBAdapter, QueryResult } from "./DBAdapter";

/**
 * PostgreSQL adapter via Knex.js.
 * Only instantiated when DB_URL is set; requires `npm install knex pg`.
 * A single Knex pool is created in the constructor and reused for every query.
 */
export class KnexDBAdapter implements DBAdapter {
  readonly name = "knex-pg";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private knex: any;
  private closed = false;

  constructor(connectionString: string) {
    // Dynamic require so Knex is optional — only needed when DB_URL is set.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let knexFactory: (config: unknown) => unknown;
    try {
      knexFactory = require("knex");
    } catch {
      throw new Error(
        "KnexDBAdapter requires knex: run `npm install knex pg` to enable real DB testing."
      );
    }
    this.knex = knexFactory({
      client: "pg",
      connection: connectionString,
    });
    process.stdout.write(`[DB] Using postgres (knex-pg, pool max=10)\n`);
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (this.closed) {
      throw new Error("KnexDBAdapter: cannot query — connection pool has been closed.");
    }
    const result = await this.knex.raw(sql, params ?? []);
    // Knex wraps pg results; always normalise to a plain rows array.
    const rows: Record<string, unknown>[] = Array.isArray(result.rows) ? result.rows : [];
    return { rows, rowCount: rows.length };
  }

  /** Idempotent — safe to call multiple times. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.knex.destroy();
  }
}
