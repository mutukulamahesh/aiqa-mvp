import { DBAdapter } from "./DBAdapter";
import { MockDBAdapter } from "./MockDBAdapter";

/**
 * Returns a real KnexDBAdapter when DB_URL is set, otherwise MockDBAdapter.
 * Mirrors the createLLMProvider() factory pattern.
 * `readOnly` defaults to true — pass false only when the test suite explicitly needs writes.
 */
export function createDBAdapter(readOnly = true): DBAdapter {
  const dbUrl = process.env.DB_URL;
  if (dbUrl) {
    // Lazy import — KnexDBAdapter only loads knex when actually needed.
    const { KnexDBAdapter } = require("./KnexDBAdapter") as typeof import("./KnexDBAdapter");
    return new KnexDBAdapter(dbUrl, readOnly);
  }
  return new MockDBAdapter();
}
