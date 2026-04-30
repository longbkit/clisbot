import { describe, expect, test } from "bun:test";
import {
  appendThreadSessionKey,
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
  buildTmuxSessionName,
} from "../src/agents/session-key.ts";

describe("session key routing", () => {
  test("builds the main session key like OpenClaw", () => {
    expect(
      buildAgentMainSessionKey({
        agentId: "default",
        mainKey: "main",
      }),
    ).toBe("agent:default:main");
  });

  test("supports OpenClaw-style DM scopes", () => {
    expect(
      buildAgentPeerSessionKey({
        agentId: "default",
        mainKey: "main",
        channel: "slack",
        peerKind: "dm",
        peerId: "U123",
        dmScope: "main",
      }),
    ).toBe("agent:default:main");

    expect(
      buildAgentPeerSessionKey({
        agentId: "default",
        channel: "slack",
        peerKind: "dm",
        peerId: "U123",
        dmScope: "per-peer",
      }),
    ).toBe("agent:default:dm:u123");

    expect(
      buildAgentPeerSessionKey({
        agentId: "default",
        channel: "slack",
        peerKind: "dm",
        peerId: "U123",
        dmScope: "per-channel-peer",
      }),
    ).toBe("agent:default:slack:dm:u123");

    expect(
      buildAgentPeerSessionKey({
        agentId: "default",
        channel: "slack",
        accountId: "work",
        peerKind: "dm",
        peerId: "U123",
        dmScope: "per-account-channel-peer",
      }),
    ).toBe("agent:default:slack:work:dm:u123");
  });

  test("supports channel and thread session keys", () => {
    const baseSessionKey = buildAgentPeerSessionKey({
      agentId: "default",
      channel: "slack",
      peerKind: "channel",
      peerId: "C123",
    });

    expect(baseSessionKey).toBe("agent:default:slack:channel:c123");
    expect(appendThreadSessionKey(baseSessionKey, "1775291908.430139")).toBe(
      "agent:default:slack:channel:c123:thread:1775291908.430139",
    );
  });

  test("normalizes session keys into tmux-safe session names by default", () => {
    const sessionKey = "agent:default:slack:channel:c123:thread:1775291908.430139";
    const sessionName = buildTmuxSessionName({
      template: "{sessionKey}",
      agentId: "default",
      workspacePath: "/tmp/workspace/default",
      sessionKey,
      mainKey: "main",
    });

    expect(sessionName).toMatch(
      /^agent-default-slack-channel-c123-thread-1775291908-430139-[0-9a-f]{8}$/,
    );
    expect(sessionName).not.toContain(":");
    expect(sessionName).not.toContain(".");
  });

  test("keeps tmux session names unique when different session keys normalize to the same base name", () => {
    const first = buildTmuxSessionName({
      template: "{sessionKey}",
      agentId: "default",
      workspacePath: "/tmp/workspace/default",
      sessionKey: "agent:default:telegram:group:qa/a",
      mainKey: "main",
    });
    const second = buildTmuxSessionName({
      template: "{sessionKey}",
      agentId: "default",
      workspacePath: "/tmp/workspace/default",
      sessionKey: "agent:default:telegram:group:qa-a",
      mainKey: "main",
    });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^agent-default-telegram-group-qa-a-[0-9a-f]{8}$/);
    expect(second).toMatch(/^agent-default-telegram-group-qa-a-[0-9a-f]{8}$/);
  });
});
