import { describe, expect, test } from "bun:test";
import { normalizeSlackReactionName } from "../src/channels/slack/reactions.ts";

describe("slack reactions", () => {
  test("normalizes colon-wrapped Slack reaction aliases", () => {
    expect(normalizeSlackReactionName(":heavy_check_mark:")).toBe(
      "heavy_check_mark",
    );
  });

  test("keeps already-normalized Slack reaction aliases", () => {
    expect(normalizeSlackReactionName("hourglass_flowing_sand")).toBe(
      "hourglass_flowing_sand",
    );
  });

  test("treats blank reaction config as disabled", () => {
    expect(normalizeSlackReactionName("   ")).toBeNull();
    expect(normalizeSlackReactionName("")).toBeNull();
  });
});
