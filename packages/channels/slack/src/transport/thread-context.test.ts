import { describe, expect, it, vi } from "vitest";
import {
  readSlackThreadContext,
  THREAD_CONTEXT_MESSAGE_CHARS,
  THREAD_CONTEXT_RECENT,
  THREAD_CONTEXT_TOTAL_CHARS,
  type SlackRepliesClient,
} from "./thread-context.js";

const ROOT = "1793756938.227779";
const MENTION = "1793758229.210519";

const alertRoot = {
  ts: ROOT,
  bot_id: "B_ALERT",
  bot_profile: { name: "Alertmanager" },
  text: "",
  attachments: [
    {
      title: "[FIRING:2] DiskUtilization",
      text: "*Alert:* Host out of disk space (instance example-host) - `critical`",
      fields: [{ title: "alertname", value: "DiskUtilization" }],
      fallback: "[FIRING:2] DiskUtilization",
    },
  ],
};

function reply(n: number, extra: Record<string, unknown> = {}) {
  return { ts: `1793757000.${String(n).padStart(6, "0")}`, user: `U${n}`, text: `reply ${n}`, ...extra };
}

/** conversations.replies over one thread: `latest` exclusive, pages of `pageSize`. */
function client(thread: Record<string, unknown>[], pageSize = 200): SlackRepliesClient & {
  replies: ReturnType<typeof vi.fn>;
} {
  const replies = vi.fn(async (args: Record<string, unknown>) => {
    const latest = args["latest"] as string | undefined;
    const visible = thread.filter((m) => latest === undefined || String(m["ts"]) < latest);
    const start = args["cursor"] === undefined ? 0 : Number(args["cursor"]);
    const page = visible.slice(start, start + pageSize);
    const next = start + pageSize < visible.length ? String(start + pageSize) : undefined;
    return {
      messages: page,
      has_more: next !== undefined,
      ...(next === undefined ? {} : { response_metadata: { next_cursor: next } }),
    };
  });
  return { conversations: { replies }, replies };
}

const base = { channelId: "C1", threadTs: ROOT, messageTs: MENTION, botUserId: "U_BOT", botId: "B_BOT" };

describe("readSlackThreadContext", () => {
  it("reads an attachment-only app root and the replies before the mention", async () => {
    const slack = client([alertRoot, reply(1), reply(2), { ts: MENTION, user: "U9", text: "<@U_BOT> check" }]);
    const context = await readSlackThreadContext({ ...base, client: slack });
    expect(context).toEqual({
      root: {
        messageId: ROOT,
        senderId: "B_ALERT",
        senderName: "Alertmanager",
        text: [
          "[FIRING:2] DiskUtilization",
          "*Alert:* Host out of disk space (instance example-host) - `critical`",
          "alertname: DiskUtilization",
        ].join("\n"),
      },
      recent: [
        { messageId: reply(1).ts, senderId: "U1", text: "reply 1" },
        { messageId: reply(2).ts, senderId: "U2", text: "reply 2" },
      ],
    });
    expect(slack.replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", ts: ROOT, latest: MENTION, inclusive: false }),
    );
  });

  it("leaves out anything at or after the mention even if Slack returns it", async () => {
    const slack = client([]);
    slack.replies.mockResolvedValueOnce({
      messages: [alertRoot, { ts: MENTION, user: "U9", text: "the mention" }, { ts: "1793759999.000001", user: "U8", text: "later" }],
      has_more: false,
    });
    const context = await readSlackThreadContext({ ...base, client: slack });
    expect(context?.recent).toEqual([]);
    expect(context?.root?.messageId).toBe(ROOT);
  });

  it("takes no snapshot when the bot already posted in the thread", async () => {
    const byUser = await readSlackThreadContext({
      ...base,
      client: client([alertRoot, reply(1), { ts: "1793757500.000000", user: "U_BOT", text: "on it" }]),
    });
    const byBotId = await readSlackThreadContext({
      ...base,
      client: client([alertRoot, { ts: "1793757500.000000", bot_id: "B_BOT", text: "on it" }]),
    });
    expect(byUser).toBeUndefined();
    expect(byBotId).toBeUndefined();
  });

  it("takes no snapshot when the bot was mentioned earlier in the thread", async () => {
    const context = await readSlackThreadContext({
      ...base,
      client: client([alertRoot, reply(1, { text: "<@U_BOT> look at this" }), reply(2)]),
    });
    expect(context).toBeUndefined();
  });

  it("keeps the newest replies and counts the ones left out", async () => {
    const replies = Array.from({ length: THREAD_CONTEXT_RECENT + 5 }, (_, i) => reply(i + 1));
    const context = await readSlackThreadContext({ ...base, client: client([alertRoot, ...replies]) });
    expect(context?.recent).toHaveLength(THREAD_CONTEXT_RECENT);
    expect(context?.recent[0]?.text).toBe("reply 6");
    expect(context?.recent.at(-1)?.text).toBe(`reply ${THREAD_CONTEXT_RECENT + 5}`);
    expect(context?.omitted).toBe(5);
  });

  it("follows Slack's cursor across pages", async () => {
    const replies = Array.from({ length: 5 }, (_, i) => reply(i + 1));
    const slack = client([alertRoot, ...replies], 2);
    const context = await readSlackThreadContext({ ...base, client: slack });
    expect(slack.replies).toHaveBeenCalledTimes(3);
    expect(context?.recent.map((m) => m.text)).toEqual(replies.map((m) => m.text));
    expect(context).not.toHaveProperty("omitted");
  });

  it("keeps only the root when the read stops before the thread's end", async () => {
    const replies = Array.from({ length: 9 }, (_, i) => reply(i + 1));
    const slack = client([alertRoot, ...replies], 2);
    const context = await readSlackThreadContext({ ...base, client: slack });
    expect(slack.replies).toHaveBeenCalledTimes(3);
    expect(context).toEqual({ root: expect.objectContaining({ messageId: ROOT }), recent: [], omitted: "unknown" });
  });

  it("cuts a long message and stops at the total budget, newest replies first", async () => {
    const long = "x".repeat(THREAD_CONTEXT_MESSAGE_CHARS + 50);
    const replies = Array.from({ length: THREAD_CONTEXT_RECENT }, (_, i) => reply(i + 1, { text: long }));
    const context = await readSlackThreadContext({ ...base, client: client([alertRoot, ...replies]) });
    const texts = [context?.root?.text ?? "", ...(context?.recent ?? []).map((m) => m.text)];
    const kept = texts.reduce((sum, text) => sum + text.replace("… [cut]", "").length, 0);
    expect(kept).toBeLessThanOrEqual(THREAD_CONTEXT_TOTAL_CHARS);
    expect(context?.recent[0]?.text.endsWith("… [cut]")).toBe(true);
    expect(context?.recent.at(-1)?.messageId).toBe(reply(THREAD_CONTEXT_RECENT).ts);
    expect(context?.omitted).toBe(THREAD_CONTEXT_RECENT - (context?.recent.length ?? 0));
  });

  it.each([
    ["missing_scope", { code: "slack_webapi_platform_error", data: { ok: false, error: "missing_scope" } }],
    ["not_in_channel", { code: "slack_webapi_platform_error", data: { ok: false, error: "not_in_channel" } }],
    ["slack_webapi_rate_limited_error", { code: "slack_webapi_rate_limited_error" }],
  ])("reports %s instead of failing the mention", async (reason, error) => {
    const slack = client([]);
    slack.replies.mockRejectedValueOnce(Object.assign(new Error(reason), error));
    await expect(readSlackThreadContext({ ...base, client: slack })).resolves.toEqual({
      recent: [],
      unavailable: reason,
    });
  });

  it("gives up after its budget so admission never waits longer", async () => {
    const slack = client([]);
    slack.replies.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(readSlackThreadContext({ ...base, client: slack, budgetMs: 30 })).resolves.toEqual({
      recent: [],
      unavailable: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("says when Slack did not return the root", async () => {
    const context = await readSlackThreadContext({ ...base, client: client([reply(1)]) });
    expect(context).toEqual({
      recent: [{ messageId: reply(1).ts, senderId: "U1", text: "reply 1" }],
      unavailable: "root_not_returned",
    });
  });
});
