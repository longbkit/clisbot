import { describe, expect, it } from "vitest";
import type { HubObservedChannelConversation } from "../contracts";
import {
  observedConversationOptions,
  parseChannelAccountResourceId,
  splitConversationIds,
} from "../conversation-picker";

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
  it("parses comma and newline separated exact IDs without duplicates or empty entries", () => {
    expect(splitConversationIds(" C1, C2\nC1\r\n, C3 ,,\n C2 ")).toEqual(["C1", "C2", "C3"]);
    expect(splitConversationIds(" \n,\r\n ")).toEqual([]);
    expect(splitConversationIds("Case, case, ID with space")).toEqual([
      "Case",
      "case",
      "ID with space",
    ]);
  });

  it("merges configured names with observed choices without duplicating kind and ID", () => {
    const configured = {
      ...observations[0]!,
      label: "#renamed-support",
    };
    const options = observedConversationOptions(observations, "channel", [configured]);
    expect(options).toEqual([
      {
        id: "channel:C-SUPPORT",
        conversationId: "C-SUPPORT",
        label: "#renamed-support",
        description: "Channel · C-SUPPORT",
      },
    ]);
    expect(
      observedConversationOptions(observations, "channel", [{ ...configured, label: null }])[0]
        ?.label,
    ).toBe("#support");
    expect(observedConversationOptions([], "channel", [configured])).toHaveLength(1);
    expect(observedConversationOptions([], "topic", [configured])).toHaveLength(0);
  });

  it("keeps nested names as parent labels and identifies IDs with multiple parents", () => {
    const topic = {
      ...observations[1]!,
      id: "42",
      kind: "topic" as const,
      threadId: "42",
      rootConversationId: "-100",
      label: "Support group",
    };
    expect(observedConversationOptions([], "topic", [topic])[0]?.label).toBe(
      "Support group · Topic 42",
    );
    expect(
      observedConversationOptions([topic], "topic", [
        { ...topic, rootConversationId: "-200", label: null },
      ])[0]?.label,
    ).toBe("Topic 42");
    expect(
      observedConversationOptions(
        [topic, { ...topic, rootConversationId: "-200", label: "Another group" }],
        "topic",
      )[0]?.description,
    ).toBe("This ID appears in multiple parent conversations.");
  });

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
