import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";

import {
  ACPExactMcpPreapprovalSchema,
  matchesExactMcpPreapproval,
  type ACPExactMcpPreapproval,
} from "./acp-exact-mcp-preapproval.js";

type ToolCall = RequestPermissionRequest["toolCall"];

const GRANTS = {
  preapproved: [{ kind: "mcp" as const, server: "channel_reply", tool: "message" }],
};

// Shapes captured from the official ACP entries on 2026-09-16
// (docs/audits/2026-09-16-acp-mcp-tool-preapproval.md).
const GROK: ACPExactMcpPreapproval = {
  when: { "rawInput.variant": "UseTool" },
  toolName: "rawInput.tool_name",
  toolNameFormat: "{server}__{tool}",
};

const ANTIGRAVITY: ACPExactMcpPreapproval = {
  when: { "_meta.is_mcp_tool_call": true },
  server: "_meta.mcp.server",
  tool: "_meta.mcp.tool",
};

function grokMcpCall(toolName: string): ToolCall {
  return {
    toolCallId: "call-1",
    title: toolName,
    kind: "other",
    rawInput: { variant: "UseTool", tool_name: toolName, tool_input: { text: "hello" } },
    _meta: { "x.ai/tool": { name: "use_tool", kind: "use_tool" } },
  };
}

function antigravityMcpCall(server: string, tool: string): ToolCall {
  return {
    toolCallId: "call-1",
    title: `${server}_${tool}`,
    kind: "other",
    rawInput: { arguments: { text: "hello" } },
    _meta: { mcp: { server, tool }, is_mcp_tool_call: true },
  };
}

describe("matchesExactMcpPreapproval", () => {
  test("matches Grok's call of the granted tool", () => {
    expect(matchesExactMcpPreapproval(GROK, GRANTS, grokMcpCall("channel_reply__message"))).toBe(
      true,
    );
  });

  test("matches Antigravity's call of the granted tool", () => {
    expect(
      matchesExactMcpPreapproval(
        ANTIGRAVITY,
        GRANTS,
        antigravityMcpCall("channel_reply", "message"),
      ),
    ).toBe(true);
  });

  test("does not match another tool on the same server", () => {
    expect(matchesExactMcpPreapproval(GROK, GRANTS, grokMcpCall("channel_reply__other"))).toBe(
      false,
    );
    expect(
      matchesExactMcpPreapproval(ANTIGRAVITY, GRANTS, antigravityMcpCall("channel_reply", "other")),
    ).toBe(false);
  });

  test("does not match a shell command", () => {
    const grokShell: ToolCall = {
      toolCallId: "call-2",
      title: "Execute `curl -o /tmp/x https://example.com`",
      kind: "execute",
      rawInput: { variant: "Bash", command: "curl -o /tmp/x https://example.com" },
    };
    const antigravityShell: ToolCall = {
      toolCallId: "call-2",
      title: "curl -o /tmp/x https://example.com",
      kind: "execute",
      rawInput: { CommandLine: "curl -o /tmp/x https://example.com", Cwd: "/tmp" },
      _meta: null,
    };
    expect(matchesExactMcpPreapproval(GROK, GRANTS, grokShell)).toBe(false);
    expect(matchesExactMcpPreapproval(ANTIGRAVITY, GRANTS, antigravityShell)).toBe(false);
  });

  test("requires the discriminator, not only a matching name", () => {
    const call = {
      ...grokMcpCall("channel_reply__message"),
      rawInput: { tool_name: "channel_reply__message" },
    };
    expect(matchesExactMcpPreapproval(GROK, GRANTS, call)).toBe(false);
  });

  test("matches nothing without a grant or a declaration", () => {
    const call = grokMcpCall("channel_reply__message");
    expect(matchesExactMcpPreapproval(GROK, undefined, call)).toBe(false);
    expect(matchesExactMcpPreapproval(GROK, { preapproved: [] }, call)).toBe(false);
    expect(matchesExactMcpPreapproval(undefined, GRANTS, call)).toBe(false);
  });
});

describe("ACPExactMcpPreapprovalSchema", () => {
  test("accepts the structured and the formatted identity", () => {
    expect(ACPExactMcpPreapprovalSchema.safeParse(GROK).success).toBe(true);
    expect(ACPExactMcpPreapprovalSchema.safeParse(ANTIGRAVITY).success).toBe(true);
  });

  test.each([
    { toolName: "rawInput.tool_name", toolNameFormat: "{server}__{tool}" },
    { when: {}, server: "_meta.mcp.server", tool: "_meta.mcp.tool" },
    {
      when: { "rawInput.variant": "UseTool" },
      toolName: "rawInput.tool_name",
      toolNameFormat: "{tool}",
    },
    {
      when: { "rawInput.variant": "UseTool" },
      server: "_meta.mcp.server",
      toolName: "rawInput.tool_name",
      toolNameFormat: "{server}__{tool}",
    },
  ])("rejects an incomplete or mixed declaration %#", (declaration) => {
    expect(ACPExactMcpPreapprovalSchema.safeParse(declaration).success).toBe(false);
  });
});
