// The observed resend path: MCP message(action=send, text=Markdown), with no presentation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { slackPlugin } from "@getpaseo/channels-slack/dist/plugin.js";
import { sendSlackText } from "@getpaseo/channels-slack/dist/outbound.js";
import { slackWebClientStubForTest } from "@getpaseo/channels-slack/dist/client/web-api.js";
import type { ChannelStore } from "../db/channels.js";
import { createChannelReplyServer, type ChannelReplyMcp } from "./channel-reply.js";
import { ChannelReplyCapabilityRegistry } from "./channel-reply-capabilities.js";
import { forgetChannelMessageToolCatalog } from "./channel-message-tool.js";
import { clearChannelMessageActions, registerChannelMessageActions } from "./message-actions.js";

const SCOPE = { organizationId: "markdown-table-test", channel: "slack", accountId: "work" };
const REF = {
  channel: "slack" as const,
  accountId: "work",
  externalConversationId: "C0TABLETEST",
  externalThreadId: "1700000000.000001",
};
const ROWS = Array.from({ length: 13 }, (_, index) => [
  index < 4 ? "P0" : "P1",
  `Công việc ${index + 1}`,
  "Đang mở",
]);
const TEXT = [
  "<@U0BOT> Gửi lại bảng công việc:",
  "",
  "| Ưu tiên | Công việc | Trạng thái |",
  "|---|---|---|",
  ...ROWS.map((row) => `| ${row.join(" | ")} |`),
  "",
  "Bản tạm; giữ nguyên nội dung.",
].join("\n");

interface SlackPost {
  channel: string;
  thread_ts?: string;
  text?: string;
  blocks?: Array<{ type: string; text?: { text: string }; rows?: Array<Array<{ text: string }>> }>;
}

function createPost(mode: "block" | "code") {
  const posts: SlackPost[] = [];
  const client = slackWebClientStubForTest();
  client.chat.postMessage = async (args) => {
    posts.push(args as SlackPost);
    return { ok: true, channel: args.channel, ts: `1700000001.00000${posts.length}` };
  };
  const cfg = {
    channels: {
      slack: { markdown: { tables: mode }, accounts: { work: { botToken: "xoxb-table-test" } } },
    },
  };
  const post: ChannelReplyMcp["post"] = async (ref, text, options) => {
    const result = await sendSlackText({
      cfg,
      client,
      accountId: ref.accountId,
      to: ref.externalConversationId,
      ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
      text,
      ...(options?.presentation ? { presentation: options.presentation } : {}),
    });
    return { ok: true, externalMessageId: result.messageId };
  };
  return { posts, post };
}

function createFixture(mode: "block" | "code" = "block") {
  const { posts, post } = createPost(mode);
  registerChannelMessageActions(SCOPE, slackPlugin as never);
  forgetChannelMessageToolCatalog(SCOPE);
  const registry = new ChannelReplyCapabilityRegistry();
  const token = registry.issue({
    organizationId: SCOPE.organizationId,
    channelRevisionId: "test",
    routePosition: 0,
    routeFingerprint: "test",
    ref: REF,
    requesterSenderId: "U0REQUESTER",
  });
  registry.bind(token, "agent-test");
  const confirmDelivery = vi.fn(async () => ({}));
  const failDelivery = vi.fn(async () => ({}));
  const store = {
    recordDelivery: async () => ({ created: true }),
    confirmDelivery,
    failDelivery,
  } as unknown as ChannelStore;
  const server = createChannelReplyServer({
    organizationId: SCOPE.organizationId,
    store,
    post,
    resolveCapability: (candidate) => registry.resolve(candidate, SCOPE.organizationId),
    reserveTurnOutput: (candidate) => registry.reserveTurnOutput(candidate),
    noteDelivery: (candidate, delivery) => registry.noteDelivery(candidate, delivery),
  });
  return { posts, confirmDelivery, failDelivery, server, token };
}

async function send(fixture: ReturnType<typeof createFixture>, field = "text") {
  const response = await fixture.server.handle(
    new Request(`https://hub.test/mcp/channel/${fixture.token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "message",
          arguments: { action: "send", [field]: TEXT, replyTo: REF.externalThreadId, final: true },
        },
      }),
    }),
    fixture.token,
  );
  const body = (await response.json()) as {
    error?: unknown;
    result: { isError?: boolean; structuredContent?: { ok?: boolean; messageId?: string } };
  };
  expect(body.error).toBeUndefined();
  expect(body.result.isError).not.toBe(true);
  expect(body.result.structuredContent?.ok).toBe(true);
  expect(fixture.failDelivery).not.toHaveBeenCalled();
  expect(fixture.confirmDelivery).toHaveBeenCalledTimes(1);
  return body.result;
}

afterEach(() => {
  clearChannelMessageActions(SCOPE);
  forgetChannelMessageToolCatalog(SCOPE);
});

describe("channel_reply.message resends Markdown tables", () => {
  it.each(["text", "message"])(
    "renders a raw %s argument without a presentation and preserves every row",
    async (field) => {
      const fixture = createFixture();
      const result = await send(fixture, field);
      expect(fixture.posts).toHaveLength(1);
      const post = fixture.posts[0]!;
      expect(post.channel).toBe(REF.externalConversationId);
      expect(post.thread_ts).toBe(REF.externalThreadId);
      expect(post.blocks?.map((block) => block.type)).toEqual(["section", "data_table", "section"]);
      const actualRows = [];
      for (const row of post.blocks?.[1]?.rows?.slice(1) ?? []) {
        actualRows.push(row.map((cell) => cell.text));
      }
      expect(actualRows).toEqual(ROWS);
      expect(post.blocks?.[0]?.text?.text).toContain("<@U0BOT>");
      expect(post.blocks?.[2]?.text?.text).toBe("Bản tạm; giữ nguyên nội dung.");
      expect(result.structuredContent?.messageId).toBe("1700000001.000001");
    },
  );

  it("honours the code-table opt-out on the same MCP route", async () => {
    const fixture = createFixture("code");
    await send(fixture);
    expect(fixture.posts[0]?.blocks).toBeUndefined();
    expect(fixture.posts[0]?.text).toContain("```");
    expect(fixture.posts[0]?.text).toContain("Công việc 13");
  });
});
