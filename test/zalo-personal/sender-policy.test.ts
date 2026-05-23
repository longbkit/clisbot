import { describe, expect, test } from "bun:test";
import { resolveZaloPersonalGroupSenderPolicy } from "../../src/channels/zalo-personal/sender-policy.ts";
import type { SurfaceRoute } from "../../src/channels/config/route-policy.ts";
import type { ResolvedChannelAuth } from "../../src/auth/resolve.ts";

function buildRoute(overrides: Partial<SurfaceRoute> = {}): SurfaceRoute {
  return {
    agentId: "default",
    policy: "allowlist",
    requireMention: true,
    allowBots: false,
    allowUsers: ["user-1"],
    blockUsers: [],
    commandPrefixes: {
      slash: ["/"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    surfaceNotifications: {
      queueStart: "brief",
      loopStart: "brief",
    },
    verbose: "minimal",
    followUp: {
      mode: "mention-only",
      participationTtlMs: 300_000,
    },
    ...overrides,
  };
}

function buildAuth(overrides: Partial<ResolvedChannelAuth> = {}): ResolvedChannelAuth {
  return {
    appRole: "user",
    agentRole: "user",
    mayBypassPairing: false,
    mayBypassSharedSenderPolicy: false,
    mayManageProtectedResources: false,
    canUseShell: false,
    ...overrides,
  };
}

describe("zalo-personal group sender policy", () => {
  test("allows configured group allowlist users", () => {
    const result = resolveZaloPersonalGroupSenderPolicy({
      conversationKind: "group",
      senderId: "user-1",
      rawText: "@bot hi",
      mentionedSelf: true,
      route: buildRoute(),
      auth: buildAuth(),
    });

    expect(result).toEqual({ allowed: true, shouldSendDeny: false });
  });

  test("denies addressed group allowlist misses", () => {
    const result = resolveZaloPersonalGroupSenderPolicy({
      conversationKind: "group",
      senderId: "user-2",
      rawText: "@bot hi",
      mentionedSelf: true,
      route: buildRoute(),
      auth: buildAuth(),
    });

    expect(result).toEqual({ allowed: false, shouldSendDeny: true });
  });

  test("drops unaddressed group allowlist misses without deny noise", () => {
    const result = resolveZaloPersonalGroupSenderPolicy({
      conversationKind: "group",
      senderId: "user-2",
      rawText: "hi",
      mentionedSelf: false,
      route: buildRoute(),
      auth: buildAuth(),
    });

    expect(result).toEqual({ allowed: false, shouldSendDeny: false });
  });

  test("lets admins bypass shared sender policy", () => {
    const result = resolveZaloPersonalGroupSenderPolicy({
      conversationKind: "group",
      senderId: "user-2",
      rawText: "hi",
      mentionedSelf: false,
      route: buildRoute(),
      auth: buildAuth({ mayBypassSharedSenderPolicy: true }),
    });

    expect(result.allowed).toBe(true);
  });
});
