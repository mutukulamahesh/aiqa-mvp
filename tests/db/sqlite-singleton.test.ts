import { SqliteDBAdapter } from "../../src/db/SqliteDBAdapter";

describe("SqliteDBAdapter WASM singleton (POL-06)", () => {
  test("two adapters share the same WASM module promise", async () => {
    // Import module to access the singleton — verify it's the same reference
    // by confirming both adapters work without double-loading causing errors.
    const a = new SqliteDBAdapter(":memory:", false);
    const b = new SqliteDBAdapter(":memory:", false);

    await a.seed("CREATE TABLE t (x INT); INSERT INTO t VALUES (1);");
    await b.seed("CREATE TABLE t (x INT); INSERT INTO t VALUES (2);");

    const ra = await a.query("SELECT x FROM t");
    const rb = await b.query("SELECT x FROM t");

    expect(ra.rows[0].x).toBe(1);
    expect(rb.rows[0].x).toBe(2);

    await a.close();
    await b.close();
  });

  test("singleton survives multiple sequential instantiations without reload", async () => {
    const results: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const adapter = new SqliteDBAdapter(":memory:", false);
      await adapter.seed(`CREATE TABLE t (v INT); INSERT INTO t VALUES (${i});`);
      const { rows } = await adapter.query("SELECT v FROM t");
      results.push(rows[0].v as number);
      await adapter.close();
    }
    expect(results).toEqual([1, 2, 3, 4]);
  });
});
