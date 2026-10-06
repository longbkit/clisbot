import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFeishuTypingForTest, FEISHU_TYPING_EMOJI, feishuTyping } from "./typing.js";

function fakeReactions() {
  let next = 0;
  return {
    add: vi.fn(async (_messageId: string, _emoji: string) => `r${String(++next)}`),
    remove: vi.fn(async (_messageId: string, _reactionId: string) => undefined),
  };
}

function drive(
  reactions: ReturnType<typeof fakeReactions>,
  action: "start" | "stop",
  extra: { indicator?: boolean; reactionEmoji?: string; messageId?: string } = {},
) {
  return feishuTyping({
    cfg: {},
    accountId: "main",
    action,
    indicator: extra.indicator ?? true,
    messageId: "messageId" in extra ? extra.messageId : "om_1",
    ...(extra.reactionEmoji === undefined ? {} : { reactionEmoji: extra.reactionEmoji }),
    reactions,
  });
}

describe("feishuTyping", () => {
  afterEach(() => clearFeishuTypingForTest());

  it("reacts Typing on the sender's message and takes it back on stop", async () => {
    const reactions = fakeReactions();
    await drive(reactions, "start");
    expect(reactions.add).toHaveBeenCalledWith("om_1", FEISHU_TYPING_EMOJI);
    await drive(reactions, "stop");
    expect(reactions.remove).toHaveBeenCalledWith("om_1", "r1");
    await drive(reactions, "stop");
    expect(reactions.remove).toHaveBeenCalledTimes(1);
  });

  it("adds the Route's reaction beside Typing, and only it when the indicator is off", async () => {
    const both = fakeReactions();
    await drive(both, "start", { reactionEmoji: "eyes" });
    expect(both.add.mock.calls).toEqual([
      ["om_1", FEISHU_TYPING_EMOJI],
      ["om_1", "EYES"],
    ]);
    await drive(both, "stop");
    expect(both.remove).toHaveBeenCalledTimes(2);
    const only = fakeReactions();
    await drive(only, "start", { indicator: false, reactionEmoji: "eyes" });
    expect(only.add.mock.calls).toEqual([["om_1", "EYES"]]);
  });

  it("skips a Route emoji Lark does not know, keeping Typing to take back", async () => {
    const reactions = fakeReactions();
    reactions.add.mockImplementation(async (_id: string, emoji: string) => {
      if (emoji !== FEISHU_TYPING_EMOJI) throw new Error("unknown emoji");
      return "r-typing";
    });
    await drive(reactions, "start", { reactionEmoji: "nosuch" });
    await drive(reactions, "stop");
    expect(reactions.remove).toHaveBeenCalledWith("om_1", "r-typing");
  });

  it("does nothing without a message to react on", async () => {
    const reactions = fakeReactions();
    await drive(reactions, "start", { messageId: undefined });
    expect(reactions.add).not.toHaveBeenCalled();
  });
});
