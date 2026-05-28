import type { IDesktopAdapter }      from "../desktop/DesktopAdapter";
import { DesktopVisionLocator,
         AmbiguousElementError,
         ElementNotFoundError }       from "../desktop/DesktopVisionLocator";
import type { IVisionAgent }          from "../vision/VisionAgent";
import type { IOcrEngine }            from "../vision/OcrEngine";
import type { StepAction }            from "../dsl/types";
import { ExecutionContext }           from "../execution/ExecutionContext";
import { AssertionError, TransientError } from "../errors";
import { wwrite }                     from "../execution/WorkerContext";

// Higher confidence floor for fill than click — typing into the wrong coordinate
// on a native desktop app is unrecoverable (no sandbox, no page isolation).
const FILL_MIN_CONFIDENCE = 0.85;

export class DesktopHandler {
  private readonly locator: DesktopVisionLocator;

  constructor(
    private readonly adapter: IDesktopAdapter,
    vision: IVisionAgent,
    ocr:    IOcrEngine,
  ) {
    this.locator = new DesktopVisionLocator(adapter, vision, ocr);
  }

  async execute(step: StepAction, ctx: ExecutionContext): Promise<void> {
    switch (step.action) {

      case "desktop_launch": {
        const appPath = ctx.resolve(step.appPath);
        wwrite(`desktop_launch: ${appPath}`);
        await this.adapter.launch(appPath);
        break;
      }

      case "desktop_wait_for_window": {
        const pattern = ctx.resolve(step.pattern);
        wwrite(`desktop_wait_for_window: "${pattern}"`);
        await this.adapter.waitForWindow(pattern, step.timeout);
        break;
      }

      case "desktop_click": {
        const description  = ctx.resolve(step.description);
        const minConf      = step.min_confidence ?? 0.8;
        wwrite(`desktop_click: "${description}"`);
        try {
          const el = await this.locator.locate(description, minConf);
          await this.adapter.click(el.x, el.y);
        } catch (e) {
          if (e instanceof AmbiguousElementError) throw new AssertionError(e.message);
          if (e instanceof ElementNotFoundError)  throw new TransientError(e.message);
          throw e;
        }
        break;
      }

      case "desktop_fill": {
        const target         = ctx.resolve(step.target);
        const value          = ctx.resolve(step.value);
        const expectedWindow = step.expected_window !== undefined
          ? ctx.resolve(step.expected_window) : undefined;
        const minConf        = step.min_confidence ?? FILL_MIN_CONFIDENCE;

        wwrite(`desktop_fill: "${target}" = "${value}"`);

        // Window guard before locate (caution #3)
        await this.guardWindow(expectedWindow, "before locate");

        let el;
        try {
          el = await this.locator.locate(target, minConf);
        } catch (e) {
          if (e instanceof AmbiguousElementError) throw new AssertionError(e.message);
          if (e instanceof ElementNotFoundError)  throw new TransientError(e.message);
          throw e;
        }

        // Click to focus (L2), then re-verify focus didn't shift (caution #3)
        await this.adapter.click(el.x, el.y);
        await this.guardWindow(expectedWindow, "after click");

        await this.adapter.typeText(value);
        break;
      }

      case "desktop_assert": {
        const expectedWindow = step.expected_window !== undefined
          ? ctx.resolve(step.expected_window) : undefined;
        const minConf = step.min_confidence ?? 0.8;

        if (expectedWindow !== undefined) {
          const title = await this.adapter.getWindowTitle();
          if (!title.includes(expectedWindow)) {
            throw new AssertionError(
              `[DesktopHandler] desktop_assert: expected window containing "${expectedWindow}", got "${title}"`,
            );
          }
        }

        // All element/text locate failures in assert are AssertionError (not transient)
        if (step.visible !== undefined) {
          const visible = ctx.resolve(step.visible);
          wwrite(`desktop_assert: visible="${visible}"`);
          try {
            await this.locator.locate(visible, minConf);
          } catch (e) {
            throw new AssertionError((e as Error).message);
          }
        }

        if (step.element !== undefined) {
          const element = ctx.resolve(step.element);
          wwrite(`desktop_assert: element="${element}"`);
          try {
            await this.locator.locate(element, minConf);
          } catch (e) {
            throw new AssertionError((e as Error).message);
          }
        }
        break;
      }

      case "desktop_key": {
        const key = ctx.resolve(step.key);
        wwrite(`desktop_key: "${key}"`);
        await this.adapter.pressKey(key);
        break;
      }

      case "desktop_close":
        wwrite("desktop_close");
        await this.adapter.close();
        break;

      default:
        throw new Error(
          `[DesktopHandler] step action "${(step as StepAction).action}" is not a desktop step`,
        );
    }
  }

  private async guardWindow(expected: string | undefined, when: string): Promise<void> {
    if (expected === undefined) {
      process.stderr.write(
        "[DesktopHandler] Warning: desktop_fill without expected_window — " +
        "typing into the wrong window is unrecoverable\n",
      );
      return;
    }
    const title = await this.adapter.getWindowTitle();
    if (!title.includes(expected)) {
      throw new AssertionError(
        `[DesktopHandler] Window guard failed ${when}: expected window containing "${expected}", got "${title}"`,
      );
    }
  }
}
