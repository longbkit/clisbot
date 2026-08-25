import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { durableExecutionId } from "./lifecycle.js";

describe("durable execution identity", () => {
  it("is stable per trigger configuration match and distinct across fan-out", () => {
    const first = {
      triggerRunId: "trigger-run-1",
      configurationRevisionId: "config-1",
      triggerName: "first",
    };

    assert.equal(durableExecutionId(first), durableExecutionId(first));
    assert.notEqual(
      durableExecutionId(first),
      durableExecutionId({ ...first, triggerName: "second" }),
    );
    assert.notEqual(
      durableExecutionId(first),
      durableExecutionId({ ...first, configurationRevisionId: "config-2" }),
    );
    assert.match(
      durableExecutionId(first),
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
