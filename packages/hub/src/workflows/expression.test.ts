import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  parseExpression,
  renderExecutionTemplate,
  renderExpressionTemplate,
} from "./expression.js";

describe("workflow expression context", () => {
  it("keeps the triggering prompt and ambient context as distinct merge values", () => {
    const context = {
      prompt: "the triggering body",
      context: { slack: { thread: { messages: [{ content: "earlier" }] } } },
      inputs: {},
      steps: {},
      values: {},
    };

    assert.equal(renderExpressionTemplate("${{ clisbot.prompt }}", context), "the triggering body");
    assert.equal(
      renderExpressionTemplate("${{ clisbot.context }}", context),
      JSON.stringify(context.context),
    );
    assert.deepEqual(parseExpression("${{ clisbot.context }}"), {
      kind: "path",
      value: { namespace: "clisbot", path: "context" },
    });
  });

  it("renders the stable execution ID without provider context", () => {
    assert.equal(
      renderExecutionTemplate(
        "trigger-${{ clisbot.execution.id }}",
        "64ae56ff-281c-4c5f-bf5c-d572f125c702",
      ),
      "trigger-64ae56ff-281c-4c5f-bf5c-d572f125c702",
    );
  });
});
