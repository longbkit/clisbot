import { describe, expect, test } from "bun:test";
import {
  renderPlatformInteraction,
  renderPlatformTranscriptCommand,
} from "../src/channels/message/rendering.ts";

describe("channel rendering", () => {
  test("formats transcript command hints using the channel renderer family", () => {
    expect(renderPlatformTranscriptCommand("slack")).toBe("`/transcript`");
    expect(renderPlatformTranscriptCommand("telegram")).toBe("/transcript");
    expect(renderPlatformTranscriptCommand("zalo-bot")).toBe("/transcript");
  });

  test("reuses telegram-family detached rendering for zalo-bot", () => {
    const rendered = renderPlatformInteraction({
      platform: "zalo-bot",
      status: "detached",
      content: "Still working through the repository.",
      maxChars: 200,
      note:
        "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
      allowTranscriptInspection: true,
    });

    expect(rendered).toContain("You can also use /transcript to inspect the current session snapshot.");
    expect(rendered).not.toContain("`/transcript`");
  });
});
