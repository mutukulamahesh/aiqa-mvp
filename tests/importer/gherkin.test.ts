import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextImporter } from "../../src/importers/TextImporter";

let tmpFile = "";

const writeFeature = (content: string): void => {
  tmpFile = path.join(os.tmpdir(), `aiqa-gherkin-${Date.now()}.feature`);
  fs.writeFileSync(tmpFile, content, "utf-8");
};

const writeTxt = (content: string): void => {
  tmpFile = path.join(os.tmpdir(), `aiqa-text-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, content, "utf-8");
};

afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  tmpFile = "";
});

describe("TextImporter — Gherkin", () => {
  it("produces one RawTestCase per Scenario", () => {
    writeFeature(`Feature: Login
Scenario: Valid login
  Given user is on login page
  When user enters credentials
  Then dashboard is shown`);
    const results = new TextImporter().import(tmpFile);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Valid login");
    expect(results[0].steps).toHaveLength(3);
  });

  it("strips Given/When/Then keywords from step text", () => {
    writeFeature(`Feature: Auth
Scenario: Login
  Given I am on the homepage
  When I click the login link
  Then I see the dashboard`);
    const [tc] = new TextImporter().import(tmpFile);
    expect(tc.steps[0]).toBe("I am on the homepage");
    expect(tc.steps[1]).toBe("I click the login link");
    expect(tc.steps[2]).toBe("I see the dashboard");
  });

  it("prepends Background steps to every Scenario", () => {
    writeFeature(`Feature: Auth
Background:
  Given the app is running

Scenario: Login
  When I enter credentials
  Then I see the dashboard

Scenario: Logout
  When I click logout
  Then I am redirected`);
    const [login, logout] = new TextImporter().import(tmpFile);
    expect(login.steps[0]).toBe("the app is running");
    expect(logout.steps[0]).toBe("the app is running");
    expect(login.steps).toHaveLength(3);
    expect(logout.steps).toHaveLength(3);
  });

  it("skips comment lines (#)", () => {
    writeFeature(`Feature: Auth
# top-level comment
Scenario: Login
  # step comment
  Given I open the page
  Then I see the title`);
    const [tc] = new TextImporter().import(tmpFile);
    expect(tc.steps).toHaveLength(2);
  });

  it("skips @tag annotation lines", () => {
    writeFeature(`Feature: Auth
@smoke @critical
Scenario: Login
  Given I open the site
  Then I see the homepage`);
    const [tc] = new TextImporter().import(tmpFile);
    expect(tc.name).toBe("Login");
    expect(tc.steps).toHaveLength(2);
  });

  it("parses Scenario Outline as a single test case with placeholder steps", () => {
    writeFeature(`Feature: Auth
Scenario Outline: Login with <user>
  Given I enter "<email>" in email
  When I click login
  Then I see the dashboard

  Examples:
    | user  | email          |
    | admin | admin@test.com |`);
    const results = new TextImporter().import(tmpFile);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Login with <user>");
    expect(results[0].steps[0]).toBe(`I enter "<email>" in email`);
  });

  it("handles And/But keywords the same as Given/When/Then", () => {
    writeFeature(`Feature: Auth
Scenario: Login
  Given I open the site
  And I accept cookies
  When I click login
  But I skip 2FA
  Then I see the dashboard`);
    const [tc] = new TextImporter().import(tmpFile);
    expect(tc.steps).toHaveLength(5);
  });
});

describe("TextImporter — plain text", () => {
  it("parses Test/Steps/Expected labels from plain text", () => {
    writeTxt(`Test: Checkout flow
Steps:
1. Open homepage
2. Add item to cart
3. Complete checkout
Expected: Order confirmed`);
    const [tc] = new TextImporter().import(tmpFile);
    expect(tc.name).toBe("Checkout flow");
    expect(tc.steps).toEqual(["Open homepage", "Add item to cart", "Complete checkout"]);
    expect(tc.expected).toBe("Order confirmed");
  });

  it("separates multiple test cases by blank line", () => {
    writeTxt(`Test: TC1
Steps:
1. Step one

Test: TC2
Steps:
1. Step two`);
    expect(new TextImporter().import(tmpFile)).toHaveLength(2);
  });
});
