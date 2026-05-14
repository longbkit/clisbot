import { describe, expect, test } from "bun:test";
import { renderChildSurfaceFlag } from "../src/channels/message/message-surface-helpers.ts";

describe("message surface helpers", () => {
  test("renders child-surface flags through the channel plugin contract", () => {
    expect(renderChildSurfaceFlag({
      channel: "slack",
      kind: "thread",
    })).toBe("--thread-id");
    expect(renderChildSurfaceFlag({
      channel: "telegram",
      kind: "topic",
    })).toBe("--topic-id");
  });

  test("rejects unsupported child-surface kinds instead of falling back centrally", () => {
    expect(() =>
      renderChildSurfaceFlag({
        channel: "zalo-bot",
        kind: "thread",
      })).toThrow("Zalo Bot does not support channel child-surface flags.");

    expect(() =>
      renderChildSurfaceFlag({
        channel: "slack",
        kind: "topic",
      })).toThrow("Slack does not support child-surface kind topic.");
  });
});
