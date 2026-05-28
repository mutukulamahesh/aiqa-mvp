import { StubDesktopAdapter } from "../../src/desktop/DesktopAdapter";

describe("StubDesktopAdapter", () => {
  let adapter: StubDesktopAdapter;

  beforeEach(() => {
    adapter = new StubDesktopAdapter({ screenSize: { width: 1920, height: 1080 }, windowTitle: "TestApp" });
  });

  test("records launch call with appPath", async () => {
    await adapter.launch("C:/app/test.exe");
    expect(adapter.calls).toEqual([{ method: "launch", args: ["C:/app/test.exe"] }]);
  });

  test("records click with coordinates", async () => {
    await adapter.click(960, 540);
    expect(adapter.calls).toEqual([{ method: "click", args: [960, 540] }]);
  });

  test("records typeText before click in test verification", async () => {
    await adapter.click(100, 200);
    await adapter.typeText("hello");
    expect(adapter.calls[0]).toMatchObject({ method: "click" });
    expect(adapter.calls[1]).toMatchObject({ method: "typeText", args: ["hello"] });
  });

  test("screenshot returns configured buffer", async () => {
    const buf = Buffer.from([1, 2, 3]);
    const a   = new StubDesktopAdapter({ screenshot: buf });
    const result = await a.screenshot();
    expect(result).toBe(buf);
  });

  test("getScreenSize returns configured dimensions", async () => {
    const size = await adapter.getScreenSize();
    expect(size).toEqual({ width: 1920, height: 1080 });
  });

  test("getWindowTitle returns configured title", async () => {
    const title = await adapter.getWindowTitle();
    expect(title).toBe("TestApp");
  });

  test("pressKey records key name", async () => {
    await adapter.pressKey("Return");
    expect(adapter.calls).toEqual([{ method: "pressKey", args: ["Return"] }]);
  });

  test("close records call", async () => {
    await adapter.close();
    expect(adapter.calls).toEqual([{ method: "close", args: [] }]);
  });

  test("waitForWindow records call with pattern and default timeout", async () => {
    await adapter.waitForWindow("MyApp");
    expect(adapter.calls[0]).toMatchObject({ method: "waitForWindow", args: ["MyApp", 10_000] });
  });

  test("waitForWindow records call with custom timeout", async () => {
    await adapter.waitForWindow(/Dashboard/i, 5000);
    expect(adapter.calls[0]).toMatchObject({ method: "waitForWindow", args: [/Dashboard/i, 5000] });
  });

  test("all methods append to shared calls array", async () => {
    await adapter.launch("app.exe");
    await adapter.getWindowTitle();
    await adapter.screenshot();
    await adapter.getScreenSize();
    await adapter.close();
    expect(adapter.calls.map(c => c.method)).toEqual([
      "launch", "getWindowTitle", "screenshot", "getScreenSize", "close",
    ]);
  });

  test("default constructor uses 1920x1080 and empty title", async () => {
    const def = new StubDesktopAdapter();
    expect(await def.getScreenSize()).toEqual({ width: 1920, height: 1080 });
    expect(await def.getWindowTitle()).toBe("");
  });
});
