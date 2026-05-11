/**
 * AssertionHandler — handles assert steps.
 *
 * Supported assert kinds:
 *   text              → checks that the text is visible somewhere on the page
 *   url               → checks that the current URL contains the substring
 *   element_not_visible → checks that an element is absent or hidden (e.g. login form gone after auth)
 */
import { StepHandler } from "../execution/HandlerRegistry";
import { StepAction } from "../dsl/types";
import { ExecutionContext } from "../execution/ExecutionContext";
import { AdapterActions } from "../adapter/AdapterActions";
import { wwrite } from "../execution/WorkerContext";
import { AssertionError } from "../errors";

export class AssertionHandler implements StepHandler {
  readonly handles = ["assert"];

  async execute(
    step: StepAction,
    adapter: AdapterActions,
    ctx: ExecutionContext
  ): Promise<void> {
    if (step.action !== "assert") return;

    const value = ctx.resolve(step.value);

    switch (step.kind) {
      case "text": {
        wwrite(`  ▶ assert    → text visible: "${value}"`);
        await adapter.assertTextVisible(value);
        break;
      }

      case "url": {
        wwrite(`  ▶ assert    → url contains: "${value}"`);
        await adapter.assertUrlContains(value);
        break;
      }

      case "visible": {
        wwrite(`  ▶ assert    → element visible: "${value}"`);
        await adapter.assertElementVisible(value);
        break;
      }

      case "element_not_visible": {
        wwrite(`  ▶ assert    → element not visible: "${value}"`);
        await adapter.assertElementNotVisible(value);
        break;
      }

      case "equals": {
        if (!step.equals) throw new Error(`AssertionHandler: assert kind "equals" is missing the "equals" field`);
        const expected = ctx.resolve(step.equals);
        wwrite(`  ▶ assert    → "${value}" equals "${expected}"`);
        if (value !== expected) {
          throw new AssertionError(`assertEquals: expected "${expected}", got "${value}"`);
        }
        break;
      }

      default: {
        throw new Error(`AssertionHandler: unknown assert kind: "${(step as { kind: string }).kind}"`);
      }
    }
  }
}
