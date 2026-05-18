import { MockDBAdapter }   from "../../src/db/MockDBAdapter";
import { DBActionHandler }  from "../../src/handlers/DBActionHandler";
import { ExecutionContext }  from "../../src/execution/ExecutionContext";
import { parseTestDefinition } from "../../src/dsl/DslParser";

// Minimal AdapterActions stub — db steps never touch the browser adapter
const noopAdapter = {} as never;

function makeCtx(vars: Record<string, string> = {}) {
  return new ExecutionContext(vars);
}

// ── MockDBAdapter ─────────────────────────────────────────────────────────────

describe("MockDBAdapter", () => {
  test("returns empty result for unseeded query", async () => {
    const adapter = new MockDBAdapter();
    const result  = await adapter.query("SELECT * FROM users");
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  test("returns seeded result when query contains pattern", async () => {
    const adapter = new MockDBAdapter();
    adapter.seed("FROM users", { rows: [{ id: 1, name: "Alice" }], rowCount: 1 });
    const result = await adapter.query("SELECT * FROM users WHERE id = 1");
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].name).toBe("Alice");
  });

  test("first matching seed wins when multiple seeds registered", async () => {
    const adapter = new MockDBAdapter();
    adapter.seed("users",  { rows: [{ name: "Alice" }], rowCount: 1 });
    adapter.seed("orders", { rows: [{ id: 99 }],        rowCount: 1 });
    const result = await adapter.query("SELECT * FROM users");
    expect(result.rows[0].name).toBe("Alice");
  });

  test("seed() is chainable", () => {
    const adapter = new MockDBAdapter();
    const ref = adapter.seed("foo", { rows: [], rowCount: 0 });
    expect(ref).toBe(adapter);
  });

  test("close() resolves without error", async () => {
    await expect(new MockDBAdapter().close()).resolves.toBeUndefined();
  });
});

// ── DBActionHandler — store_as ────────────────────────────────────────────────

describe("DBActionHandler — store_as", () => {
  test("stores first row under store_as key", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ id: 1, name: "Alice" }], rowCount: 1 });
    const handler = new DBActionHandler(db);
    const ctx = makeCtx();

    await handler.execute({ action: "db", query: "SELECT * FROM users", store_as: "user" }, noopAdapter, ctx);

    expect(ctx.get("user")).toEqual({ id: 1, name: "Alice" });
  });

  test("stores all rows under store_as_rows key", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const db   = new MockDBAdapter().seed("orders", { rows, rowCount: 2 });
    const handler = new DBActionHandler(db);
    const ctx  = makeCtx();

    await handler.execute({ action: "db", query: "SELECT * FROM orders", store_as: "o" }, noopAdapter, ctx);

    expect(ctx.get("o_rows")).toEqual(rows);
  });

  test("stores empty object when query returns no rows", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    const ctx = makeCtx();

    await handler.execute({ action: "db", query: "SELECT * FROM missing", store_as: "row" }, noopAdapter, ctx);

    expect(ctx.get("row")).toEqual({});
  });

  test("resolves {{ }} templates in query before executing", async () => {
    const db = new MockDBAdapter().seed("id = 42", { rows: [{ id: 42 }], rowCount: 1 });
    const handler = new DBActionHandler(db);
    const ctx = makeCtx({ userId: "42" });

    await handler.execute({ action: "db", query: "SELECT * FROM users WHERE id = {{ userId }}", store_as: "u" }, noopAdapter, ctx);

    expect(ctx.get("u")).toEqual({ id: 42 });
  });

  test("stored value is accessible via dot notation in later steps", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ id: 7, email: "bob@test.com" }], rowCount: 1 });
    const handler = new DBActionHandler(db);
    const ctx = makeCtx();

    await handler.execute({ action: "db", query: "SELECT * FROM users", store_as: "user" }, noopAdapter, ctx);

    expect(ctx.resolve("{{ user.email }}")).toBe("bob@test.com");
  });
});

// ── DBActionHandler — assert_rows ─────────────────────────────────────────────

describe("DBActionHandler — assert_rows", () => {
  test("passes when rowCount matches assert_rows", async () => {
    const db  = new MockDBAdapter().seed("orders", { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    const handler = new DBActionHandler(db);

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM orders", assert_rows: 2 }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("throws when rowCount does not match assert_rows", async () => {
    const db  = new MockDBAdapter().seed("orders", { rows: [{ id: 1 }], rowCount: 1 });
    const handler = new DBActionHandler(db);

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM orders", assert_rows: 3 }, noopAdapter, makeCtx())
    ).rejects.toThrow("Expected 3 row(s), got 1 for query:");
  });

  test("assert_rows: 0 passes on empty result", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM nothing", assert_rows: 0 }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });
});

// ── DBActionHandler — assert_field ────────────────────────────────────────────

describe("DBActionHandler — assert_field", () => {
  test("passes when first row field matches expected value", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ name: "Alice", status: "active" }], rowCount: 1 });
    const handler = new DBActionHandler(db);

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM users", assert_field: { name: "Alice" } }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("throws on field mismatch", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ name: "Bob" }], rowCount: 1 });
    const handler = new DBActionHandler(db);

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM users", assert_field: { name: "Alice" } }, noopAdapter, makeCtx())
    ).rejects.toThrow("Expected name=Alice, got name=Bob at row[0]");
  });

  test("throws when no rows returned and assert_field is set", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM empty", assert_field: { id: "1" } }, noopAdapter, makeCtx())
    ).rejects.toThrow("assert_field requires at least 1 row");
  });

  test("resolves {{ }} templates in assert_field expected values", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ name: "Charlie" }], rowCount: 1 });
    const handler = new DBActionHandler(db);
    const ctx = makeCtx({ expectedName: "Charlie" });

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM users", assert_field: { name: "{{ expectedName }}" } }, noopAdapter, ctx)
    ).resolves.toBeUndefined();
  });

  test("can assert multiple fields in one step", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ name: "Dave", role: "admin" }], rowCount: 1 });
    const handler = new DBActionHandler(db);

    await expect(
      handler.execute({ action: "db", query: "SELECT * FROM users", assert_field: { name: "Dave", role: "admin" } }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });
});

// ── DBActionHandler — combined store_as + assert_rows + assert_field ──────────

describe("DBActionHandler — combined assertions", () => {
  test("assert_rows + assert_field + store_as all work together", async () => {
    const db  = new MockDBAdapter().seed("users", { rows: [{ id: 5, name: "Eve" }], rowCount: 1 });
    const handler = new DBActionHandler(db);
    const ctx = makeCtx();

    await handler.execute({
      action:       "db",
      query:        "SELECT * FROM users WHERE id = 5",
      assert_rows:  1,
      assert_field: { name: "Eve" },
      store_as:     "found",
    }, noopAdapter, ctx);

    expect(ctx.resolve("{{ found.name }}")).toBe("Eve");
  });
});

// ── DslParser — db: step ──────────────────────────────────────────────────────

describe("DslParser — db step", () => {
  function parse(yaml: string) {
    return parseTestDefinition(yaml).steps[0];
  }

  test("parses minimal db step", () => {
    const step = parse(`
test:
  name: t
  steps:
    - db:
        query: "SELECT 1"
`);
    expect(step).toMatchObject({ action: "db", query: "SELECT 1" });
  });

  test("parses all optional fields", () => {
    const step = parse(`
test:
  name: t
  steps:
    - db:
        query: "SELECT * FROM users WHERE id = 1"
        store_as: user
        assert_rows: 1
        assert_field:
          name: Alice
`);
    expect(step).toMatchObject({
      action:       "db",
      query:        "SELECT * FROM users WHERE id = 1",
      store_as:     "user",
      assert_rows:  1,
      assert_field: { name: "Alice" },
    });
  });

  test("throws when query is missing", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - db:
        store_as: x
`)).toThrow('missing "query"');
  });

  test("db step is listed in unknown-action error message", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - unknown_action: foo
`)).toThrow("db");
  });
});

// ── DBActionHandler — read-only guard ─────────────────────────────────────────
// Config is not loaded in unit tests → readOnly defaults to true (safe default).

describe("DBActionHandler — read-only guard", () => {
  test("SELECT passes the guard (read-only default)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "SELECT 1" }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("SELECT with leading whitespace passes", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "  SELECT id FROM users" }, noopAdapter, makeCtx())
    ).resolves.toBeUndefined();
  });

  test("SELECT after block comment is blocked (comment stripping removed — H-11)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    // Comment stripping was removed because it false-positived on "--" inside string literals.
    // Queries must now start with SELECT directly — no leading comments allowed in read-only mode.
    await expect(
      handler.execute({ action: "db", query: "/* safety comment */ SELECT 1" }, noopAdapter, makeCtx())
    ).rejects.toThrow("read-only mode is enabled");
  });

  test("SELECT after line comment is blocked (comment stripping removed — H-11)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "-- read-only\nSELECT 1" }, noopAdapter, makeCtx())
    ).rejects.toThrow("read-only mode is enabled");
  });

  test("INSERT is blocked when read-only (default)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "INSERT INTO users (name) VALUES ('x')" }, noopAdapter, makeCtx())
    ).rejects.toThrow("read-only mode is enabled");
  });

  test("UPDATE is blocked when read-only (default)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "UPDATE users SET name='x' WHERE id=1" }, noopAdapter, makeCtx())
    ).rejects.toThrow("read-only mode is enabled");
  });

  test("DELETE is blocked when read-only (default)", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "DELETE FROM users WHERE id=1" }, noopAdapter, makeCtx())
    ).rejects.toThrow("read-only mode is enabled");
  });

  test("error message hints at how to allow writes", async () => {
    const handler = new DBActionHandler(new MockDBAdapter());
    await expect(
      handler.execute({ action: "db", query: "DROP TABLE users" }, noopAdapter, makeCtx())
    ).rejects.toThrow("db.readOnly: false");
  });
});

// ── MockDBAdapter — close() ───────────────────────────────────────────────────

describe("MockDBAdapter — close() idempotent", () => {
  test("close() can be called multiple times without error", async () => {
    const adapter = new MockDBAdapter();
    await adapter.close();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

// ── API → DB chained verification ─────────────────────────────────────────────

describe("API → DB chained verification pattern", () => {
  test("value stored from api step is usable in db query", async () => {
    // Simulate: api step stored { id: 42 } as "newUser"
    const ctx = makeCtx();
    ctx.set("newUser", { id: 42 });

    const db = new MockDBAdapter().seed("id = 42", { rows: [{ id: 42, name: "Frank" }], rowCount: 1 });
    const handler = new DBActionHandler(db);

    await handler.execute({
      action:      "db",
      query:       "SELECT * FROM users WHERE id = {{ newUser.id }}",
      store_as:    "dbUser",
      assert_rows: 1,
    }, noopAdapter, ctx);

    expect(ctx.resolve("{{ dbUser.name }}")).toBe("Frank");
  });
});
