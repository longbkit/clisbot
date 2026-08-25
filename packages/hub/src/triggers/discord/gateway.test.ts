import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExternalTrigger } from "../index.js";
import { NormalizedDiscordMessageEventSchema } from "./events.js";
import { createDiscordGatewaySource, normalizeMessage } from "./gateway.js";
import { MemoryDiscordBotClient } from "./memory-bot.js";

describe("Discord gateway source", () => {
  it("requires a top-level event id in the normalized event schema", () => {
    const parsed = NormalizedDiscordMessageEventSchema.safeParse({
      type: "mention",
      guildId: "100",
      channelId: "200",
      threadId: null,
      parentChannelId: null,
      messageId: "300",
      content: "@paseo ping",
      mentionedUserIds: ["900"],
      mentionedBotRoleIds: [],
      author: { id: "400", username: "tester", bot: false },
      createdAt: new Date("2026-05-19T00:00:00.000Z").toISOString(),
      attachments: [],
      referencedMessage: null,
    });

    assert.equal(parsed.success, false);
  });

  it("normalizes a guild message into the canonical event shape", () => {
    const event = normalizeMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "200",
        id: "300",
        content: "@paseo ping",
        mentionedUserIds: ["900"],
        authorId: "400",
        authorUsername: "tester",
        authorBot: false,
      }),
    );

    assert.deepEqual(event, {
      type: "mention",
      id: "300",
      guildId: "100",
      channelId: "200",
      threadId: null,
      parentChannelId: null,
      messageId: "300",
      content: "@paseo ping",
      mentionedUserIds: ["900"],
      mentionedBotRoleIds: [],
      author: { id: "400", username: "tester", bot: false },
      createdAt: new Date("2026-05-19T00:00:00.000Z").toISOString(),
      attachments: [],
      referencedMessage: null,
    });
  });

  it("rejects non-positive and non-decimal snowflakes at the Gateway boundary", () => {
    assert.throws(() =>
      normalizeMessage(buildDiscordMention({ guildId: "0", channelId: "200", id: "300" })),
    );
    assert.throws(() =>
      normalizeMessage(buildDiscordMention({ guildId: "guild", channelId: "200", id: "300" })),
    );
    assert.throws(() =>
      normalizeMessage(buildDiscordMention({ guildId: "100", channelId: "-2", id: "300" })),
    );
  });

  it("normalizes parsed mentioned users from Discord metadata", () => {
    const event = normalizeMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "200",
        id: "397",
        content: "<@900> hello",
        mentionedUserIds: ["900", "402"],
      }),
    );

    assert.deepEqual(event?.mentionedUserIds, ["900", "402"]);
  });

  it("normalizes a managed role mention that belongs to the bot", () => {
    const event = normalizeMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "200",
        id: "396",
        content: "<@&800> hello",
        mentionedRoles: [
          { id: "800", botId: "900" },
          { id: "801", botId: "901" },
        ],
      }),
      "900",
    );

    assert.deepEqual(event?.mentionedBotRoleIds, ["800"]);
  });

  it("captures threadId and parentChannelId when the message originates in a thread", () => {
    const event = normalizeMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "302",
        isThread: true,
        parentId: "200",
      }),
    );

    assert.equal(event?.threadId, "207");
    assert.equal(event?.parentChannelId, "200");
  });

  it("normalizes attachments and referenced-message identity", () => {
    const event = normalizeMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "200",
        id: "302",
        attachments: [
          {
            id: "701",
            name: "design.png",
            url: "https://cdn.discordapp.com/attachments/200/701/design.png",
            contentType: "image/png",
            size: 42,
          },
        ],
        reference: { messageId: "299", channelId: "200", guildId: "100" },
      }),
    );

    assert.deepEqual(event?.attachments, [
      {
        id: "701",
        filename: "design.png",
        url: "https://cdn.discordapp.com/attachments/200/701/design.png",
        contentType: "image/png",
        size: 42,
      },
    ]);
    assert.deepEqual(event?.referencedMessage, {
      id: "299",
      channelId: "200",
      guildId: "100",
    });
  });

  it("returns undefined for DMs (no guildId)", () => {
    const event = normalizeMessage(
      buildDiscordMention({ guildId: null, channelId: "500", id: "303" }),
    );
    assert.equal(event, undefined);
  });

  it("dispatches received messages as ExternalTrigger payloads", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });

    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "200",
        id: "300",
        content: "<@900> hi",
        mentionedUserIds: ["900"],
      }),
    );

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]?.source, "discord.mention");
    assert.equal(dispatched[0]?.deliveryId, "discord-300");
    await source.stop();
  });

  it("defers thread history and attachment work until provider materialization", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    let contextFetches = 0;
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });

    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "303",
        content: "<@900> deploy",
        mentionedUserIds: ["900"],
        isThread: true,
        parentId: "200",
        onThreadContextFetch: () => {
          contextFetches += 1;
        },
        threadMessages: [
          contextMessage("302", "second", "2026-05-19T00:02:00.000Z", {
            attachments: [
              {
                id: "702",
                name: "context.txt",
                url: "https://cdn.discordapp.com/attachments/207/702/context.txt",
                contentType: "text/plain",
                size: 12,
              },
            ],
            reference: { messageId: "301", channelId: "207", guildId: "100" },
          }),
          contextMessage("303", "trigger", "2026-05-19T00:03:00.000Z"),
          contextMessage("301", "first", "2026-05-19T00:01:00.000Z"),
        ],
      }),
    );

    const event = NormalizedDiscordMessageEventSchema.parse(dispatched[0]?.payload);
    assert.equal(event.threadId, "207");
    assert.equal(contextFetches, 0);
    await source.stop();
  });

  it("does not fetch thread context for ordinary or bot-authored thread messages", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    let contextFetches = 0;
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });

    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "304",
        content: "ordinary thread reply",
        mentionedUserIds: [],
        isThread: true,
        parentId: "200",
        onThreadContextFetch: () => {
          contextFetches += 1;
        },
        threadMessages: [contextMessage("301", "first", "2026-05-19T00:01:00.000Z")],
      }),
    );
    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "305",
        content: "<@900> bot reply",
        authorBot: true,
        mentionedUserIds: ["900"],
        isThread: true,
        parentId: "200",
        onThreadContextFetch: () => {
          contextFetches += 1;
        },
        threadMessages: [contextMessage("301", "first", "2026-05-19T00:01:00.000Z")],
      }),
    );

    assert.equal(contextFetches, 0);
    assert.equal(dispatched.length, 0);
    await source.stop();
  });

  it("accepts a valid thread mention without hydrating history", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    let contextFetches = 0;
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });

    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "306",
        content: "<@900> deploy",
        mentionedUserIds: ["900"],
        isThread: true,
        parentId: "200",
        onThreadContextFetch: () => {
          contextFetches += 1;
        },
        threadContextFetchError: new Error("missing history permission"),
      }),
    );

    assert.equal(contextFetches, 0);
    assert.equal(dispatched.length, 1);
    const event = NormalizedDiscordMessageEventSchema.parse(dispatched[0]?.payload);
    assert.equal(event.threadId, "207");
    await source.stop();
  });

  it("does not fetch recent thread context during ingestion", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    let contextFetches = 0;
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });
    const newestFirst = Array.from({ length: 101 }, (_, index) => {
      const id = String(600 - index);
      return contextMessage(
        id,
        `message-${id}`,
        new Date(Date.UTC(2026, 4, 19, 0, 10) - index * 1_000).toISOString(),
      );
    });

    await bot.emitMessage(
      buildDiscordMention({
        guildId: "100",
        channelId: "207",
        id: "700",
        content: "<@900> summarize",
        mentionedUserIds: ["900"],
        isThread: true,
        parentId: "200",
        onThreadContextFetch: () => {
          contextFetches += 1;
        },
        threadMessages: newestFirst,
      }),
    );

    assert.equal(contextFetches, 0);
    const event = NormalizedDiscordMessageEventSchema.parse(dispatched[0]?.payload);
    assert.equal(event.threadId, "207");
    await source.stop();
  });

  it("propagates trigger handler failures", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    await source.start(async () => {
      throw new Error("dispatch failed");
    });

    await assert.rejects(
      () =>
        bot.emitMessage(
          buildDiscordMention({
            guildId: "100",
            channelId: "200",
            id: "398",
            content: "<@900> hi",
            mentionedUserIds: ["900"],
          }),
        ),
      /dispatch failed/u,
    );
    await source.stop();
  });

  it("skips DM messages instead of dispatching them", async () => {
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const source = createDiscordGatewaySource(gatewayOptions(bot));
    const dispatched: ExternalTrigger[] = [];
    await source.start(async (trigger) => {
      dispatched.push(trigger);
    });

    await bot.emitMessage(buildDiscordMention({ guildId: null, channelId: "500", id: "399" }));

    assert.equal(dispatched.length, 0);
    await source.stop();
  });
});

function gatewayOptions(bot: MemoryDiscordBotClient) {
  return {
    bot,
    accept: (input: {
      guildId: string;
      deliveryId: string;
      source: string;
      payload: unknown;
      receivedAt: Date;
    }) =>
      Promise.resolve({
        status: "accepted" as const,
        receiptId: `receipt-${input.deliveryId}`,
        events: [
          {
            providerEventReceiptId: `trigger-${input.deliveryId}`,
            organizationId: "org_1",
            projectId: "project-1",
            configurationRevisionId: "11111111-1111-4111-8111-111111111131",
            deliveryId: input.deliveryId,
            source: input.source,
            payload: input.payload,
            receivedAt: input.receivedAt,
            connectionId: "discord-connection",
            resourceId: input.guildId,
          },
        ],
      }),
    applyGuildDelete: () => Promise.resolve(),
  };
}

interface DiscordMentionOptions {
  guildId: string | null;
  channelId: string;
  id: string;
  content?: string;
  authorId?: string;
  authorUsername?: string;
  authorBot?: boolean;
  mentionedUserIds?: string[];
  mentionedRoles?: { id: string; botId?: string }[];
  isThread?: boolean;
  parentId?: string | null;
  createdAt?: Date;
  threadMessages?: ReturnType<typeof contextMessage>[];
  onThreadContextFetch?: () => void;
  threadContextFetchError?: Error;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    contentType: string | null;
    size: number;
  }>;
  reference?: { messageId: string; channelId: string; guildId?: string | null } | null;
}

function buildDiscordMention(
  options: DiscordMentionOptions,
): Parameters<typeof normalizeMessage>[0] {
  const isThread = options.isThread ?? false;
  const channel = {
    isThread(): boolean {
      return isThread;
    },
    parentId: options.parentId ?? null,
    messages: {
      fetch: () => {
        options.onThreadContextFetch?.();
        if (options.threadContextFetchError !== undefined) {
          return Promise.reject(options.threadContextFetchError);
        }
        const page = options.threadMessages ?? [];
        return Promise.resolve({
          size: page.length,
          values: () => page.values(),
          last: () => page.at(-1),
        });
      },
    },
  };

  const fake: unknown = {
    guildId: options.guildId,
    channelId: options.channelId,
    channel,
    id: options.id,
    content: options.content ?? "",
    mentions: {
      users: (options.mentionedUserIds ?? []).map((id) => ({ id })),
      roles: (options.mentionedRoles ?? []).map((role) => ({
        id: role.id,
        tags: role.botId === undefined ? null : { botId: role.botId },
      })),
    },
    author: {
      id: options.authorId ?? "400",
      username: options.authorUsername ?? "tester",
      bot: options.authorBot ?? false,
    },
    createdAt: options.createdAt ?? new Date("2026-05-19T00:00:00.000Z"),
    attachments: { values: () => (options.attachments ?? []).values() },
    reference: options.reference ?? null,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return fake as Parameters<typeof normalizeMessage>[0];
}

function contextMessage(
  id: string,
  content: string,
  createdAt: string,
  options: Pick<DiscordMentionOptions, "attachments" | "reference"> = {},
) {
  return {
    id,
    channelId: "207",
    content,
    author: { id: "401", username: "context-author", bot: false },
    createdAt: new Date(createdAt),
    attachments: { values: () => (options.attachments ?? []).values() },
    reference: options.reference ?? null,
  };
}
