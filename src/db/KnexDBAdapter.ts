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

  constructor(connectionString: string, private readonly readOnly = true) {
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
    const ro = this.readOnly;
    this.knex = knexFactory({
      client: "pg",
      connection: connectionString,
      pool: {
        min:                   2,
        max:                   10,
        // Surface pool exhaustion as a clear error rather than an opaque hang
        acquireTimeoutMillis:  30_000,
        idleTimeoutMillis:     600_000,
        // Enforce read-only at the connection level when configured — prevents destructive
        // queries even if the DSL author passes a DROP/DELETE/UPDATE statement.
        afterCreate: (
          conn: { query: (sql: string, cb: (err: Error | null) => void) => void },
          done: (err: Error | null, conn: unknown) => void,
        ) => {
          if (ro) {
            conn.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY", err => done(err, conn));
          } else {
            done(null, conn);
          }
        },
      },
    });
    // Diagnostic: log pool config once at init so operator can correlate with worker count.
    // Set AIQA_WORKERS env var (or pass --workers to the CLI) for accurate worker visibility.
    const workers = process.env.AIQA_WORKERS ?? "?";
    process.stdout.write(`[DB] pool config: min=2, max=10, workers=${workers}\n`);
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (this.closed) {
      throw new Error("KnexDBAdapter: cannot query — connection pool has been closed.");
    }
    let result: { rows: unknown };
    try {
      result = await this.knex.raw(sql, params ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // tarn / generic-pool both surface exhaustion as a timeout message
      if (/timeout/i.test(msg) && /pool/i.test(msg)) {
        throw new Error(
          `KnexDBAdapter: DB connection pool exhausted (acquireTimeout=30s). ` +
          `Reduce parallel workers or increase pool.max (currently 10).`
        );
      }
      throw err;
    }
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
