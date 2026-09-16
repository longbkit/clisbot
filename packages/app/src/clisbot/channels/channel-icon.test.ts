import { describe, expect, it } from "vitest";
import { channelConversationLabel } from "./channel-icon";

describe("channelConversationLabel", () => {
  it("names Slack channels with #, Telegram groups by title, and falls back to the id", () => {
    expect(
      channelConversationLabel({ channel: "slack", channelId: "C1", displayName: "eng" }),
    ).toBe("#eng");
    expect(
      channelConversationLabel({ channel: "slack", channelId: "C1", displayName: "#eng" }),
    ).toBe("#eng");
    expect(
      channelConversationLabel({ channel: "telegram", channelId: "-100", displayName: "Team" }),
    ).toBe("Team");
    expect(channelConversationLabel({ channel: "slack", channelId: "C1", displayName: " " })).toBe(
      "C1",
    );
    expect(channelConversationLabel({ channelId: "C1" })).toBe("C1");
  });
});
