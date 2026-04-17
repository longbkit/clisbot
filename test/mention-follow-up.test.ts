import { describe, expect, test } from "bun:test";
import { buildMentionOnlyFollowUpPrompt } from "../src/channels/mention-follow-up.ts";

describe("mention-only follow-up prompt", () => {
  test("targets the current thread when the explicit mention happens in a thread", () => {
    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "channel",
        threaded: true,
      }),
    ).toContain("this thread");
  });

  test("targets the current conversation for direct messages", () => {
    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "dm",
        threaded: false,
      }),
    ).toContain("this conversation");
  });

  test("targets the recent room context for non-threaded group messages", () => {
    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "channel",
        threaded: false,
      }),
    ).toContain("the recent conversation here");
  });
});
