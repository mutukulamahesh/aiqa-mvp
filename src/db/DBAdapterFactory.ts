import { DBAdapter } from "./DBAdapter";
import { MockDBAdapter } from "./MockDBAdapter";

export function createDBAdapter(readOnly = true): DBAdapter {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) return new MockDBAdapter();

  if (dbUrl.startsWith("sqlite://")) {
    const source = dbUrl.slice("sqlite://".length);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SqliteDBAdapter } = require("./SqliteDBAdapter") as typeof import("./SqliteDBAdapter");
    return new SqliteDBAdapter(source, readOnly);
  }

  // PostgreSQL via Knex — only loaded when DB_URL is a postgres:// connection string.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KnexDBAdapter } = require("./KnexDBAdapter") as typeof import("./KnexDBAdapter");
  return new KnexDBAdapter(dbUrl, readOnly);
}
