import { z } from "zod";

// ── Inline schema — mirrors the db_schema slice of EnvConfigSchema ────────────
// Tested in isolation so we don't need a config file on disk.

const DbSchemaEntrySchema = z.object({
  table:  z.string(),
  pk:     z.string().default("id"),
  method: z.array(z.enum(["POST", "PUT", "PATCH", "DELETE"])).default(["POST", "PUT", "PATCH", "DELETE"]),
});

const DbSchemaSchema = z.record(z.string(), DbSchemaEntrySchema).optional();

// ── Parsing ────────────────────────────────────────────────────────────────────

describe("db_schema config — parsing", () => {
  test("absent db_schema parses as undefined", () => {
    expect(DbSchemaSchema.parse(undefined)).toBeUndefined();
  });

  test("minimal entry — pk and method get defaults", () => {
    const result = DbSchemaSchema.parse({
      "/api/users": { table: "users" },
    });
    expect(result!["/api/users"]).toEqual({
      table:  "users",
      pk:     "id",
      method: ["POST", "PUT", "PATCH", "DELETE"],
    });
  });

  test("explicit pk overrides default", () => {
    const result = DbSchemaSchema.parse({
      "/api/products": { table: "products", pk: "sku" },
    });
    expect(result!["/api/products"].pk).toBe("sku");
  });

  test("explicit method list overrides default", () => {
    const result = DbSchemaSchema.parse({
      "/api/orders": { table: "orders", method: ["POST", "DELETE"] },
    });
    expect(result!["/api/orders"].method).toEqual(["POST", "DELETE"]);
  });

  test("multiple routes parsed independently", () => {
    const result = DbSchemaSchema.parse({
      "/api/users":  { table: "users" },
      "/api/orders": { table: "orders", pk: "order_id" },
    });
    expect(Object.keys(result!)).toHaveLength(2);
    expect(result!["/api/orders"].pk).toBe("order_id");
  });

  test("empty record is valid (no routes declared)", () => {
    const result = DbSchemaSchema.parse({});
    expect(result).toEqual({});
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("db_schema config — validation", () => {
  test("throws when table is missing", () => {
    expect(() =>
      DbSchemaSchema.parse({ "/api/users": { pk: "id" } })
    ).toThrow();
  });

  test("throws on unknown method value", () => {
    expect(() =>
      DbSchemaSchema.parse({ "/api/users": { table: "users", method: ["GET"] } })
    ).toThrow();
  });
});

// ── Consumer helper — mirrors what FlowMapper will use in EPIC-10 ─────────────

type DbSchemaMap = z.infer<typeof DbSchemaSchema>;

function findSchemaEntry(schema: DbSchemaMap, route: string, verb: string) {
  if (!schema) return undefined;
  for (const [prefix, entry] of Object.entries(schema)) {
    if (route.startsWith(prefix) && entry.method.includes(verb as never)) {
      return entry;
    }
  }
  return undefined;
}

describe("db_schema — route lookup helper", () => {
  const schema = DbSchemaSchema.parse({
    "/api/users":  { table: "users" },
    "/api/orders": { table: "orders", method: ["POST", "DELETE"] },
  })!;

  test("POST to /api/users matches users table", () => {
    const entry = findSchemaEntry(schema, "/api/users", "POST");
    expect(entry?.table).toBe("users");
  });

  test("GET /api/users returns undefined (not a mutating verb)", () => {
    expect(findSchemaEntry(schema, "/api/users", "GET")).toBeUndefined();
  });

  test("PUT /api/orders returns undefined (not in method list)", () => {
    expect(findSchemaEntry(schema, "/api/orders", "PUT")).toBeUndefined();
  });

  test("DELETE /api/orders/123 matches via prefix", () => {
    const entry = findSchemaEntry(schema, "/api/orders/123", "DELETE");
    expect(entry?.table).toBe("orders");
  });

  test("undefined schema always returns undefined", () => {
    expect(findSchemaEntry(undefined, "/api/users", "POST")).toBeUndefined();
  });
});
