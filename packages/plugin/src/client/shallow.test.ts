import { describe, expect, it } from "vitest";
import { shallowEqual } from "./shallow.js";

describe("plugin selector shallow equality", () => {
  it("keeps equivalent selector objects and arrays stable", () => {
    const shared = { id: "shared" };
    expect(shallowEqual({ name: "Clisbot", shared }, { name: "Clisbot", shared })).toBe(true);
    expect(shallowEqual(["Clisbot", shared], ["Clisbot", shared])).toBe(true);
    expect(shallowEqual({ name: "Clisbot" }, { name: "Changed" })).toBe(false);
  });

  it("compares map and set selections by their shallow entries", () => {
    expect(shallowEqual(new Map([["status", "running"]]), new Map([["status", "running"]]))).toBe(
      true,
    );
    expect(shallowEqual(new Set(["workspace", "agent"]), new Set(["workspace", "agent"]))).toBe(
      true,
    );
    expect(shallowEqual(new Set(["workspace"]), new Set(["agent"]))).toBe(false);
  });
});
