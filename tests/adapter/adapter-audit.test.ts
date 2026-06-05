/**
 * Adapter coverage audit (POL-09a).
 *
 * Rule: every external runtime library is accessed through exactly one adapter file.
 * This test is the CI enforcement gate — adding a new runtime import of a package
 * outside its designated adapter file will fail this test.
 *
 * Package→file mapping lives in src/config/adapterRegistry.ts (single source of truth).
 */

import * as fs   from "fs";
import * as path from "path";
import { ADAPTER_REGISTRY } from "../../src/config/adapterRegistry";

const SRC_ROOT = path.resolve(__dirname, "../../src");

// cli.ts excluded — it's a probe tool (dephealth) that intentionally imports
// packages for health-check purposes, not production code paths.
const EXCLUDED_FILES = new Set(["src/cli.ts"]);

/** Normalise an import specifier to its package name.
 *  Scoped packages (@scope/name) need the first two segments. */
function toPackageName(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function extractRuntimeImports(source: string): Set<string> {
  const found = new Set<string>();
  const lines  = source.split("\n");

  for (const line of lines) {
    // Skip type-only imports — erased at compile time, no runtime coupling
    if (/^\s*import\s+type\s+/.test(line)) continue;

    // Static import: import ... from 'pkg' or import 'pkg'
    const staticMatch = line.match(/from\s+['"]([^'"./][^'"]*)['"]/);
    if (staticMatch) found.add(toPackageName(staticMatch[1]));

    // Dynamic import: import('pkg')
    const dynMatch = line.match(/import\(\s*['"]([^'"./][^'"]*)['"]/);
    if (dynMatch) found.add(toPackageName(dynMatch[1]));

    // Lazy require: require('pkg') — skip require.resolve() calls
    const reqMatch = line.match(/\brequire\s*\(\s*['"]([^'"./][^'"]*)['"]/);
    if (reqMatch && !line.includes("require.resolve")) {
      found.add(toPackageName(reqMatch[1]));
    }
  }

  return found;
}

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectSourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("Adapter coverage audit (POL-09a)", () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  // Build a map: package → files that import it at runtime (excluding cli.ts)
  const actualImporters: Record<string, string[]> = {};

  for (const absPath of sourceFiles) {
    const relPath = path.relative(path.resolve(__dirname, "../.."), absPath).replace(/\\/g, "/");
    if (EXCLUDED_FILES.has(relPath)) continue;

    const source  = fs.readFileSync(absPath, "utf-8");
    const imports = extractRuntimeImports(source);

    for (const pkg of imports) {
      if (pkg in ADAPTER_REGISTRY) {
        if (!actualImporters[pkg]) actualImporters[pkg] = [];
        actualImporters[pkg].push(relPath);
      }
    }
  }

  for (const [pkg, entry] of Object.entries(ADAPTER_REGISTRY)) {
    test(`"${pkg}" imported only in allowed adapter files`, () => {
      const actual     = actualImporters[pkg] ?? [];
      const allowed    = new Set(entry.allowed);
      const violations = actual.filter(f => !allowed.has(f));

      if (violations.length > 0) {
        throw new Error(
          `Package "${pkg}" is imported outside its designated adapter:\n` +
          violations.map(f => `  • ${f}`).join("\n") +
          `\nAllowed files:\n` +
          entry.allowed.map(f => `  • ${f}`).join("\n") +
          `\nMove the import into an adapter or add the file to ADAPTER_REGISTRY if it is intentional.`
        );
      }
    });
  }

  test("toPackageName correctly handles scoped packages (C1 regression)", () => {
    expect(toPackageName("@anthropic-ai/sdk")).toBe("@anthropic-ai/sdk");
    expect(toPackageName("@nut-tree-fork/nut-js")).toBe("@nut-tree-fork/nut-js");
    expect(toPackageName("@xenova/transformers")).toBe("@xenova/transformers");
    expect(toPackageName("@playwright/test")).toBe("@playwright/test");
    expect(toPackageName("playwright")).toBe("playwright");
    expect(toPackageName("sql.js")).toBe("sql.js");
    expect(toPackageName("openai/core/utils")).toBe("openai");
  });

  test("ADAPTER_REGISTRY is non-empty and all allowed paths start with src/", () => {
    expect(Object.keys(ADAPTER_REGISTRY).length).toBeGreaterThanOrEqual(10);
    for (const [, entry] of Object.entries(ADAPTER_REGISTRY)) {
      expect(entry.allowed.length).toBeGreaterThan(0);
      expect(entry.primary).toMatch(/^src\//);
      for (const f of entry.allowed) expect(f).toMatch(/^src\//);
    }
  });

  test("scoped packages are actually detected (C1 fix verification)", () => {
    // At least one scoped package must have detected importers (proves the bug is fixed)
    const scopedWithImporters = Object.keys(ADAPTER_REGISTRY)
      .filter(p => p.startsWith("@") && (actualImporters[p]?.length ?? 0) > 0);
    expect(scopedWithImporters.length).toBeGreaterThan(0);
  });
});
