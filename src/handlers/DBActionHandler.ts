import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { DBAdapter } from "../db/DBAdapter";
import { createDBAdapter } from "../db/DBAdapterFactory";
import { getConfig } from "../config/ConfigLoader";
import { wwrite } from "../execution/WorkerContext";

export class DBActionHandler implements StepHandler {
  readonly handles = ["db"];
  private adapter: DBAdapter;

  constructor(adapter?: DBAdapter) {
    if (adapter) {
      this.adapter = adapter;
    } else {
      let readOnly = true;
      try { readOnly = getConfig().db.readOnly; } catch { /* config not loaded — stay safe */ }
      this.adapter = createDBAdapter(readOnly);
    }
  }

  async execute(
    step: StepAction,
    _adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    if (step.action !== "db") return;

    const sql    = ctx.resolve(step.query);
    const params = step.params?.map(p => (typeof p === "string" ? ctx.resolve(p) : p));

    // ── read-only guard ──────────────────────────────────────────────────────
    // Strip leading block/line comments so "/* foo */ SELECT" still passes.
    const stripped = sql.replace(/^\s*(\/\*[\s\S]*?\*\/|--[^\n]*\n?)*/g, "");
    let readOnly = true;
    try { readOnly = getConfig().db.readOnly; } catch { /* config not loaded — stay safe */ }
    if (readOnly && !/^\s*select\b/i.test(stripped)) {
      throw new Error(
        `db: read-only mode is enabled — only SELECT queries are allowed. ` +
        `Got: "${sql.slice(0, 60)}${sql.length > 60 ? "…" : ""}". ` +
        `Set db.readOnly: false in your environment config to allow writes.`
      );
    }

    wwrite(`  ▶ db        → ${sql.slice(0, 80)}${sql.length > 80 ? "…" : ""}`);

    const result = await this.adapter.query(sql, params);

    wwrite(`      ↳ ${result.rowCount} row(s) returned`);

    // ── assert_rows ──────────────────────────────────────────────────────────
    if (step.assert_rows !== undefined && result.rowCount !== step.assert_rows) {
      throw new Error(
        `db: Expected ${step.assert_rows} row(s), got ${result.rowCount} for query: ${sql}`
      );
    }

    // ── assert_field — validates first row ───────────────────────────────────
    if (step.assert_field) {
      if (result.rows.length === 0) {
        throw new Error(`db: assert_field requires at least 1 row, got 0 — query: ${sql}`);
      }
      const row = result.rows[0];
      for (const [col, expected] of Object.entries(step.assert_field)) {
        const actual   = String(row[col] ?? "");
        const resolved = ctx.resolve(String(expected));
        if (actual !== resolved) {
          throw new Error(`db: Expected ${col}=${resolved}, got ${col}=${actual} at row[0]`);
        }
      }
    }

    // ── store_as — first row accessible as {{ var.col }}, all rows as {{ var_rows }} ──
    if (step.store_as) {
      ctx.set(step.store_as,           result.rows[0] ?? {});
      ctx.set(`${step.store_as}_rows`, result.rows);
      wwrite(`      ↳ stored as "${step.store_as}" (+ "${step.store_as}_rows")`);
    }
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}
