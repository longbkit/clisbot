import { describe, expect, test } from "vitest";
import type { AgentPermissionRequest } from "./agent-sdk-types.js";
import {
  isAutoAcceptablePermission,
  PERMISSION_CHOICE_METADATA,
  resolveFullAutoAcceptProviderMode,
  shouldDaemonAutoAccept,
} from "./full-auto-accept.js";

function request(overrides: Partial<AgentPermissionRequest>): AgentPermissionRequest {
  return { id: "req-1", provider: "claude", name: "Bash", kind: "tool", ...overrides };
}

describe("Full auto-accept provider mode", () => {
  test("runs on the provider's no-prompt mode", () => {
    const modes = [
      { id: "default", label: "Always Ask" },
      { id: "bypassPermissions", label: "Bypass", isUnattended: true },
    ];
    expect(resolveFullAutoAcceptProviderMode(modes, "default")).toBe("bypassPermissions");
  });

  test("keeps the current mode when the provider has no no-prompt mode", () => {
    const modes = [
      { id: "build", label: "Build" },
      { id: "plan", label: "Plan" },
    ];
    expect(resolveFullAutoAcceptProviderMode(modes, "build")).toBe("build");
    expect(resolveFullAutoAcceptProviderMode([], null)).toBeNull();
  });
});

describe("which requests Full auto-accept approves", () => {
  test("approves a Claude tool request", () => {
    expect(isAutoAcceptablePermission(request({ input: { command: "ls" } }))).toBe(true);
  });

  test("approves a Codex command approval", () => {
    const codex = request({
      provider: "codex",
      name: "CodexBash",
      title: "Run command",
      metadata: { method: "item/commandExecution/requestApproval" },
    });
    expect(isAutoAcceptablePermission(codex)).toBe(true);
  });

  test("approves an OpenCode request whose actions offer an allow", () => {
    const openCode = request({
      provider: "opencode",
      actions: [
        { id: "deny", label: "Deny", behavior: "deny" },
        { id: "once", label: "Allow once", behavior: "allow" },
      ],
    });
    expect(isAutoAcceptablePermission(openCode)).toBe(true);
  });

  test("never answers a question, a plan or a mode switch", () => {
    for (const kind of ["question", "plan", "mode", "other"] as const) {
      expect(isAutoAcceptablePermission(request({ kind }))).toBe(false);
    }
  });

  test("never picks an answer from a choice", () => {
    const chooser = request({
      provider: "copilot",
      metadata: { [PERMISSION_CHOICE_METADATA]: true },
      actions: [
        { id: "a", label: "Option A", behavior: "allow" },
        { id: "b", label: "Option B", behavior: "allow" },
      ],
    });
    expect(isAutoAcceptablePermission(chooser)).toBe(false);
  });

  test("never approves a request that offers no allow", () => {
    const denyOnly = request({ actions: [{ id: "deny", label: "Deny", behavior: "deny" }] });
    expect(isAutoAcceptablePermission(denyOnly)).toBe(false);
  });

  test("leaves the answer to a provider whose own auto-accept is on", () => {
    const tool = request({});
    const base = { provider: "copilot", cwd: "/tmp" };
    expect(shouldDaemonAutoAccept({ ...base, fullAutoAccept: true }, tool)).toBe(true);
    expect(
      shouldDaemonAutoAccept(
        { ...base, fullAutoAccept: true, featureValues: { auto_accept: true } },
        tool,
      ),
    ).toBe(false);
    expect(shouldDaemonAutoAccept(base, tool)).toBe(false);
  });
});
