/**
 * Adapter coverage audit (POL-09a).
 *
 * Rule: every external runtime library is accessed through exactly one adapter file.
 * This test is the CI enforcement gate — adding a new runtime import of a package
 * outside its designated adapter file will fail this test.
 *
 * To add a new package: add it to ADAPTER_OWNERS below with its allowed files.
 * To add a documented exception: add the file to the allowed list with a comment.
 */

import * as fs   from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../src");

// Package → files that are permitted to import it at runtime.
// cli.ts is excluded globally — it's a probe tool (dephealth) that intentionally
// imports packages for health-check purposes, not production code paths.
const ADAPTER_OWNERS: Record<string, string[]> = {
  "playwright": [
    "src/adapter/PlaywrightAdapter.ts",    // primary adapter
    "src/agents/AppExplorer.ts",           // documented exception: direct browser crawl agent
    "src/api/routes/health.ts",            // API health probe: checks playwright is launchable
  ],
  "@anthropic-ai/sdk": [
    "src/llm/AnthropicLLMProvider.ts",
  ],
  "openai": [
    "src/llm/OpenAILLMProvider.ts",
  ],
  "sql.js": [
    "src/db/SqliteDBAdapter.ts",
  ],
  "tesseract.js": [
    "src/vision/OcrEngine.ts",
  ],
  "pngjs": [
    "src/vision/VisualRegression.ts",
    "src/desktop/DesktopAdapter.ts",       // BGRA→RGBA conversion in desktop screenshots
  ],
  "pixelmatch": [
    "src/vision/VisualRegression.ts",
  ],
  "vectra": [
    "src/knowledge/VectorIndex.ts",
  ],
  "@xenova/transformers": [
    "src/knowledge/Embedder.ts",
  ],
  "@nut-tree-fork/nut-js": [
    "src/desktop/DesktopAdapter.ts",
  ],
};

// Files excluded from the scan (dephealth probes, one-off CLI checks).
const EXCLUDED_FILES = new Set(["src/cli.ts"]);

// Patterns that indicate a runtime import of a package.
// We intentionally skip `import type` — type-only imports are erased at compile time.
function extractRuntimeImports(source: string, filePath: string): Set<string> {
  const found = new Set<string>();
  const lines  = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip type-only imports: "import type { X } from 'pkg'"
    if (/^\s*import\s+type\s+/.test(line)) continue;

    // Static import: import ... from 'pkg' or import 'pkg'
    const staticMatch = line.match(/from\s+['"]([^'"./][^'"]*)['"]/);
    if (staticMatch) found.add(staticMatch[1].split("/")[0]);

    // Dynamic import: import('pkg') or import("pkg")
    const dynMatch = line.match(/import\(\s*['"]([^'"./][^'"]*)['"]/);
    if (dynMatch) found.add(dynMatch[1].split("/")[0]);

    // Lazy require: require('pkg') — skip require.resolve() calls
    const reqMatch = line.match(/\brequire\s*\(\s*['"]([^'"./][^'"]*)['"]/);
    if (reqMatch && !line.includes("require.resolve")) {
      found.add(reqMatch[1].split("/")[0]);
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
    const imports = extractRuntimeImports(source, relPath);

    for (const pkg of imports) {
      if (pkg in ADAPTER_OWNERS) {
        if (!actualImporters[pkg]) actualImporters[pkg] = [];
        actualImporters[pkg].push(relPath);
      }
    }
  }

  for (const [pkg, allowedFiles] of Object.entries(ADAPTER_OWNERS)) {
    test(`"${pkg}" imported only in allowed adapter files`, () => {
      const actual    = actualImporters[pkg] ?? [];
      const allowed   = new Set(allowedFiles);
      const violations = actual.filter(f => !allowed.has(f));

      if (violations.length > 0) {
        throw new Error(
          `Package "${pkg}" is imported outside its designated adapter:\n` +
          violations.map(f => `  • ${f}`).join("\n") +
          `\nAllowed files:\n` +
          allowedFiles.map(f => `  • ${f}`).join("\n") +
          `\nMove the import into an adapter or add the file to ADAPTER_OWNERS if it is intentional.`
        );
      }
    });
  }

  test("ADAPTER_OWNERS covers all audited packages", () => {
    // Sanity check: the map is non-empty and each allowed file path starts with src/
    for (const [pkg, files] of Object.entries(ADAPTER_OWNERS)) {
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(f).toMatch(/^src\//);
      }
    }
    expect(Object.keys(ADAPTER_OWNERS).length).toBeGreaterThanOrEqual(10);
  });
});
