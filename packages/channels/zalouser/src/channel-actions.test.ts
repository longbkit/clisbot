// The `message` tool surface (D-ZU-019): what the vertical advertises, what it
// refuses, and that the drive-time account carrier reaches upstream's
// `handleAction` through `fusion/account-config.ts` alone.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./channel.runtime.js", () => ({
  sendReactionZalouser: vi.fn(),
  sendMessageZalouser: vi.fn(),
  probeZalouser: vi.fn(),
  listZaloFriendsMatching: vi.fn(),
  listZaloGroupMembers: vi.fn(),
  listZaloGroupsMatching: vi.fn(),
  logoutZaloProfile: vi.fn(),
  startZaloQrLogin: vi.fn(),
  waitForZaloQrLogin: vi.fn(),
  getZaloUserInfo: vi.fn(),
}));

import { sendReactionZalouser } from "./channel.runtime.js";
import { ZALOUSER_MESSAGE_ACTIONS, zalouserChannelActions } from "./channel-actions.js";
import type { OpenClawConfig } from "./runtime-api.js";

const reactionMock = vi.mocked(sendReactionZalouser);

/** `sendReactionZalouser` returns a `ZaloSendResult`; only `ok` is read here. */
function okReaction(overrides: { ok?: boolean; error?: string } = {}) {
  return {
    ok: true,
    receipt: { platformMessageIds: [], parts: [], kind: "unknown" },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof sendReactionZalouser>>;
}

function cfg(overrides: Record<string, unknown> = {}): OpenClawConfig {
  return {
    channels: { zalouser: { enabled: true, accounts: { default: overrides } } },
  } as unknown as OpenClawConfig;
}

beforeEach(() => {
  reactionMock.mockReset();
  reactionMock.mockResolvedValue(okReaction());
});

describe("zalouserChannelActions", () => {
  it("advertises exactly the actions the platform supports", () => {
    expect([...ZALOUSER_MESSAGE_ACTIONS]).toEqual(["react"]);
    expect(
      zalouserChannelActions.describeMessageTool?.({ cfg: cfg(), accountId: "default" }),
    ).toEqual({ actions: ["react"] });
    expect(zalouserChannelActions.supportsAction?.({ action: "react" })).toBe(true);
    for (const action of ["send", "edit", "delete", "pin", "poll"] as const) {
      expect(zalouserChannelActions.supportsAction?.({ action })).toBe(false);
    }
  });

  it("refuses an unsupported action with a structured error, not a transport call", async () => {
    await expect(
      zalouserChannelActions.handleAction?.({
        action: "edit",
        channel: "zalouser",
        params: {},
        cfg: cfg(),
        accountId: "default",
      } as never),
    ).rejects.toThrow(/not supported for provider zalouser/);
    expect(reactionMock).not.toHaveBeenCalled();
  });

  it("reacts on the resolved thread with the msgId + cliMsgId pair", async () => {
    const result = await zalouserChannelActions.handleAction?.({
      action: "react",
      channel: "zalouser",
      params: { threadId: "group:g1", emoji: "❤️", messageId: "m1", cliMsgId: "c1" },
      cfg: cfg(),
      accountId: "default",
    } as never);

    expect(reactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "g1",
        isGroup: true,
        msgId: "m1",
        cliMsgId: "c1",
        emoji: "❤️",
      }),
    );
    expect(result).toMatchObject({ details: { messageId: "m1", cliMsgId: "c1", threadId: "g1" } });
  });

  it("splits the ambient `msgId:cliMsgId` message sid when the tool supplies neither", async () => {
    await zalouserChannelActions.handleAction?.({
      action: "react",
      channel: "zalouser",
      params: { emoji: "like" },
      cfg: cfg(),
      accountId: "default",
      toolContext: { currentChannelId: "user:42", currentMessageId: "m9:c9" },
    } as never);

    expect(reactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "42", msgId: "m9", cliMsgId: "c9" }),
    );
  });

  it("takes the credential profile from the drive-time account carrier", async () => {
    await zalouserChannelActions.handleAction?.({
      action: "react",
      channel: "zalouser",
      params: { threadId: "user:7", emoji: "like", messageId: "m", cliMsgId: "c" },
      cfg: cfg(),
      accountId: "default",
      account: { profile: "from-connection" },
    } as never);

    expect(reactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "from-connection" }),
    );
  });

  it("propagates a failed reaction as an error", async () => {
    reactionMock.mockResolvedValueOnce(okReaction({ ok: false, error: "no session" }));
    await expect(
      zalouserChannelActions.handleAction?.({
        action: "react",
        channel: "zalouser",
        params: { threadId: "user:7", emoji: "like", messageId: "m", cliMsgId: "c" },
        cfg: cfg(),
        accountId: "default",
      } as never),
    ).rejects.toThrow(/no session/);
  });
});
