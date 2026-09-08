// Fusion test: the channel-owned action surface the Hub `message` tool drives
// (`plugin.actions`). Discovery is asserted against the real adapter; execution
// goes through `handleAction` down to the ported action runtime, with the
// Discord SDK primitives stubbed at upstream's own runtime object so every layer
// above them — schema gating, target resolution, param coercion — is real.
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { discordMessagingActionRuntime } from "./actions/runtime.messaging.runtime.js";
import { discordMessageActions } from "./channel-actions.js";

const CHANNEL_ID = "400000000000000004";
const MESSAGE_ID = "700000000000000007";

// Open policy + group DMs on: the read-target guard needs every plausible scope
// enabled before it lets an operator-driven read through without a guild entry.
const cfg = {
  channels: {
    discord: {
      accounts: {
        main: { token: "test-token", groupPolicy: "open", dm: { groupEnabled: true } },
      },
    },
  },
} as unknown as OpenClawConfig;

function actionContext(action: string, params: Record<string, unknown>) {
  return {
    action,
    params,
    cfg,
    accountId: "main",
    requesterSenderId: "200000000000000002",
    senderIsOwner: true,
    // The read-target policy admits an operator-driven read without a configured
    // guild allowlist; these cases assert dispatch, not the allowlist itself.
    conversationReadOrigin: "direct-operator",
  } as never;
}

describe("discordMessageActions discovery", () => {
  it("advertises the native action set and the presentation capability", () => {
    const discovery = discordMessageActions.describeMessageTool?.({
      cfg,
      accountId: "main",
    } as never);
    expect(discovery?.actions).toEqual(expect.arrayContaining(["react", "edit", "delete", "pin"]));
    expect(discovery?.capabilities).toContain("presentation");
  });

  it("refuses the poll action Discord's message tool does not own", () => {
    expect(discordMessageActions.supportsAction?.({ action: "poll" } as never)).toBe(false);
    expect(discordMessageActions.supportsAction?.({ action: "react" } as never)).toBe(true);
  });

  it("maps the thread-reply target alias onto a Discord channel id", () => {
    const alias = discordMessageActions.messageActionTargetAliases?.["thread-reply"];
    expect(alias?.aliases).toContain("threadId");
    expect(alias?.resolveDeliveryTarget?.({ args: { threadId: "600000000000000006" } } as never)).toBe(
      "channel:600000000000000006",
    );
  });

  it("extracts the send target for the sendMessage action", () => {
    expect(
      discordMessageActions.extractToolSend?.({
        args: { action: "threadReply", channelId: "600000000000000006" },
      } as never),
    ).toEqual({ to: "channel:600000000000000006" });
  });
});

describe("discordMessageActions.handleAction", () => {
  it("dispatches `react` onto the ported reaction primitive", async () => {
    const react = vi
      .spyOn(discordMessagingActionRuntime, "reactMessageDiscord")
      .mockResolvedValue({ ok: true } as never);
    try {
      const result = await discordMessageActions.handleAction?.(
        actionContext("react", { channelId: CHANNEL_ID, messageId: MESSAGE_ID, emoji: "👍" }),
      );
      expect(react).toHaveBeenCalledTimes(1);
      expect(react.mock.calls[0]?.[0]).toBe(CHANNEL_ID);
      expect(react.mock.calls[0]?.[1]).toBe(MESSAGE_ID);
      expect(result).toBeDefined();
    } finally {
      react.mockRestore();
    }
  });

  it("dispatches `edit` onto the ported edit primitive with the new content", async () => {
    const edit = vi
      .spyOn(discordMessagingActionRuntime, "editMessageDiscord")
      .mockResolvedValue({ id: MESSAGE_ID, channel_id: CHANNEL_ID } as never);
    try {
      await discordMessageActions.handleAction?.(
        actionContext("edit", {
          channelId: CHANNEL_ID,
          messageId: MESSAGE_ID,
          message: "edited body",
        }),
      );
      expect(edit).toHaveBeenCalledTimes(1);
      expect(edit.mock.calls[0]?.[2]).toMatchObject({ content: "edited body" });
    } finally {
      edit.mockRestore();
    }
  });

  it("dispatches `delete` onto the ported delete primitive", async () => {
    const remove = vi
      .spyOn(discordMessagingActionRuntime, "deleteMessageDiscord")
      .mockResolvedValue({ ok: true } as never);
    try {
      await discordMessageActions.handleAction?.(
        actionContext("delete", { channelId: CHANNEL_ID, messageId: MESSAGE_ID }),
      );
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0]?.[1]).toBe(MESSAGE_ID);
    } finally {
      remove.mockRestore();
    }
  });

  it("dispatches `pin` onto the ported pin primitive", async () => {
    const pin = vi
      .spyOn(discordMessagingActionRuntime, "pinMessageDiscord")
      .mockResolvedValue({ ok: true } as never);
    try {
      await discordMessageActions.handleAction?.(
        actionContext("pin", { channelId: CHANNEL_ID, messageId: MESSAGE_ID }),
      );
      expect(pin).toHaveBeenCalledTimes(1);
    } finally {
      pin.mockRestore();
    }
  });

  it("refuses `react` without a message id instead of guessing one", async () => {
    await expect(
      discordMessageActions.handleAction?.(
        actionContext("react", { channelId: CHANNEL_ID, emoji: "👍" }),
      ),
    ).rejects.toThrow(/messageId required/u);
  });

  it("fails loudly for the omitted voice-message send (D-DC-004)", async () => {
    await expect(
      discordMessageActions.handleAction?.(
        actionContext("send", {
          target: `channel:${CHANNEL_ID}`,
          message: "",
          asVoice: true,
          media: "https://example.invalid/clip.ogg",
        }),
      ),
    ).rejects.toThrow(/voice messages are not supported/iu);
  });
});
