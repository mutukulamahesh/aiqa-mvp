import { StubDesktopAdapter }   from "../../src/desktop/DesktopAdapter";
import { DesktopHandler }        from "../../src/handlers/DesktopHandler";
import { StubVisionAgent }       from "../../src/vision/VisionAgent";
import { StubOcrEngine }         from "../../src/vision/OcrEngine";
import { ExecutionContext }       from "../../src/execution/ExecutionContext";
import { AssertionError, TransientError } from "../../src/errors";
import type { DetectedElement }  from "../../src/vision/types";

const SCREEN = { width: 1920, height: 1080 };

function loginBtn(): DetectedElement {
  return {
    id: "e1", type: "button", description: "Login button", text: "Login",
    bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.05 }, confidence: 0.95,
  };
}

function makeHandler(opts: {
  elements?: DetectedElement[];
  windowTitle?: string;
} = {}) {
  const adapter = new StubDesktopAdapter({ screenSize: SCREEN, windowTitle: opts.windowTitle ?? "MyApp" });
  const vision  = new StubVisionAgent(opts.elements ?? []);
  const ocr     = new StubOcrEngine();
  const handler = new DesktopHandler(adapter, vision, ocr);
  const ctx     = new ExecutionContext({}, null);
  return { handler, adapter, ctx };
}

describe("DesktopHandler", () => {
  // desktop_launch
  test("desktop_launch calls adapter.launch with resolved path", async () => {
    const { handler, adapter, ctx } = makeHandler();
    await handler.execute({ action: "desktop_launch", appPath: "C:/app/test.exe" }, ctx);
    expect(adapter.calls[0]).toMatchObject({ method: "launch", args: ["C:/app/test.exe"] });
  });

  // desktop_wait_for_window
  test("desktop_wait_for_window calls adapter.waitForWindow", async () => {
    const { handler, adapter, ctx } = makeHandler();
    await handler.execute({ action: "desktop_wait_for_window", pattern: "MyApp", timeout: 5000 }, ctx);
    expect(adapter.calls[0]).toMatchObject({ method: "waitForWindow", args: ["MyApp", 5000] });
  });

  // desktop_click
  test("desktop_click locates element and calls adapter.click", async () => {
    const { handler, adapter, ctx } = makeHandler({ elements: [loginBtn()] });
    await handler.execute({ action: "desktop_click", description: "Login button" }, ctx);
    const clickCall = adapter.calls.find(c => c.method === "click");
    expect(clickCall).toBeDefined();
    const [x, y] = clickCall!.args as [number, number];
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  test("desktop_click throws TransientError when element not found", async () => {
    const { handler, ctx } = makeHandler();
    await expect(
      handler.execute({ action: "desktop_click", description: "Ghost button" }, ctx)
    ).rejects.toBeInstanceOf(TransientError);
  });

  // desktop_fill — click-to-focus verification (L2)
  test("desktop_fill calls click before typeText", async () => {
    const { handler, adapter, ctx } = makeHandler({ elements: [loginBtn()], windowTitle: "Login" });
    await handler.execute({
      action: "desktop_fill", target: "Login button", value: "admin",
      expected_window: "Login",
    }, ctx);
    const methods = adapter.calls.map(c => c.method);
    const clickIdx = methods.indexOf("click");
    const typeIdx  = methods.indexOf("typeText");
    expect(clickIdx).toBeGreaterThanOrEqual(0);
    expect(typeIdx).toBeGreaterThan(clickIdx);
  });

  test("desktop_fill types the correct value", async () => {
    const { handler, adapter, ctx } = makeHandler({ elements: [loginBtn()], windowTitle: "Login" });
    await handler.execute({
      action: "desktop_fill", target: "Login button", value: "mypassword",
      expected_window: "Login",
    }, ctx);
    const typeCall = adapter.calls.find(c => c.method === "typeText");
    expect(typeCall?.args[0]).toBe("mypassword");
  });

  test("desktop_fill throws AssertionError when window guard fails before locate", async () => {
    const { handler, ctx } = makeHandler({ elements: [loginBtn()], windowTitle: "OtherApp" });
    await expect(
      handler.execute({
        action: "desktop_fill", target: "Login button", value: "x",
        expected_window: "Login",
      }, ctx)
    ).rejects.toBeInstanceOf(AssertionError);
  });

  test("desktop_fill throws TransientError when element not found", async () => {
    const { handler, ctx } = makeHandler({ windowTitle: "Login" });
    await expect(
      handler.execute({
        action: "desktop_fill", target: "Nonexistent field", value: "x",
        expected_window: "Login",
      }, ctx)
    ).rejects.toBeInstanceOf(TransientError);
  });

  // desktop_assert
  test("desktop_assert passes when expected_window matches", async () => {
    const { handler, ctx } = makeHandler({ windowTitle: "Dashboard" });
    await expect(
      handler.execute({ action: "desktop_assert", expected_window: "Dashboard" }, ctx)
    ).resolves.toBeUndefined();
  });

  test("desktop_assert throws AssertionError when window title mismatches", async () => {
    const { handler, ctx } = makeHandler({ windowTitle: "Login" });
    await expect(
      handler.execute({ action: "desktop_assert", expected_window: "Dashboard" }, ctx)
    ).rejects.toBeInstanceOf(AssertionError);
  });

  test("desktop_assert passes when visible element found", async () => {
    const { handler, ctx } = makeHandler({ elements: [loginBtn()] });
    await expect(
      handler.execute({ action: "desktop_assert", visible: "Login button" }, ctx)
    ).resolves.toBeUndefined();
  });

  test("desktop_assert throws AssertionError (not Transient) when visible element missing", async () => {
    const { handler, ctx } = makeHandler();
    await expect(
      handler.execute({ action: "desktop_assert", visible: "Missing element" }, ctx)
    ).rejects.toBeInstanceOf(AssertionError);
  });

  // desktop_key
  test("desktop_key calls adapter.pressKey", async () => {
    const { handler, adapter, ctx } = makeHandler();
    await handler.execute({ action: "desktop_key", key: "Return" }, ctx);
    expect(adapter.calls[0]).toMatchObject({ method: "pressKey", args: ["Return"] });
  });

  // desktop_close
  test("desktop_close calls adapter.close", async () => {
    const { handler, adapter, ctx } = makeHandler();
    await handler.execute({ action: "desktop_close" }, ctx);
    expect(adapter.calls[0]).toMatchObject({ method: "close", args: [] });
  });

  // unknown step
  test("unknown step throws with clear message", async () => {
    const { handler, ctx } = makeHandler();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler.execute({ action: "navigate" as any, target: "https://x.com" }, ctx)
    ).rejects.toThrow(/not a desktop step/);
  });
});
