import { describe, expect, it } from "vitest";
import { renderError, toCommandError } from "./render.js";

describe("structured command errors", () => {
  it("keeps the message of Error subclasses in JSON output", () => {
    const failure = Object.assign(new Error("The owner must finish Account setup"), {
      code: "HUB_REQUEST_FAILED",
    });
    const result = JSON.parse(renderError(toCommandError(failure), { format: "json" }));
    expect(result.error).toEqual({ code: "HUB_REQUEST_FAILED", message: failure.message });
  });
});
