import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  configurationValidationErrors,
  configurationValidationIssues,
  configurationValidationMessages,
} from "./validation-errors.js";

describe("configuration validation errors", () => {
  it("preserves form and field failures as actionable messages", () => {
    const parsed = z
      .object({ environments: z.array(z.string()), triggers: z.array(z.string()) })
      .safeParse({ environments: "invalid", triggers: [] });

    assert.equal(parsed.success, false);
    if (parsed.success) return;
    const errors = configurationValidationErrors(parsed.error);

    assert.deepEqual(configurationValidationMessages(errors), [
      "Environments: Invalid input: expected array, received string",
    ]);
    assert.deepEqual(configurationValidationIssues(errors), [
      {
        path: ["environments"],
        message: "Invalid input: expected array, received string",
      },
    ]);
  });

  it("presents resource failures and safely handles an unknown stored shape", () => {
    assert.deepEqual(
      configurationValidationMessages({
        formErrors: ["unresolved organization resources: missing-runner"],
      }),
      ["Unresolved organization resources: missing-runner"],
    );
    assert.deepEqual(configurationValidationMessages({ unexpected: true }), [
      "Configuration validation failed.",
    ]);
  });
});
