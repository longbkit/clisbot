// Fusion (D-046): a thread read leads with the thread parent. Shape taken from a
// live report: an Alertmanager parent whose content is only in `attachments`,
// followed by @-mention replies.
import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import { readSlackMessages } from "./actions.js";

vi.mock("./client.js", () => ({
  createSlackLookupClient: vi.fn(),
  getSlackWriteClient: vi.fn(),
}));

const ROOT_TS = "1793756938.227779";
const alertRoot = {
  ts: ROOT_TS,
  bot_id: "BALERT",
  text: "",
  attachments: [
    {
      title: "[FIRING:2] DiskUtilization",
      text: "*Alert:* Host out of disk space (instance example-host) - `critical`",
      fallback: "[FIRING:2] DiskUtilization",
    },
  ],
};
const thread = [
  alertRoot,
  { ts: "1793758229.210519", user: "U1", text: "<@UBOT>\ncheck if we can free up disk space" },
  { ts: "1793758277.116369", bot_id: "BBOT", text: "Checking the disk" },
];

type RepliesArgs = { oldest?: string; latest?: string; inclusive?: boolean; limit?: number };

// Slack's conversations.replies over `thread`: ts order, exclusive bounds unless `inclusive`.
// `parentAlways` mirrors Slack returning the parent first regardless of the window.
function slackClient(options: { parentAlways?: boolean } = {}) {
  const replies = vi.fn(async ({ oldest, latest, inclusive, limit }: RepliesArgs) => {
    const inWindow = (ts: string) =>
      (oldest === undefined || (inclusive ? ts >= oldest : ts > oldest)) &&
      (latest === undefined || (inclusive ? ts <= latest : ts < latest));
    const matched = thread.filter((message) => inWindow(message.ts));
    const messages =
      options.parentAlways && matched[0] !== alertRoot ? [alertRoot, ...matched] : matched;
    return { messages: messages.slice(0, limit), has_more: false };
  });
  return {
    client: { conversations: { replies, history: vi.fn() } } as unknown as WebClient,
    replies,
  };
}

function read(client: WebClient, extra: Record<string, string | number> = {}) {
  return readSlackMessages("C054TMV0BHA", {
    client,
    token: "xoxb-test",
    threadId: ROOT_TS,
    ...extra,
  });
}

describe("Slack thread reads include the thread parent", () => {
  it("leads with an attachment-only parent, attachments untouched", async () => {
    const { client } = slackClient();
    const result = await read(client);
    expect(result.messages.map((message) => message.ts)).toEqual(thread.map((m) => m.ts));
    expect(result.messages[0]?.attachments).toEqual(alertRoot.attachments);
  });

  it("uses the parent Slack already returned instead of fetching it again", async () => {
    const { client, replies } = slackClient({ parentAlways: true });
    const result = await read(client);
    expect(replies).toHaveBeenCalledTimes(1);
    expect(result.messages.map((message) => message.ts)).toEqual(thread.map((m) => m.ts));
  });

  it("returns the parent for a window that spans it", async () => {
    const { client } = slackClient();
    const result = await read(client, {
      after: "1793756900.000000",
      before: "1793757000.000000",
    });
    expect(result.messages.map((message) => message.ts)).toEqual([ROOT_TS]);
  });

  it("omits the parent from a continuation page (`after` past the parent)", async () => {
    const { client, replies } = slackClient();
    const result = await read(client, { after: "1793758229.210519" });
    expect(replies).toHaveBeenCalledTimes(1);
    expect(result.messages.map((message) => message.ts)).toEqual(["1793758277.116369"]);
  });

  it("omits the parent when `before` ends at or before it", async () => {
    const { client } = slackClient();
    const result = await read(client, { before: ROOT_TS });
    expect(result.messages).toEqual([]);
  });

  it("does not count the parent against `limit`", async () => {
    const { client } = slackClient();
    const result = await read(client, { limit: 1 });
    expect(result.messages.map((message) => message.ts)).toEqual([ROOT_TS, "1793758229.210519"]);
  });

  it("still returns exactly one message for messageId", async () => {
    const { client } = slackClient();
    const result = await read(client, { messageId: "1793758229.210519" });
    expect(result.messages.map((message) => message.ts)).toEqual(["1793758229.210519"]);
  });

  it("says the root is missing when the parent is gone", async () => {
    const { client, replies } = slackClient();
    replies.mockImplementationOnce(async () => ({ messages: thread.slice(1), has_more: false }));
    replies.mockImplementationOnce(async () => ({ messages: [], has_more: false }));
    const result = await read(client);
    expect(result).toEqual({
      messages: thread.slice(1),
      hasMore: false,
      threadRootUnavailable: "not_found",
    });
  });

  it("keeps the replies and hasMore when the parent lookup is rate limited", async () => {
    const { client, replies } = slackClient();
    replies.mockImplementationOnce(async () => ({ messages: thread.slice(1, 2), has_more: true }));
    replies.mockImplementationOnce(async () => {
      throw Object.assign(new Error("A rate limit was exceeded"), {
        code: "slack_webapi_rate_limited_error",
        retryAfter: 30,
      });
    });
    const result = await read(client, { limit: 1 });
    expect(result).toEqual({
      messages: thread.slice(1, 2),
      hasMore: true,
      threadRootUnavailable: "slack_webapi_rate_limited_error",
    });
  });

  it("reports the Slack platform error when the parent lookup is denied", async () => {
    const { client, replies } = slackClient();
    replies.mockImplementationOnce(async () => ({ messages: thread.slice(1), has_more: false }));
    replies.mockImplementationOnce(async () => {
      throw Object.assign(new Error("An API error occurred: missing_scope"), {
        code: "slack_webapi_platform_error",
        data: { ok: false, error: "missing_scope" },
      });
    });
    const result = await read(client);
    expect(result.messages.map((message) => message.ts)).toEqual(thread.slice(1).map((m) => m.ts));
    expect(result.threadRootUnavailable).toBe("missing_scope");
  });

  it("still throws when the replies page itself fails", async () => {
    const { client, replies } = slackClient();
    replies.mockRejectedValueOnce(new Error("channel_not_found"));
    await expect(read(client)).rejects.toThrow("channel_not_found");
  });

  it("returns the root of a thread with no replies yet", async () => {
    const { client, replies } = slackClient();
    replies.mockImplementationOnce(async () => ({ messages: [], has_more: false }));
    const result = await read(client, { limit: 1 });
    expect(result).toEqual({ messages: [alertRoot], hasMore: false });
    expect(result).not.toHaveProperty("threadRootUnavailable");
  });

  it("adds the root to a page Slack returned empty but with more to come", async () => {
    const { client, replies } = slackClient();
    replies.mockImplementationOnce(async () => ({ messages: [], has_more: true }));
    const result = await read(client, { limit: 1 });
    expect(result).toEqual({ messages: [alertRoot], hasMore: true });
  });

  it("does not duplicate the root when Slack's limited page holds only the root", async () => {
    const { client, replies } = slackClient({ parentAlways: true });
    replies.mockImplementationOnce(async () => ({ messages: [alertRoot], has_more: true }));
    const result = await read(client, { after: "1793756900.000000", limit: 1 });
    expect(replies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messages: [alertRoot], hasMore: true });
  });

  it.each([
    ["after one microsecond before the root", { after: "1793756938.227778" }, true],
    ["after exactly the root", { after: ROOT_TS }, false],
    ["after the root written with a trailing zero", { after: "1793756938.2277790" }, false],
    ["before one microsecond after the root", { before: "1793756938.227780" }, true],
    ["before exactly the root", { before: ROOT_TS }, false],
    ["before the root's whole second", { before: "1793756938" }, false],
  ])("compares the window bound exactly: %s", async (_label, bounds, included) => {
    const { client } = slackClient();
    const result = await read(client, bounds);
    expect(result.messages.some((message) => message.ts === ROOT_TS)).toBe(included);
    expect(result).not.toHaveProperty("threadRootUnavailable");
  });
});
