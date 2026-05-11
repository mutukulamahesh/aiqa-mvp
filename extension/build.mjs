import * as esbuild from "esbuild";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");

mkdirSync("build", { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const shared = {
  bundle: true,
  sourcemap: isDev ? "inline" : false,
  target: ["chrome116"],
  platform: "browser",
  // Always production mode — MV3 CSP blocks eval used by React dev builds
  define: { "process.env.NODE_ENV": '"production"' },
  // DslParser.ts imports 'fs' (only used by parseTestFile, never called in the
  // browser). Alias to an empty stub so the bundler doesn't error out.
  alias: { fs: resolve(__dirname, "stubs/node-fs.ts") },
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ["background/service-worker.ts"],
    outfile: "build/service-worker.js",
    format: "esm",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["content/recorder.ts"],
    outfile: "build/recorder.js",
    format: "iife",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["content/highlighter.ts"],
    outfile: "build/highlighter.js",
    format: "iife",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["panel/index.tsx"],
    outfile: "build/panel.js",
    format: "esm",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["panel/options.tsx"],
    outfile: "build/options.js",
    format: "esm",
  }),
]);

console.log("Extension built -> extension/build/");
