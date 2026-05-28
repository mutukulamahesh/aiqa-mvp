import * as fs   from "fs";
import * as path from "path";
import { DBAdapter, QueryResult } from "./DBAdapter";

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require("sql.js") as (opts?: unknown) => Promise<{ Database: new (data?: Uint8Array) => unknown }>;
    const SQL = await initSqlJs();

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
