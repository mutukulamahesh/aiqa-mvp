import * as fs            from "fs";
import * as path          from "path";
import * as childProcess  from "child_process";
import { createLLMProvider } from "../llm/LLMProvider";
import { getConfig }         from "../config/ConfigLoader";

export interface DepProbeFailure {
  package:     string;
  adapterFile: string;   // relative path from project root, e.g. "src/llm/AnthropicLLMProvider.ts"
  error:       string;   // first line of the error message from dephealth
}

export type HealStatus = "fixed" | "suggested" | "failed";

export interface HealResult {
  status:      HealStatus;
  package:     string;
  diagnosis:   string;
  suggestion:  string;
  patchApplied?: boolean;
  verifyPassed?: boolean;
  prUrl?:      string;
}

// Fetch recent package versions from the npm registry for changelog context.
async function fetchNpmContext(pkg: string): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    if (!res.ok) return `(npm registry returned ${res.status})`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const latest     = data["dist-tags"]?.latest ?? "unknown";
    const versions   = Object.keys(data.versions ?? {}).slice(-5).join(", ");
    const description = data.description ?? "";
    return `Package: ${pkg}\nLatest: ${latest}\nRecent versions: ${versions}\nDescription: ${description}`;
  } catch {
    return `(could not fetch npm registry info for ${pkg})`;
  }
}

function runCmd(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = childProcess.execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, output: output.slice(0, 2000) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: ((e.stdout ?? "") + (e.stderr ?? "")).slice(0, 2000) };
  }
}

export class DepHealerAgent {
  private readonly projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async heal(failure: DepProbeFailure): Promise<HealResult> {
    const adapterPath = path.resolve(this.projectRoot, failure.adapterFile);

    // Read adapter source
    let adapterSource: string;
    try {
      adapterSource = fs.readFileSync(adapterPath, "utf-8");
    } catch {
      return {
        status:    "failed",
        package:   failure.package,
        diagnosis: `Could not read adapter file: ${failure.adapterFile}`,
        suggestion: "Verify the adapter file path is correct.",
      };
    }

    // Fetch npm context for the package
    const npmContext = await fetchNpmContext(failure.package);

    // Ask the LLM to diagnose and suggest a fix
    let llm;
    try {
      const cfg = (() => { try { return getConfig(); } catch { return undefined; } })();
      llm = createLLMProvider(cfg?.llm);
    } catch {
      return { status: "failed", package: failure.package, diagnosis: "LLM unavailable", suggestion: "" };
    }

    const prompt = [
      `You are a senior TypeScript engineer diagnosing a broken external dependency adapter.`,
      ``,
      `## Failing package`,
      failure.package,
      ``,
      `## Error from health probe`,
      failure.error,
      ``,
      `## npm registry context`,
      npmContext,
      ``,
      `## Current adapter source (${failure.adapterFile})`,
      "```typescript",
      adapterSource.slice(0, 4000),
      "```",
      ``,
      `## Task`,
      `1. Diagnose what changed in the package that caused this error (one sentence).`,
      `2. Provide the minimal code change to fix the adapter. Format EXACTLY as:`,
      `OLD:`,
      `<the exact lines to replace>`,
      `NEW:`,
      `<the replacement lines>`,
      ``,
      `If you cannot determine a fix, write "CANNOT_FIX" after the diagnosis.`,
    ].join("\n");

    let llmResponse: string;
    try {
      const res = await llm.complete({ system: "You are a TypeScript expert.", userMessage: prompt, maxTokens: 1000 });
      llmResponse = res.content;
    } catch (err) {
      return {
        status:    "failed",
        package:   failure.package,
        diagnosis: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: "",
      };
    }

    // Parse diagnosis and fix suggestion
    const diagnosisMatch = llmResponse.match(/^(.+?)(?:\n|OLD:|CANNOT_FIX)/s);
    const diagnosis = diagnosisMatch?.[1]?.trim() ?? llmResponse.slice(0, 200);

    if (llmResponse.includes("CANNOT_FIX")) {
      return { status: "suggested", package: failure.package, diagnosis, suggestion: llmResponse };
    }

    // Try to extract OLD/NEW patch
    const oldMatch = llmResponse.match(/OLD:\n([\s\S]+?)\nNEW:/);
    const newMatch = llmResponse.match(/NEW:\n([\s\S]+?)(?:\n\n|$)/);

    if (!oldMatch || !newMatch) {
      return { status: "suggested", package: failure.package, diagnosis, suggestion: llmResponse };
    }

    const oldCode = oldMatch[1].trim();
    const newCode = newMatch[1].trim();

    if (!adapterSource.includes(oldCode)) {
      return {
        status:     "suggested",
        package:    failure.package,
        diagnosis,
        suggestion: `LLM suggested change but OLD code not found in adapter.\n\nSuggested:\nOLD:\n${oldCode}\n\nNEW:\n${newCode}`,
      };
    }

    // Apply patch
    const patched = adapterSource.replace(oldCode, newCode);
    const backupPath = `${adapterPath}.dephealer.bak`;
    fs.writeFileSync(backupPath, adapterSource);
    fs.writeFileSync(adapterPath, patched);

    // Verify: tsc then jest
    const tscResult  = runCmd("npx tsc --noEmit", this.projectRoot);
    if (!tscResult.ok) {
      fs.writeFileSync(adapterPath, adapterSource);
      fs.unlinkSync(backupPath);
      return {
        status:       "suggested",
        package:      failure.package,
        diagnosis,
        suggestion:   `Patch failed tsc check:\n${tscResult.output}\n\nAttempted:\nOLD:\n${oldCode}\n\nNEW:\n${newCode}`,
        patchApplied: false,
      };
    }

    const testPattern = path.basename(failure.adapterFile, ".ts");
    const jestResult  = runCmd(
      `npx jest --no-coverage "${testPattern}" --passWithNoTests`,
      this.projectRoot,
    );

    if (!jestResult.ok) {
      fs.writeFileSync(adapterPath, adapterSource);
      fs.unlinkSync(backupPath);
      return {
        status:       "suggested",
        package:      failure.package,
        diagnosis,
        suggestion:   `Patch failed jest check:\n${jestResult.output}\n\nAttempted:\nOLD:\n${oldCode}\n\nNEW:\n${newCode}`,
        patchApplied: false,
      };
    }

    // Patch is verified — clean up backup
    fs.unlinkSync(backupPath);

    return {
      status:       "fixed",
      package:      failure.package,
      diagnosis,
      suggestion:   `Applied:\nOLD:\n${oldCode}\n\nNEW:\n${newCode}`,
      patchApplied: true,
      verifyPassed: true,
    };
  }
}
