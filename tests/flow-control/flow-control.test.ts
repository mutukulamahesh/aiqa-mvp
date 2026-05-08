import { WaitHandler }      from "../../src/handlers/WaitHandler";
import { StoreHandler }     from "../../src/handlers/StoreHandler";
import { ConditionHandler, SubStepExecutor } from "../../src/handlers/ConditionHandler";
import { LoopHandler }      from "../../src/handlers/LoopHandler";
import { ExecutionContext }  from "../../src/execution/ExecutionContext";
import { parseTestDefinition } from "../../src/dsl/DslParser";
import { AdapterActions }   from "../../src/adapter/AdapterActions";
import { StepAction }       from "../../src/dsl/types";
import { wrapWithDepthGuard } from "../../src/execution/DepthGuard";

// ── Minimal adapter stub ──────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<AdapterActions> = {}): AdapterActions {
  return {
    navigate:            async () => {},
    click:               async () => {},
    fill:                async () => {},
    assertTextVisible:   async () => {},
    assertUrlContains:   async () => {},
    assertElementVisible:async () => {},
    screenshot:          async () => {},
    currentUrl:          async () => "http://localhost/",
    waitForSelector:     async () => {},
    waitForUrl:          async () => {},
    getElementText:      async () => "",
    getElementAttribute: async () => "",
    ...overrides,
  };
}

function makeCtx(vars: Record<string, unknown> = {}): ExecutionContext {
  const ctx = new ExecutionContext();
  for (const [k, v] of Object.entries(vars)) ctx.set(k, v);
  return ctx;
}

// ── WaitHandler ───────────────────────────────────────────────────────────────

describe("WaitHandler — wait_ms", () => {
  test("resolves after the specified delay", async () => {
    const handler = new WaitHandler();
    const start = Date.now();
    await handler.execute({ action: "wait_ms", ms: 50 }, makeAdapter(), makeCtx());
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  test("zero ms resolves immediately", async () => {
    const handler = new WaitHandler();
    await expect(
      handler.execute({ action: "wait_ms", ms: 0 }, makeAdapter(), makeCtx())
    ).resolves.toBeUndefined();
  });
});

describe("WaitHandler — wait_for_element", () => {
  test("calls adapter.waitForSelector with resolved selector", async () => {
    const calls: string[] = [];
    const adapter = makeAdapter({ waitForSelector: async sel => { calls.push(sel); } });
    const handler = new WaitHandler();
    await handler.execute({ action: "wait_for_element", selector: "#submit" }, adapter, makeCtx());
    expect(calls).toEqual(["#submit"]);
  });

  test("resolves {{ }} templates in selector", async () => {
    const calls: string[] = [];
    const adapter = makeAdapter({ waitForSelector: async sel => { calls.push(sel); } });
    const ctx = makeCtx({ btnId: "confirm" });
    await new WaitHandler().execute({ action: "wait_for_element", selector: "#{{ btnId }}" }, adapter, ctx);
    expect(calls[0]).toBe("#confirm");
  });

  test("propagates adapter error as timed-out message", async () => {
    const adapter = makeAdapter({ waitForSelector: async () => { throw new Error("timeout"); } });
    await expect(
      new WaitHandler().execute({ action: "wait_for_element", selector: "#ghost" }, adapter, makeCtx())
    ).rejects.toThrow('wait_for_element "#ghost" timed out after 10000ms');
  });
});

describe("WaitHandler — wait_for_url", () => {
  test("calls adapter.waitForUrl with resolved url", async () => {
    const calls: string[] = [];
    const adapter = makeAdapter({ waitForUrl: async u => { calls.push(u); } });
    await new WaitHandler().execute({ action: "wait_for_url", url: "/dashboard" }, adapter, makeCtx());
    expect(calls).toEqual(["/dashboard"]);
  });

  test("resolves {{ }} templates in url", async () => {
    const calls: string[] = [];
    const adapter = makeAdapter({ waitForUrl: async u => { calls.push(u); } });
    const ctx = makeCtx({ page: "profile" });
    await new WaitHandler().execute({ action: "wait_for_url", url: "/{{ page }}" }, adapter, ctx);
    expect(calls[0]).toBe("/profile");
  });
});

// ── StoreHandler ──────────────────────────────────────────────────────────────

describe("StoreHandler — text capture", () => {
  test("stores inner text of selector under 'as' key", async () => {
    const adapter = makeAdapter({ getElementText: async () => "Hello World" });
    const ctx = makeCtx();
    await new StoreHandler().execute({ action: "store", selector: ".title", as: "pageTitle" }, adapter, ctx);
    expect(ctx.get("pageTitle")).toBe("Hello World");
  });

  test("resolves {{ }} in selector", async () => {
    const calls: string[] = [];
    const adapter = makeAdapter({ getElementText: async sel => { calls.push(sel); return "x"; } });
    const ctx = makeCtx({ row: "3" });
    await new StoreHandler().execute({ action: "store", selector: ".row-{{ row }}", as: "v" }, adapter, ctx);
    expect(calls[0]).toBe(".row-3");
  });

  test("stored value is resolvable in later {{ }} templates", async () => {
    const adapter = makeAdapter({ getElementText: async () => "tok_abc123" });
    const ctx = makeCtx();
    await new StoreHandler().execute({ action: "store", selector: "#token", as: "token" }, adapter, ctx);
    expect(ctx.resolve("Bearer {{ token }}")).toBe("Bearer tok_abc123");
  });
});

describe("StoreHandler — attribute capture", () => {
  test("stores attribute value when attribute is given", async () => {
    const adapter = makeAdapter({ getElementAttribute: async (_sel, attr) => attr === "href" ? "/profile/42" : "" });
    const ctx = makeCtx();
    await new StoreHandler().execute({ action: "store", selector: "a.profile", attribute: "href", as: "profileUrl" }, adapter, ctx);
    expect(ctx.get("profileUrl")).toBe("/profile/42");
  });

  test("attribute='text' falls back to innerText", async () => {
    const adapter = makeAdapter({
      getElementText:      async () => "inner",
      getElementAttribute: async () => "attr",
    });
    const ctx = makeCtx();
    await new StoreHandler().execute({ action: "store", selector: "#el", attribute: "text", as: "v" }, adapter, ctx);
    expect(ctx.get("v")).toBe("inner");
  });

  test("no attribute defaults to innerText", async () => {
    const adapter = makeAdapter({
      getElementText:      async () => "inner",
      getElementAttribute: async () => "should-not-be-called",
    });
    const ctx = makeCtx();
    await new StoreHandler().execute({ action: "store", selector: "#el", as: "v" }, adapter, ctx);
    expect(ctx.get("v")).toBe("inner");
  });
});

// ── ConditionHandler ──────────────────────────────────────────────────────────

describe("ConditionHandler — if branching", () => {
  function makeConditionHandler() {
    const executed: StepAction[] = [];
    const executor = async (step: StepAction) => { executed.push(step); };
    return { handler: new ConditionHandler(executor), executed };
  }

  test("runs sub-steps when variable equals expected", async () => {
    const { handler, executed } = makeConditionHandler();
    const ctx = makeCtx({ role: "admin" });
    await handler.execute({
      action: "if", variable: "{{ role }}", equals: "admin",
      steps: [{ action: "navigate", target: "/admin" }],
    }, makeAdapter(), ctx);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ action: "navigate", target: "/admin" });
  });

  test("skips sub-steps when condition is false", async () => {
    const { handler, executed } = makeConditionHandler();
    const ctx = makeCtx({ role: "viewer" });
    await handler.execute({
      action: "if", variable: "{{ role }}", equals: "admin",
      steps: [{ action: "navigate", target: "/admin" }],
    }, makeAdapter(), ctx);
    expect(executed).toHaveLength(0);
  });

  test("runs multiple sub-steps in order", async () => {
    const { handler, executed } = makeConditionHandler();
    const ctx = makeCtx({ flag: "yes" });
    await handler.execute({
      action: "if", variable: "{{ flag }}", equals: "yes",
      steps: [
        { action: "navigate", target: "/a" },
        { action: "navigate", target: "/b" },
        { action: "navigate", target: "/c" },
      ],
    }, makeAdapter(), ctx);
    expect(executed.map(s => (s as { target: string }).target)).toEqual(["/a", "/b", "/c"]);
  });

  test("resolves {{ }} templates in equals", async () => {
    const { handler, executed } = makeConditionHandler();
    const ctx = makeCtx({ current: "active", expected: "active" });
    await handler.execute({
      action: "if", variable: "{{ current }}", equals: "{{ expected }}",
      steps: [{ action: "navigate", target: "/ok" }],
    }, makeAdapter(), ctx);
    expect(executed).toHaveLength(1);
  });

  test("empty steps array is valid (no-op branch)", async () => {
    const { handler, executed } = makeConditionHandler();
    const ctx = makeCtx({ x: "y" });
    await expect(
      handler.execute({ action: "if", variable: "{{ x }}", equals: "y", steps: [] }, makeAdapter(), ctx)
    ).resolves.toBeUndefined();
    expect(executed).toHaveLength(0);
  });
});

// ── LoopHandler ───────────────────────────────────────────────────────────────

describe("LoopHandler — for_each", () => {
  function makeLoopHandler() {
    const iterations: unknown[] = [];
    const executor = async (_step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext) => {
      iterations.push(ctx.get("item"));
    };
    return { handler: new LoopHandler(executor), iterations };
  }

  test("iterates over each item in the array", async () => {
    const { handler, iterations } = makeLoopHandler();
    const ctx = makeCtx();
    ctx.set("orders", [{ id: 1 }, { id: 2 }, { id: 3 }]);
    await handler.execute({
      action: "for_each", over: "{{ orders }}", as: "item",
      steps: [{ action: "navigate", target: "/" }],
    }, makeAdapter(), ctx);
    expect(iterations).toHaveLength(3);
    expect(iterations[0]).toEqual({ id: 1 });
    expect(iterations[2]).toEqual({ id: 3 });
  });

  test("over without braces also works", async () => {
    const { handler, iterations } = makeLoopHandler();
    const ctx = makeCtx();
    ctx.set("items", ["a", "b"]);
    await handler.execute({
      action: "for_each", over: "items", as: "item",
      steps: [{ action: "navigate", target: "/" }],
    }, makeAdapter(), ctx);
    expect(iterations).toEqual(["a", "b"]);
  });

  test("empty array runs zero iterations", async () => {
    const { handler, iterations } = makeLoopHandler();
    const ctx = makeCtx();
    ctx.set("list", []);
    await handler.execute({
      action: "for_each", over: "list", as: "item",
      steps: [{ action: "navigate", target: "/" }],
    }, makeAdapter(), ctx);
    expect(iterations).toHaveLength(0);
  });

  test("throws AssertionError when variable is not an array", async () => {
    const { handler } = makeLoopHandler();
    const ctx = makeCtx();
    ctx.set("notAList", "just a string");
    await expect(
      handler.execute({ action: "for_each", over: "notAList", as: "item", steps: [] }, makeAdapter(), ctx)
    ).rejects.toThrow("expected array, got string");
  });

  test("throws AssertionError when variable is undefined", async () => {
    const { handler } = makeLoopHandler();
    await expect(
      handler.execute({ action: "for_each", over: "missing", as: "item", steps: [] }, makeAdapter(), makeCtx())
    ).rejects.toThrow("expected array, got undefined");
  });

  test("throws when list length exceeds maxIterations", async () => {
    const { handler } = makeLoopHandler();
    const ctx = makeCtx();
    ctx.set("bigList", Array(LoopHandler.MAX_ITERATIONS + 1).fill(0));
    await expect(
      handler.execute({ action: "for_each", over: "bigList", as: "item", steps: [] }, makeAdapter(), ctx)
    ).rejects.toThrow(`for_each exceeded maxIterations (${LoopHandler.MAX_ITERATIONS})`);
  });

  test("each iteration binds current item under 'as' key — dot notation works", async () => {
    const seen: string[] = [];
    const executor = async (_step: StepAction, _adapter: AdapterActions, ctx: ExecutionContext) => {
      seen.push(ctx.resolve("{{ user.name }}"));
    };
    const handler = new LoopHandler(executor);
    const ctx = makeCtx();
    ctx.set("users", [{ name: "Alice" }, { name: "Bob" }]);
    await handler.execute({
      action: "for_each", over: "users", as: "user",
      steps: [{ action: "navigate", target: "/" }],
    }, makeAdapter(), ctx);
    expect(seen).toEqual(["Alice", "Bob"]);
  });

  test("runs multiple sub-steps per iteration", async () => {
    const log: string[] = [];
    const executor = async (step: StepAction) => { log.push(step.action); };
    const handler = new LoopHandler(executor);
    const ctx = makeCtx();
    ctx.set("list", [1, 2]);
    await handler.execute({
      action: "for_each", over: "list", as: "i",
      steps: [
        { action: "navigate", target: "/a" },
        { action: "navigate", target: "/b" },
      ],
    }, makeAdapter(), ctx);
    expect(log).toEqual(["navigate", "navigate", "navigate", "navigate"]);
  });
});

// ── WaitHandler — timeout error ───────────────────────────────────────────────

describe("WaitHandler — wait_for_element timeout error", () => {
  test("wraps adapter failure with clear timed-out message", async () => {
    const adapter = makeAdapter({ waitForSelector: async () => { throw new Error("locator timeout"); } });
    await expect(
      new WaitHandler().execute({ action: "wait_for_element", selector: "#spinner" }, adapter, makeCtx())
    ).rejects.toThrow('wait_for_element "#spinner" timed out after 10000ms');
  });

  test("resolves template before including selector in error", async () => {
    const adapter = makeAdapter({ waitForSelector: async () => { throw new Error("timeout"); } });
    const ctx = makeCtx({ id: "btn" });
    await expect(
      new WaitHandler().execute({ action: "wait_for_element", selector: "#{{ id }}" }, adapter, ctx)
    ).rejects.toThrow('wait_for_element "#btn" timed out after 10000ms');
  });

  test("uses custom timeout in error message when step.timeout is set", async () => {
    const adapter = makeAdapter({ waitForSelector: async () => { throw new Error("timeout"); } });
    await expect(
      new WaitHandler().execute({ action: "wait_for_element", selector: "#btn", timeout: 5000 }, adapter, makeCtx())
    ).rejects.toThrow('wait_for_element "#btn" timed out after 5000ms');
  });

  test("passes custom timeout to adapter.waitForSelector", async () => {
    const calls: [string, number | undefined][] = [];
    const adapter = makeAdapter({ waitForSelector: async (sel, ms) => { calls.push([sel, ms]); } });
    await new WaitHandler().execute({ action: "wait_for_element", selector: "#el", timeout: 3000 }, adapter, makeCtx());
    expect(calls[0]).toEqual(["#el", 3000]);
  });

  test("defaults to 10 000 ms when no step.timeout (config not loaded)", async () => {
    const calls: [string, number | undefined][] = [];
    const adapter = makeAdapter({ waitForSelector: async (sel, ms) => { calls.push([sel, ms]); } });
    await new WaitHandler().execute({ action: "wait_for_element", selector: "#el" }, adapter, makeCtx());
    expect(calls[0]).toEqual(["#el", 10000]);
  });

  test("normalises timeout: 0 to 1ms (Playwright 0 means 'no timeout')", async () => {
    const calls: [string, number | undefined][] = [];
    const adapter = makeAdapter({ waitForSelector: async (sel, ms) => { calls.push([sel, ms]); } });
    await new WaitHandler().execute({ action: "wait_for_element", selector: "#el", timeout: 0 }, adapter, makeCtx());
    expect(calls[0][1]).toBe(1);
  });

  test("error message reflects normalised 1ms when timeout: 0 fails", async () => {
    const adapter = makeAdapter({ waitForSelector: async () => { throw new Error("miss"); } });
    await expect(
      new WaitHandler().execute({ action: "wait_for_element", selector: "#el", timeout: 0 }, adapter, makeCtx())
    ).rejects.toThrow('wait_for_element "#el" timed out after 1ms');
  });
});

// ── StoreHandler — error messages ────────────────────────────────────────────

describe("StoreHandler — error messages", () => {
  test("wraps getElementText failure with selector-not-found message", async () => {
    const adapter = makeAdapter({ getElementText: async () => { throw new Error("no element"); } });
    await expect(
      new StoreHandler().execute({ action: "store", selector: "#missing", as: "v" }, adapter, makeCtx())
    ).rejects.toThrow('store failed: selector "#missing" not found');
  });

  test("wraps getElementAttribute failure with attribute-not-found message", async () => {
    const adapter = makeAdapter({ getElementAttribute: async () => { throw new Error("no attr"); } });
    await expect(
      new StoreHandler().execute({ action: "store", selector: "#el", attribute: "data-x", as: "v" }, adapter, makeCtx())
    ).rejects.toThrow('store failed: attribute "data-x" not found on "#el"');
  });
});

// ── DepthGuard ────────────────────────────────────────────────────────────────

describe("wrapWithDepthGuard", () => {
  test("allows calls within maxDepth", async () => {
    let callCount = 0;
    const base: SubStepExecutor = async () => { callCount++; };
    const guarded = wrapWithDepthGuard(base, 3);
    await guarded({ action: "navigate", target: "/" } as StepAction, makeAdapter(), makeCtx());
    expect(callCount).toBe(1);
  });

  test("throws when nesting exceeds maxDepth", async () => {
    let guarded: SubStepExecutor;
    let callDepth = 0;
    const recursive: SubStepExecutor = async (step, adapter, ctx) => {
      callDepth++;
      if (callDepth < 20) await guarded(step, adapter, ctx);
    };
    guarded = wrapWithDepthGuard(recursive, 5);
    await expect(
      guarded({ action: "navigate", target: "/" } as StepAction, makeAdapter(), makeCtx())
    ).rejects.toThrow("Max step nesting depth exceeded (5)");
  });

  test("depth resets correctly after a successful call", async () => {
    let callCount = 0;
    const base: SubStepExecutor = async () => { callCount++; };
    const guarded = wrapWithDepthGuard(base, 2);
    const step = { action: "navigate", target: "/" } as StepAction;
    await guarded(step, makeAdapter(), makeCtx());
    await guarded(step, makeAdapter(), makeCtx());
    await guarded(step, makeAdapter(), makeCtx());
    expect(callCount).toBe(3);
  });

  test("depth resets after a failed call", async () => {
    const failing: SubStepExecutor = async () => { throw new Error("boom"); };
    const guarded = wrapWithDepthGuard(failing, 3);
    const step = { action: "navigate", target: "/" } as StepAction;
    await expect(guarded(step, makeAdapter(), makeCtx())).rejects.toThrow("boom");
    // Depth should be back to 0 — second call should not false-trigger depth guard
    await expect(guarded(step, makeAdapter(), makeCtx())).rejects.toThrow("boom");
  });
});

// ── DslParser — new step types ────────────────────────────────────────────────

describe("DslParser — flow control steps", () => {
  function parse(yaml: string) { return parseTestDefinition(yaml).steps[0]; }

  test("parses wait_for_element (string shorthand)", () => {
    expect(parse(`
test:
  name: t
  steps:
    - wait_for_element: "#submit"
`)).toEqual({ action: "wait_for_element", selector: "#submit" });
  });

  test("parses wait_for_element (object form with timeout)", () => {
    expect(parse(`
test:
  name: t
  steps:
    - wait_for_element:
        selector: "#login"
        timeout: 5000
`)).toEqual({ action: "wait_for_element", selector: "#login", timeout: 5000 });
  });

  test("parses wait_for_element (object form without timeout)", () => {
    expect(parse(`
test:
  name: t
  steps:
    - wait_for_element:
        selector: "#login"
`)).toEqual({ action: "wait_for_element", selector: "#login" });
  });

  test("throws on wait_for_element with negative timeout", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - wait_for_element:
        selector: "#el"
        timeout: -100
`)).toThrow("timeout");
  });

  test("parses wait_ms", () => {
    expect(parse(`
test:
  name: t
  steps:
    - wait_ms: 500
`)).toEqual({ action: "wait_ms", ms: 500 });
  });

  test("parses wait_for_url", () => {
    expect(parse(`
test:
  name: t
  steps:
    - wait_for_url: "/dashboard"
`)).toEqual({ action: "wait_for_url", url: "/dashboard" });
  });

  test("parses store with text (default)", () => {
    expect(parse(`
test:
  name: t
  steps:
    - store:
        selector: ".token"
        as: token
`)).toMatchObject({ action: "store", selector: ".token", as: "token" });
  });

  test("parses store with explicit attribute", () => {
    expect(parse(`
test:
  name: t
  steps:
    - store:
        selector: "a.profile"
        attribute: href
        as: profileUrl
`)).toMatchObject({ action: "store", selector: "a.profile", attribute: "href", as: "profileUrl" });
  });

  test("parses if with sub-steps", () => {
    const step = parse(`
test:
  name: t
  steps:
    - if:
        variable: "{{ role }}"
        equals: admin
        steps:
          - navigate: /admin
`);
    expect(step).toMatchObject({ action: "if", variable: "{{ role }}", equals: "admin" });
    expect((step as { steps: unknown[] }).steps).toHaveLength(1);
  });

  test("parses for_each with sub-steps", () => {
    const step = parse(`
test:
  name: t
  steps:
    - for_each:
        over: "{{ orders }}"
        as: order
        steps:
          - navigate: /check
`);
    expect(step).toMatchObject({ action: "for_each", over: "{{ orders }}", as: "order" });
    expect((step as { steps: unknown[] }).steps).toHaveLength(1);
  });

  test("throws on wait_ms with non-number", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - wait_ms: "fast"
`)).toThrow("non-negative number");
  });

  test("throws on store missing 'as'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - store:
        selector: "#el"
`)).toThrow('missing "as"');
  });

  test("throws on if missing 'variable'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - if:
        equals: admin
        steps: []
`)).toThrow('missing "variable"');
  });

  test("throws on for_each missing 'steps'", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - for_each:
        over: items
        as: item
`)).toThrow('missing "steps"');
  });

  test("new actions appear in unknown-action error message", () => {
    expect(() => parse(`
test:
  name: t
  steps:
    - unknown_action: foo
`)).toThrow("wait_for_element");
  });
});
