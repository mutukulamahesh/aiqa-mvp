import { SqliteDBAdapter } from "../../src/db/SqliteDBAdapter";

describe("SqliteDBAdapter", () => {
  let adapter: SqliteDBAdapter;

  beforeEach(async () => {
    adapter = new SqliteDBAdapter(":memory:", true);
    await adapter.seed(
      "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);" +
      "INSERT INTO products VALUES (1, 'Chai', 18.0);" +
      "INSERT INTO products VALUES (2, 'Chang', 19.0);" +
      "INSERT INTO products VALUES (3, 'Aniseed Syrup', 10.0);"
    );
  });

  afterEach(async () => {
    await adapter.close();
  });

  test("name is sqlite", () => {
    expect(adapter.name).toBe("sqlite");
  });

  test("SELECT returns all rows", async () => {
    const result = await adapter.query("SELECT * FROM products");
    expect(result.rowCount).toBe(3);
    expect(result.rows[0]).toMatchObject({ id: 1, name: "Chai", price: 18.0 });
  });

  test("SELECT with WHERE filter returns subset", async () => {
    const result = await adapter.query("SELECT * FROM products WHERE price > 15");
    expect(result.rowCount).toBe(2);
  });

  test("parameterized query binds value correctly", async () => {
    const result = await adapter.query("SELECT name FROM products WHERE id = ?", [2]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name).toBe("Chang");
  });

  test("parameterized query with no matches returns empty", async () => {
    const result = await adapter.query("SELECT * FROM products WHERE id = ?", [99]);
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  test("special characters in param do not cause SQL error", async () => {
    const result = await adapter.query(
      "SELECT * FROM products WHERE name = ?",
      ["'; DROP TABLE products; --"]
    );
    expect(result.rowCount).toBe(0);
  });

  test("DML returns empty rows and rowCount 0", async () => {
    const adapter2 = new SqliteDBAdapter(":memory:", false);
    await adapter2.seed("CREATE TABLE t (x INT);");
    const result = await adapter2.query("INSERT INTO t VALUES (42)");
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    await adapter2.close();
  });

  test("COUNT aggregate returns single row", async () => {
    const result = await adapter.query("SELECT COUNT(*) AS total FROM products");
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].total).toBe(3);
  });

  test("JOIN query returns combined rows", async () => {
    const adapter2 = new SqliteDBAdapter(":memory:", true);
    await adapter2.seed(
      "CREATE TABLE cats (id INT, name TEXT);" +
      "CREATE TABLE items (id INT, cat_id INT, label TEXT);" +
      "INSERT INTO cats VALUES (1, 'A'), (2, 'B');" +
      "INSERT INTO items VALUES (1, 1, 'x'), (2, 1, 'y'), (3, 2, 'z');"
    );
    const result = await adapter2.query(
      "SELECT c.name, i.label FROM cats c JOIN items i ON i.cat_id = c.id WHERE c.id = ?", [1]
    );
    expect(result.rowCount).toBe(2);
    await adapter2.close();
  });
});
