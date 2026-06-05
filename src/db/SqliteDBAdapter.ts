import * as fs   from "fs";
import * as path from "path";
import { DBAdapter, QueryResult } from "./DBAdapter";

// Module-level singleton — WASM loads once per process, shared across all SqliteDBAdapter instances.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqlJsPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSqlJs(): Promise<any> {
  if (!_sqlJsPromise) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require("sql.js") as (opts?: unknown) => Promise<unknown>;
    _sqlJsPromise = initSqlJs();
  }
  return _sqlJsPromise;
}

export class SqliteDBAdapter implements DBAdapter {
  readonly name = "sqlite";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private readonly filePath: string | null;
  private readonly ready: Promise<void>;

  constructor(source: string, private readonly readOnly = true) {
    this.filePath = source === ":memory:" ? null : path.resolve(source);
    this.ready    = this._init(source);
  }

  private async _init(source: string): Promise<void> {
    const SQL = await getSqlJs();

    if (this.filePath && fs.existsSync(this.filePath)) {
      const buf = fs.readFileSync(this.filePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.db = new (SQL as any).Database(buf);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.db = new (SQL as any).Database();
    }
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    await this.ready;

    if (/^\s*select\b/i.test(sql)) {
      const stmt = this.db.prepare(sql);
      if (params?.length) stmt.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return { rows, rowCount: rows.length };
    }

    if (this.readOnly) {
      throw new Error(
        `SqliteDBAdapter: read-only mode — only SELECT queries are allowed. ` +
        `Got: "${sql.slice(0, 60)}${sql.length > 60 ? "…" : ""}". ` +
        `Construct the adapter with readOnly=false to allow writes.`
      );
    }

    // DML — run without returning rows
    this.db.run(sql, params ?? []);
    return { rows: [], rowCount: 0 };
  }

  async close(): Promise<void> {
    await this.ready;
    if (!this.readOnly && this.filePath) {
      const data: Uint8Array = this.db.export();
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, Buffer.from(data));
    }
    this.db.close();
    this.db = null;
  }

  /** Executes arbitrary SQL against the in-memory database (used by setup scripts). */
  async seed(sql: string): Promise<void> {
    await this.ready;
    this.db.run(sql);
    if (this.filePath) {
      const data: Uint8Array = this.db.export();
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, Buffer.from(data));
    }
  }
}
