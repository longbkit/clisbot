import { describe, expect, test } from "vitest";
import type { AgentPermissionRequest } from "./agent-sdk-types.js";
import { classifyOmpRpcUiPermissionRequest } from "./providers/omp/rpc-ui-permission-mapper.js";
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
  test("never answers a Connector send card, which only a person may answer", () => {
    const send = request({
      name: "Connector send",
      metadata: { clisbotConnector: { kind: "send", app: "gmail" } },
    });
    expect(isAutoAcceptablePermission(send)).toBe(false);
  });

  test("never answers a Connector connect card", () => {
    const connect = request({
      name: "Connect Gmail",
      metadata: {
        clisbotConnector: { kind: "connect", app: "gmail" },
        clisbotDaemonPermission: true,
      },
    });
    expect(isAutoAcceptablePermission(connect)).toBe(false);
  });

  test("never answers any card the daemon raised itself", () => {
    expect(
      isAutoAcceptablePermission(request({ metadata: { clisbotDaemonPermission: true } })),
    ).toBe(false);
  });

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

describe("Full auto-accept against each provider's request shapes", () => {
  const omp = classifyOmpRpcUiPermissionRequest({
    type: "extension_ui_request",
    id: "bash",
    method: "select",
    title: "Allow tool: bash\nCommand: echo hi",
    options: ["Approve", "Deny"],
  });
  if (omp.kind !== "tool") throw new Error("OMP tool approval expected");

  // Shapes copied from each provider's mapper (file named per row).
  test.each<[string, AgentPermissionRequest, boolean]>([
    // claude/agent.ts resolvePermissionKind
    ["Claude Bash", request({ name: "Bash", input: { command: "ls" } }), true],
    ["Claude AskUserQuestion", request({ name: "AskUserQuestion", kind: "question" }), false],
    ["Claude ExitPlanMode", request({ name: "ExitPlanMode", kind: "plan" }), false],
    // codex-app-server-agent.ts command and file-change approvals, request_user_input
    ["Codex command", request({ provider: "codex", name: "CodexBash" }), true],
    [
      "Codex question",
      request({ provider: "codex", name: "request_user_input", kind: "question" }),
      false,
    ],
    // acp-agent.ts mapPermissionRequest (Copilot, generic ACP, Cursor, Kimi)
    [
      "ACP allow options",
      request({
        provider: "copilot",
        name: "execute",
        actions: [
          { id: "allow", label: "Allow once", behavior: "allow" },
          { id: "always", label: "Always allow", behavior: "allow" },
          { id: "reject", label: "Reject", behavior: "deny" },
        ],
      }),
      true,
    ],
    [
      "ACP chooser",
      request({
        provider: "kimi",
        name: "AskUserQuestion",
        metadata: { [PERMISSION_CHOICE_METADATA]: true },
        actions: [
          { id: "a", label: "A", behavior: "allow" },
          { id: "b", label: "B", behavior: "allow" },
        ],
      }),
      false,
    ],
    ["ACP mode switch", request({ provider: "copilot", name: "switch_mode", kind: "mode" }), false],
    // opencode-agent.ts buildOpenCodePermissionActions and question events
    [
      "OpenCode tool",
      request({
        provider: "opencode",
        name: "bash",
        actions: [
          { id: "deny", label: "Deny", behavior: "deny" },
          { id: "always", label: "Allow always", behavior: "allow" },
          { id: "once", label: "Allow once", behavior: "allow" },
        ],
      }),
      true,
    ],
    [
      "OpenCode question",
      request({ provider: "opencode", name: "question", kind: "question" }),
      false,
    ],
    // omp/rpc-ui-permission-mapper.ts, the real mapper
    ["OMP bash", omp.request, true],
  ])("%s", (_name, shape, approved) => {
    expect(isAutoAcceptablePermission(shape)).toBe(approved);
  });
});
