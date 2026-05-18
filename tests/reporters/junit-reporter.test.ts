import * as os   from "os";
import * as path from "path";
import * as fs   from "fs";
import { JUnitReporter } from "../../src/reporters/JUnitReporter";
import { TestResult }    from "../../src/runner/TestRunner";

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId:      "t1",
    testName:    "Login test",
    tags:        ["smoke"],
    passed:      true,
    durationMs:  1200,
    retryCount:  0,
    stepResults: [
      { index: 0, action: "navigate", passed: true, durationMs: 300 },
      { index: 1, action: "assert",   passed: true, durationMs: 100 },
    ],
    ...overrides,
  };
}

function tmpFile() {
  return path.join(os.tmpdir(), `junit-${Date.now()}.xml`);
}

describe("JUnitReporter.buildXml", () => {
  const reporter = new JUnitReporter();

  test("produces valid XML declaration and root element", () => {
    const xml = reporter.buildXml([]);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<testsuites");
    expect(xml).toContain("</testsuites>");
  });

  test("tests and failures counts are correct for a mix of pass/fail", () => {
    const results = [
      makeResult({ passed: true }),
      makeResult({ testName: "Checkout", passed: false, error: "Element not found" }),
    ];
    const xml = reporter.buildXml(results);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
  });

  test("all-pass report has failures=0", () => {
    const xml = reporter.buildXml([makeResult(), makeResult({ testName: "B" })]);
    expect(xml).toContain('failures="0"');
  });

  test("passing test case has no <failure> element", () => {
    const xml = reporter.buildXml([makeResult({ passed: true })]);
    expect(xml).not.toContain("<failure");
  });

  test("failing test case includes <failure> with message", () => {
    const xml = reporter.buildXml([
      makeResult({ passed: false, error: "Timeout waiting for selector" }),
    ]);
    expect(xml).toContain('<failure message="Timeout waiting for selector"');
    expect(xml).toContain("</failure>");
  });

  test("time attribute is in seconds (not ms)", () => {
    const xml = reporter.buildXml([makeResult({ durationMs: 2500 })]);
    expect(xml).toContain('time="2.500"');
  });

  test("XML-special characters in test name are escaped", () => {
    const xml = reporter.buildXml([makeResult({ testName: 'A & B <ok> "test"' })]);
    expect(xml).toContain("A &amp; B &lt;ok&gt; &quot;test&quot;");
    expect(xml).not.toContain("<ok>");
  });

  test("XML-special characters in error message are escaped", () => {
    const xml = reporter.buildXml([
      makeResult({ passed: false, error: 'Expected "yes" but got <none>' }),
    ]);
    expect(xml).toContain("Expected &quot;yes&quot; but got &lt;none&gt;");
  });

  test("empty results produce valid XML with 0 tests", () => {
    const xml = reporter.buildXml([]);
    expect(xml).toContain('tests="0"');
    expect(xml).toContain('failures="0"');
  });

  test("custom suiteName appears in testsuites and testsuite", () => {
    const xml = reporter.buildXml([makeResult()], "My Suite");
    const nameCount = (xml.match(/name="My Suite"/g) ?? []).length;
    expect(nameCount).toBeGreaterThanOrEqual(2);
  });

  test("testsuite includes errors=0 and a timestamp attribute", () => {
    const xml = reporter.buildXml([makeResult()]);
    expect(xml).toContain('errors="0"');
    expect(xml).toMatch(/timestamp="[0-9T:.Z-]+"/);
  });

  test("classname uses testId, not testName", () => {
    const xml = reporter.buildXml([makeResult({ testId: "login-test", testName: "Login test" })]);
    expect(xml).toContain('classname="login-test"');
    expect(xml).not.toContain('classname="Login test"');
  });
});

describe("JUnitReporter.generate", () => {
  test("writes XML to the specified file", () => {
    const outPath = tmpFile();
    new JUnitReporter().generate([makeResult()], outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, "utf-8");
    expect(content).toContain("<testsuites");
    fs.unlinkSync(outPath);
  });

  test("creates parent directory if it does not exist", () => {
    const dir     = path.join(os.tmpdir(), `aiqa-junit-${Date.now()}`);
    const outPath = path.join(dir, "results.xml");
    new JUnitReporter().generate([makeResult()], outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });
});
