import { describe, expect, it } from "vitest";
import type { HubObservedChannelConversation } from "../contracts";
import { observedConversationOptions, parseChannelAccountResourceId } from "../conversation-picker";

const observations: HubObservedChannelConversation[] = [
  {
    id: "C-SUPPORT",
    kind: "channel",
    rootConversationId: "C-SUPPORT",
    threadId: null,
    label: "#support",
    visibility: "unknown",
    observedAt: "2026-09-02T10:00:00.000Z",
  },
  {
    id: "1700000000.000200",
    kind: "thread",
    rootConversationId: "C-SUPPORT",
    threadId: "1700000000.000200",
    label: "#support",
    visibility: "unknown",
    observedAt: "2026-09-02T10:00:00.000Z",
  },
];

describe("observed Conversation picker", () => {
  it("filters Route choices by match kind and keeps an exact provider ID", () => {
    expect(observedConversationOptions(observations, "thread")).toEqual([
      {
        id: "thread:1700000000.000200",
        conversationId: "1700000000.000200",
        label: "#support · Thread 1700000000.000200",
        description: "Thread · Root C-SUPPORT",
      },
    ]);
  });

  it("shows root and thread choices for Access and parses encoded account resources", () => {
    expect(observedConversationOptions(observations)).toHaveLength(2);
    expect(parseChannelAccountResourceId("slack/customer%2Fsupport")).toEqual({
      channel: "slack",
      accountId: "customer/support",
    });
    expect(parseChannelAccountResourceId("email/support")).toBeNull();
  });
});
