#!/usr/bin/env node
/**
 * aiqa CLI — entry point
 * Usage: ts-node src/cli.ts run <test.yaml>
 */
import { Command } from "commander";
import * as path from "path";
import { parseTestFile } from "./dsl/DslParser";
import { TestRunner } from "./runner/TestRunner";

const program = new Command();

program
  .name("aiqa")
  .description("Enterprise AI QA Platform — MVP")
  .version("1.0.0");

program
  .command("run <file>")
  .description("Run a DSL test file")
  .option("--headless", "Run browser in headless mode", false)
  .action(async (file: string, opts: { headless: boolean }) => {
    const testFilePath = path.resolve(process.cwd(), file);

    console.log(`\n🚀 AIQA Runner`);
    console.log(`   File    : ${testFilePath}`);
    console.log(`   Headless: ${opts.headless}`);
    console.log(`─────────────────────────────────────────\n`);

    let testDef;
    try {
      testDef = parseTestFile(testFilePath);
    } catch (err) {
      console.error(`❌ Failed to parse test file: ${(err as Error).message}`);
      process.exit(1);
    }

    const runner = new TestRunner({ headless: opts.headless });
    const result = await runner.run(testDef);

    console.log(`\n─────────────────────────────────────────`);
    if (result.passed) {
      console.log(`✅ Test passed: "${result.testName}" (${result.durationMs}ms)`);
    } else {
      console.log(`❌ Test FAILED: "${result.testName}"`);
      console.log(`   Reason: ${result.error}`);
    }
    console.log(`─────────────────────────────────────────\n`);

    process.exit(result.passed ? 0 : 1);
  });

program.parse(process.argv);
