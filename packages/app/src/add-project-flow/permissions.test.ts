import { describe, expect, it } from "vitest";
import { canManageHostProjects } from "./permissions";

describe("Add project permission preflight", () => {
  it("rejects project and workspace creation authority without daemon project management", () => {
    expect(canManageHostProjects([])).toBe(false);
    expect(canManageHostProjects(["workspace.read", "workspace.write", "workspace.create"])).toBe(
      false,
    );
  });
  it("accepts management authority and preserves legacy daemons", () => {
    expect(canManageHostProjects(["workspace.manage"])).toBe(true);
    expect(canManageHostProjects(undefined)).toBe(true);
  });
});
