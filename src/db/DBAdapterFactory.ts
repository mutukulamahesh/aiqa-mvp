import { DBAdapter } from "./DBAdapter";
import { MockDBAdapter } from "./MockDBAdapter";

/**
 * Returns a real KnexDBAdapter when DB_URL is set, otherwise MockDBAdapter.
 * Mirrors the createLLMProvider() factory pattern.
 */
export function createDBAdapter(): DBAdapter {
  const dbUrl = process.env.DB_URL;
  if (dbUrl) {
    // Lazy import — KnexDBAdapter only loads knex when actually needed.
    const { KnexDBAdapter } = require("./KnexDBAdapter") as typeof import("./KnexDBAdapter");
    return new KnexDBAdapter(dbUrl);
  }
  return new MockDBAdapter();
}
