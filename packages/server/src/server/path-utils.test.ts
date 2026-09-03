import { describe, expect, it } from "vitest";

import { isSameOrDescendantPath } from "./path-utils.js";

describe("isSameOrDescendantPath", () => {
  it("normalizes traversal segments before checking containment", () => {
    expect(isSameOrDescendantPath("/workspace/project", "/workspace/project/../foreign")).toBe(
      false,
    );
    expect(
      isSameOrDescendantPath("C:\\workspace\\project", "C:\\workspace\\project\\..\\foreign"),
    ).toBe(false);
  });

  it("does not confuse a sibling prefix with a descendant", () => {
    expect(isSameOrDescendantPath("/workspace/project", "/workspace/project-copy")).toBe(false);
  });

  it("supports mixed Windows separators and drive-letter case", () => {
    expect(isSameOrDescendantPath("C:\\Users\\Paseo\\Repo", "c:/users/paseo/repo/src")).toBe(true);
  });
});
