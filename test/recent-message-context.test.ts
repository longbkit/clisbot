import { describe, expect, test } from "bun:test";
import {
  appendRecentConversationMessage,
  collectRecentConversationReplayMessages,
  markRecentConversationProcessed,
  prependRecentConversationContext,
} from "../src/shared/recent-message-context.ts";

describe("recent conversation context", () => {
  test("keeps only the latest five messages", () => {
    let state = undefined;
    for (let index = 1; index <= 6; index += 1) {
      state = appendRecentConversationMessage(state, {
        marker: `m${index}`,
        text: `message ${index}`,
      });
    }

    expect(state?.messages.map((message) => message.marker)).toEqual([
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
    ]);
  });

  test("replays only messages after the last processed marker and skips the current marker", () => {
    let state = appendRecentConversationMessage(undefined, {
      marker: "m1",
      text: "first",
    });
    state = appendRecentConversationMessage(state, {
      marker: "m2",
      text: "",
    });
    state = appendRecentConversationMessage(state, {
      marker: "m3",
      text: "third",
      senderName: "Alice",
    });
    state = appendRecentConversationMessage(state, {
      marker: "m4",
      text: "fourth",
      senderName: "Bob",
    });
    state = markRecentConversationProcessed(state, "m2");

    expect(
      collectRecentConversationReplayMessages(state, {
        excludeMarker: "m4",
      }),
    ).toEqual([
      {
        marker: "m3",
        text: "third",
        senderName: "Alice",
      },
    ]);
  });

  test("prepends readable replay context without surfacing marker-only entries", () => {
    const text = prependRecentConversationContext({
      currentText: "please reply now",
      recentMessages: [
        {
          marker: "m1",
          text: "",
        },
        {
          marker: "m2",
          text: "Need the release note too.",
          senderName: "Alice",
        },
      ],
    });

    expect(text).toContain(
      "Before answering, catch up on these newer messages from this conversation that were not processed yet:",
    );
    expect(text).toContain("- Alice: Need the release note too.");
    expect(text).toContain("Current message:");
    expect(text).toContain("please reply now");
    expect(text).not.toContain("m1");
  });
});
