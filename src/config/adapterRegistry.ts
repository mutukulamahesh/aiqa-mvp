/**
 * Canonical package → adapter mapping.
 * Single source of truth used by:
 *   - tests/adapter/adapter-audit.test.ts  (CI enforcement gate)
 *   - src/cli.ts dephealth --heal          (DepHealerAgent dispatch)
 *
 * primary: the file DepHealerAgent patches when the package probe fails.
 * allowed: all files permitted to import the package at runtime (primary + documented exceptions).
 */
export interface AdapterEntry {
  primary: string;
  allowed: string[];
}

export const ADAPTER_REGISTRY: Record<string, AdapterEntry> = {
  "playwright": {
    primary: "src/adapter/PlaywrightAdapter.ts",
    allowed: [
      "src/adapter/PlaywrightAdapter.ts",
      "src/agents/AppExplorer.ts",    // documented exception: direct browser crawl agent
      "src/api/routes/health.ts",     // API health probe: checks playwright is launchable
    ],
  },
  "@anthropic-ai/sdk": {
    primary: "src/llm/AnthropicLLMProvider.ts",
    allowed: [
      "src/llm/AnthropicLLMProvider.ts",
      "src/vision/VisionAgent.ts",   // documented exception: uses Vision API (image analysis) not covered by LLMProvider
    ],
  },
  "openai": {
    primary: "src/llm/OpenAILLMProvider.ts",
    allowed: ["src/llm/OpenAILLMProvider.ts"],
  },
  "sql.js": {
    primary: "src/db/SqliteDBAdapter.ts",
    allowed: ["src/db/SqliteDBAdapter.ts"],
  },
  "tesseract.js": {
    primary: "src/vision/OcrEngine.ts",
    allowed: ["src/vision/OcrEngine.ts"],
  },
  "pngjs": {
    primary: "src/vision/VisualRegression.ts",
    allowed: [
      "src/vision/VisualRegression.ts",
      "src/desktop/DesktopAdapter.ts",  // BGRA→RGBA conversion in desktop screenshots
    ],
  },
  "pixelmatch": {
    primary: "src/vision/VisualRegression.ts",
    allowed: ["src/vision/VisualRegression.ts"],
  },
  "vectra": {
    primary: "src/knowledge/VectorIndex.ts",
    allowed: ["src/knowledge/VectorIndex.ts"],
  },
  "@xenova/transformers": {
    primary: "src/knowledge/Embedder.ts",
    allowed: ["src/knowledge/Embedder.ts"],
  },
  "@nut-tree-fork/nut-js": {
    primary: "src/desktop/DesktopAdapter.ts",
    allowed: ["src/desktop/DesktopAdapter.ts"],
  },
  "@playwright/test": {
    primary: "src/adapter/PlaywrightAdapter.ts",
    allowed: ["src/adapter/PlaywrightAdapter.ts"],
  },
};
