#!/usr/bin/env ts-node
/**
 * EPIC-03 verification suite — Retry & Circuit Breaker
 *
 * Covers:
 *   [Unit]        isRetryable classification (6 tests)
 *   [Integration] Retry behavior             (4 tests)
 *   [Integration] Circuit breaker            (4 tests)
 *   [Integration] Cross-run & parallel       (2 tests)
 *   [Integration] Mixed stress               (1 test)
 *
 * Run: npm run test:epic03
 */
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import assert from "node:assert/strict";
import { AssertionError as AiqaAssertionError, TransientError } from "../src/errors";
import { isRetryable } from "../src/runner/TestRunner";

// ── Harness ───────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const TMP  = join(ROOT, ".tmp-epic03");

let passed   = 0;
let failed   = 0;
const failures: string[] = [];
let section  = "";

function suite(name: string) {
  section = name;
  console.log(`\n${name}`);
}

function t(label: string, fn: () => void) {
  try {
    fn();
    process.stdout.write(`  ✅  ${label}\n`);
    passed++;
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0];
    process.stdout.write(`  ❌  ${label}\n       ${msg}\n`);
    failures.push(`${section} › ${label}`);
    failed++;
  }
}

/** Run the CLI via spawnSync. Returns combined stdout+stderr. */
function cli(args: string[], timeoutMs = 60_000): string {
  const result = spawnSync(
    "npx",
    ["ts-node", "src/cli.ts", "--env", "staging", ...args],
    {
      cwd:      ROOT,
      encoding: "utf8",
      env:      { ...process.env, NODE_ENV: "test" },
      timeout:  timeoutMs,
    },
  );
  if (result.error) throw new Error(`CLI spawn error: ${result.error.message}`);
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function writeYaml(dir: string, file: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content.trimStart(), "utf8");
}

function clean(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — [Unit] isRetryable classification
// ─────────────────────────────────────────────────────────────────────────────

suite("Suite 1: [Unit] isRetryable classification");

t("TransientError → retryable", () => {
  assert.ok(isRetryable(new TransientError("net::ERR_CONNECTION_REFUSED")));
});

t("AssertionError → NOT retryable", () => {
  assert.ok(!isRetryable(new AiqaAssertionError("assertTextVisible: text not found")));
});

t("Plain Error with 'timeout' → retryable (string fallback)", () => {
  assert.ok(isRetryable(new Error("Timeout 15000ms exceeded waiting for locator")));
});

t("Plain Error with 'net::err' → retryable (string fallback)", () => {
  assert.ok(isRetryable(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at http://bad.host")));
});

t("Plain Error with 'navigation failed' → retryable (string fallback)", () => {
  assert.ok(isRetryable(new Error("navigation failed because the page was destroyed")));
});

t("Plain Error with generic message → NOT retryable (no match in fallback)", () => {
  assert.ok(!isRetryable(new Error("Something unexpected went wrong in the matrix")));
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — [Integration] Retry behavior
// ─────────────────────────────────────────────────────────────────────────────

suite("Suite 2: [Integration] Retry behavior");

const retryDir = join(TMP, "retry");

// Shared YAML: transient fail — navigate to a port with no server
const transientYaml = `
test:
  name: "Transient fail"
  retries: 2
  steps:
    - navigate: "http://localhost:9999"
`;

const assertFailYaml = `
test:
  name: "Assertion fail"
  retries: 2
  steps:
    - assert:
        value: "actual"
        equals: "expected"
`;

writeYaml(retryDir, "transient.yaml",   transientYaml);
writeYaml(retryDir, "assertfail.yaml",  assertFailYaml);

t("T01 — Transient error (TransientError) retries N times: ↺ retry 1/2 and ↺ retry 2/2", () => {
  const out = cli(["run", join(retryDir, "transient.yaml")]);
  assert.ok(out.includes("↺ retry 1/2"), `Missing '↺ retry 1/2'\n${out.slice(0, 500)}`);
  assert.ok(out.includes("↺ retry 2/2"), `Missing '↺ retry 2/2'\n${out.slice(0, 500)}`);
});

t("T02 — AssertionError (deterministic) does NOT retry: zero retry lines", () => {
  const out = cli(["run", join(retryDir, "assertfail.yaml")]);
  assert.ok(!out.includes("↺ retry"), `Unexpected retry line in assertion test\n${out.slice(0, 500)}`);
});

t("T03 — Retry stops exactly at limit: retries: 2 → exactly 2 ↺ lines (no 3rd)", () => {
  const out   = cli(["run", join(retryDir, "transient.yaml")]);
  const count = (out.match(/↺ retry/g) ?? []).length;
  assert.equal(count, 2, `Expected exactly 2 retry lines, got ${count}`);
});

t("T04 — Retry log surfaces error class and message: '↺ retry N/M (TransientError: ...)'", () => {
  const out = cli(["run", join(retryDir, "transient.yaml")]);
  assert.ok(
    out.includes("(TransientError:"),
    `Retry line should include '(TransientError:' but got:\n${out.slice(0, 600)}`,
  );
});

t("T05 — Logging integrity: step output → retry line → step output → retry line → FAIL (correct order)", () => {
  const out       = cli(["run", join(retryDir, "transient.yaml")]);
  const stepIdx   = out.indexOf("[1/1]");
  const retryIdx  = out.indexOf("↺ retry");
  const failIdx   = out.indexOf("Test FAILED");
  assert.ok(stepIdx  !== -1, "Missing step output [1/1]");
  assert.ok(retryIdx !== -1, "Missing retry line");
  assert.ok(retryIdx  >  stepIdx,  "Retry line must appear after first step output");
  assert.ok(failIdx   >  retryIdx, "Final FAILED must appear after last retry line");
});

clean(retryDir);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — [Integration] Circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

suite("Suite 3: [Integration] Circuit breaker");

const cbDir = join(TMP, "cb");

/** Write N instantly-failing tests (assertEquals mismatch — no browser launch). */
function writeFails(count: number) {
  clean(cbDir);
  for (let i = 1; i <= count; i++) {
    writeYaml(cbDir, `fail${i}.yaml`, `
test:
  name: "CB fail ${i}"
  steps:
    - assert:
        value: "actual"
        equals: "expected"
`);
  }
}

t("T06 — Circuit breaker triggers at threshold (5 fails, threshold=3)", () => {
  writeFails(5);
  const out = cli(["run-all", cbDir, "--workers", "1", "--circuit-breaker", "3"]);
  assert.ok(out.includes("⚡ Circuit breaker open"), `Missing circuit breaker message\n${out.slice(0, 500)}`);
});

t("T07 — Skip visibility: each bypassed file logged by name (⊘ Skipped: failN.yaml)", () => {
  writeFails(5);
  const out = cli(["run-all", cbDir, "--workers", "1", "--circuit-breaker", "3"]);
  assert.ok(out.includes("⊘ Skipped: fail4.yaml"), `Missing '⊘ Skipped: fail4.yaml'\n${out.slice(0, 500)}`);
  assert.ok(out.includes("⊘ Skipped: fail5.yaml"), `Missing '⊘ Skipped: fail5.yaml'\n${out.slice(0, 500)}`);
});

t("T08 — No early trigger: 2 fails below threshold of 3 → no ⚡ in output", () => {
  writeFails(2);
  const out = cli(["run-all", cbDir, "--workers", "1", "--circuit-breaker", "3"]);
  assert.ok(
    !out.includes("⚡ Circuit breaker open"),
    `Circuit breaker fired too early\n${out.slice(0, 500)}`,
  );
});

t("T09 — Circuit breaker under parallel load: --workers 4, 20 fails, threshold=3 → trips globally + skips remaining", () => {
  // 20 tests ensures deep queue depth: after 4 workers grab their first batch and
  // consecutiveFails reaches 3, there are still ~14 tests in the queue to skip.
  writeFails(20);
  const out = cli(["run-all", cbDir, "--workers", "4", "--circuit-breaker", "3"], 60_000);
  assert.ok(out.includes("⚡ Circuit breaker open"), `CB did not trip under parallel load\n${out.slice(0, 500)}`);
  const skippedMatch = out.match(/\((\d+) skipped by circuit breaker\)/);
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
  assert.ok(skipped > 0, `Expected skipped tests after CB trips, got 0\n${out.slice(0, 500)}`);
});

clean(cbDir);

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — [Integration] Cross-run reset & parallel isolation
// ─────────────────────────────────────────────────────────────────────────────

suite("Suite 4: [Integration] Cross-run reset & parallel isolation");

t("T10 — Cross-run reset: two consecutive run-all invocations produce identical summaries", () => {
  const dir = join(TMP, "crossrun");
  clean(dir);
  for (let i = 1; i <= 4; i++) {
    writeYaml(dir, `fail${i}.yaml`, `
test:
  name: "CrossRun fail ${i}"
  steps:
    - assert:
        value: "a"
        equals: "b"
`);
  }

  const extract = (o: string) => {
    const ran  = o.match(/Ran\s*:\s*(\d+)/)?.[1]    ?? "?";
    const fail = o.match(/Failed:\s*(\d+)/)?.[1]     ?? "?";
    const skip = o.match(/\((\d+) skipped/)?.[1]     ?? "0";
    const cb   = o.includes("⚡") ? "CB" : "no-CB";
    return `ran=${ran} failed=${fail} skipped=${skip} ${cb}`;
  };

  const r1 = extract(cli(["run-all", dir, "--workers", "1", "--circuit-breaker", "2"]));
  const r2 = extract(cli(["run-all", dir, "--workers", "1", "--circuit-breaker", "2"]));

  clean(dir);
  assert.equal(r1, r2, `Run 1 and Run 2 differ:\n  Run 1: ${r1}\n  Run 2: ${r2}`);
});

t("T11 — Parallel + retry isolation: retries scoped per test, no cross-test retry, logs don't mix (--workers 4)", () => {
  const dir = join(TMP, "parallel");
  clean(dir);

  // 4 instant-pass tests (no browser)
  for (let i = 1; i <= 4; i++) {
    writeYaml(dir, `pass${i}.yaml`, `
test:
  name: "Parallel pass ${i}"
  steps:
    - assert:
        value: "same"
        equals: "same"
`);
  }

  // 2 transient fail tests (retry 1 each)
  for (let i = 1; i <= 2; i++) {
    writeYaml(dir, `tfail${i}.yaml`, `
test:
  name: "Parallel transient ${i}"
  retries: 1
  steps:
    - navigate: "http://localhost:9999"
`);
  }

  const out = cli(["run-all", dir, "--workers", "4"], 90_000);

  // Some retry lines must exist (from the 2 transient fail tests)
  assert.ok(out.includes("↺ retry"), `Expected retry lines from transient tests\n${out.slice(0, 500)}`);

  // Pass test blocks must not contain retry lines
  const blocks = out.split(/📋 Test:/);
  for (const block of blocks.filter(b => b.includes("Parallel pass"))) {
    assert.ok(
      !block.includes("↺ retry"),
      `Pass test block contains a retry line — log mixing detected:\n${block.slice(0, 300)}`,
    );
  }

  // Retry blocks must reference TransientError (not AssertionError)
  for (const block of blocks.filter(b => b.includes("Parallel transient"))) {
    if (block.includes("↺ retry")) {
      assert.ok(
        block.includes("TransientError"),
        `Retry in transient block should show TransientError:\n${block.slice(0, 300)}`,
      );
    }
  }

  // Summary: 4 passed, 2 failed
  assert.ok(out.includes("Passed : 4"), `Expected 'Passed : 4'\n${out.match(/Passed.*$/m)?.[0]}`);
  assert.ok(out.includes("Failed: 2"),  `Expected 'Failed: 2'\n${out.match(/Failed.*$/m)?.[0]}`);

  clean(dir);
}, );

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — [Integration] Mixed stress test
// ─────────────────────────────────────────────────────────────────────────────

suite("Suite 5: [Integration] Mixed scenario stress test (--workers 6)");

t("T12 — Stable under mixed load: 3 pass + 2 assertion-fail + 2 transient-fail + 1 multi-step pass", () => {
  const dir = join(TMP, "stress");
  clean(dir);

  // 3 instant-pass tests
  for (let i = 1; i <= 3; i++) {
    writeYaml(dir, `pass${i}.yaml`, `
test:
  name: "Stress pass ${i}"
  steps:
    - assert:
        value: "ok"
        equals: "ok"
`);
  }

  // 1 multi-step pass (more steps = longer queue time)
  writeYaml(dir, "multipass.yaml", `
test:
  name: "Stress multi-step pass"
  steps:
    - assert:
        value: "a"
        equals: "a"
    - assert:
        value: "b"
        equals: "b"
    - assert:
        value: "c"
        equals: "c"
`);

  // 2 assertion-fail tests (should NOT retry even with retries: 2)
  for (let i = 1; i <= 2; i++) {
    writeYaml(dir, `afail${i}.yaml`, `
test:
  name: "Stress assertion fail ${i}"
  retries: 2
  steps:
    - assert:
        value: "wrong"
        equals: "right"
`);
  }

  // 2 transient-fail tests (should retry once each)
  for (let i = 1; i <= 2; i++) {
    writeYaml(dir, `tfail${i}.yaml`, `
test:
  name: "Stress transient fail ${i}"
  retries: 1
  steps:
    - navigate: "http://localhost:9999"
`);
  }

  const out = cli(["run-all", dir, "--workers", "6"], 120_000);

  // 4 passing, 4 failing
  assert.ok(out.includes("Passed : 4"), `Expected 'Passed : 4'\n${out.match(/Passed.*$/m)?.[0]}`);
  assert.ok(out.includes("Failed: 4"),  `Expected 'Failed: 4'\n${out.match(/Failed.*$/m)?.[0]}`);

  // Assertion-fail blocks must have zero retry lines
  const blocks = out.split(/📋 Test:/);
  for (const block of blocks.filter(b => b.includes("assertion fail"))) {
    assert.ok(
      !block.includes("↺ retry"),
      `Assertion fail block should not retry:\n${block.slice(0, 300)}`,
    );
  }

  // Transient-fail blocks should have retry lines
  const transientBlocks = blocks.filter(b => b.includes("transient fail"));
  const retriedCount    = transientBlocks.filter(b => b.includes("↺ retry")).length;
  assert.ok(
    retriedCount >= 1,
    `Expected at least 1 transient block with retry lines, got ${retriedCount}`,
  );

  // No circuit breaker (threshold from staging config = 5, only 4 consecutive fails possible here)
  assert.ok(!out.includes("⚡ Circuit breaker open"), "Unexpected circuit breaker in stress test");

  clean(dir);
}, );

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────

clean(TMP);

const total = passed + failed;
console.log(`\n─────────────────────────────────────────`);
console.log(`   Passed : ${passed}   Failed: ${failed}   Total: ${total}`);

if (failures.length) {
  console.log(`\n   Failed:`);
  failures.forEach(f => console.log(`     • ${f}`));
}

console.log(`─────────────────────────────────────────\n`);
process.exit(failed > 0 ? 1 : 0);
