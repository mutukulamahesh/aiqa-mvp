import * as fs   from "fs";
import * as path from "path";

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require("sql.js") as (opts?: unknown) => Promise<{ Database: new (data?: Uint8Array) => unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SQL: any = await initSqlJs();

  const db = new SQL.Database();
  const seedPath = path.join(__dirname, "rwt-seed.sql");
  const sql = fs.readFileSync(seedPath, "utf-8");
  db.run(sql);

  const outPath = path.resolve(process.cwd(), "rwt-data", "northwind.db");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const data: Uint8Array = db.export();
  fs.writeFileSync(outPath, Buffer.from(data));
  db.close();

  process.stdout.write(`[setup-rwt-db] SQLite database created: ${outPath}\n`);
  process.stdout.write(`[setup-rwt-db] DB_URL=sqlite://./rwt-data/northwind.db\n`);
}

main().catch(err => { process.stderr.write(String(err) + "\n"); process.exit(1); });
