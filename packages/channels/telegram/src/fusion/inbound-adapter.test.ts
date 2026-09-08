// Slice 20: the inbound event shapes the vertical emits, and the two audited
// mention bugs (`text_mention` of our bot; `/cmd@other_bot` is not ours).

import { describe, expect, it } from "vitest";
import type { Message, Update } from "grammy/types";
import {
  buildTelegramInboundEvent,
  buildTelegramMessageEvent,
  hasTelegramTextMentionOfBot,
  resolveTelegramMentionFacts,
  TELEGRAM_BODY_LABELS,
} from "./inbound-adapter.js";

const BOT_ID = 991_001;
const PARAMS = { accountId: "acct", botId: BOT_ID, botUsername: "longluong3bot" };

function message(overrides: Record<string, unknown> = {}): Message {
  return {
    message_id: 10,
    date: 1_700_000_000,
    chat: { id: -100_1, type: "supergroup", title: "Test Group" },
    from: { id: 42, is_bot: false, first_name: "Human", username: "human" },
    text: "hello",
    ...overrides,
  } as unknown as Message;
}

function update(overrides: Record<string, unknown>, updateId = 5): Update {
  return { update_id: updateId, ...overrides } as unknown as Update;
}

describe("mention facts", () => {
  it("counts an @username mention of the bot", () => {
    const facts = resolveTelegramMentionFacts(
      message({
        text: "@longluong3bot ping",
        entities: [{ type: "mention", offset: 0, length: 14 }],
      }),
      PARAMS,
    );
    expect(facts.wasMentioned).toBe(true);
    expect(facts.addressedToOtherBot).toBe(false);
  });

  it("counts a text_mention of our bot (audited bug: upstream only reads `mention`)", () => {
    const msg = message({
      text: "Longluong ping",
      entities: [
        {
          type: "text_mention",
          offset: 0,
          length: 9,
          user: { id: BOT_ID, is_bot: true, first_name: "Longluong" },
        },
      ],
    });
    expect(hasTelegramTextMentionOfBot(msg, BOT_ID)).toBe(true);
    expect(resolveTelegramMentionFacts(msg, PARAMS).wasMentioned).toBe(true);
  });

  it("ignores a text_mention of somebody else", () => {
    const msg = message({
      text: "Someone ping",
      entities: [
        {
          type: "text_mention",
          offset: 0,
          length: 7,
          user: { id: 12_345, is_bot: false, first_name: "Someone" },
        },
      ],
    });
    expect(hasTelegramTextMentionOfBot(msg, BOT_ID)).toBe(false);
    expect(resolveTelegramMentionFacts(msg, PARAMS).wasMentioned).toBe(false);
  });

  it("does not treat /cmd@other_bot as ours (audited bug)", () => {
    const msg = message({
      text: "/status@some_other_bot now",
      entities: [{ type: "bot_command", offset: 0, length: 22 }],
    });
    const facts = resolveTelegramMentionFacts(msg, PARAMS);
    expect(facts.addressedToOtherBot).toBe(true);
    expect(facts.wasMentioned).toBe(false);
    expect(buildTelegramMessageEvent([msg], 7, PARAMS)).toBeNull();
  });

  it("treats /cmd@our_bot and a bare /cmd as ours", () => {
    const addressed = message({
      text: "/status@longluong3bot",
      entities: [{ type: "bot_command", offset: 0, length: 21 }],
    });
    expect(resolveTelegramMentionFacts(addressed, PARAMS).wasMentioned).toBe(true);
    const bare = message({
      text: "/status",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    });
    const facts = resolveTelegramMentionFacts(bare, PARAMS);
    expect(facts.wasMentioned).toBe(true);
    expect(facts.command).toBe("/status");
  });
});

describe("message events", () => {
  it("normalizes a group message and flags own messages by bot id", () => {
    const build = buildTelegramMessageEvent([message()], 5, PARAMS);
    expect(build?.kind).toBe("message");
    expect(build?.event).toMatchObject({
      channel: "telegram",
      externalEventId: "update:5",
      externalMessageId: "10",
      externalConversationId: "-1001",
      chatType: "group",
      senderId: "42",
      senderName: "Human",
      senderUsername: "human",
      body: "hello",
      conversationLabel: "Test Group",
      isOwnMessage: false,
      timestampMs: 1_700_000_000_000,
    });
    const own = buildTelegramMessageEvent(
      [message({ from: { id: BOT_ID, is_bot: true, first_name: "Bot" } })],
      6,
      PARAMS,
    );
    expect(own?.event.isOwnMessage).toBe(true);
  });

  it("reports a DM as chatType direct and carries the topic id", () => {
    const dm = buildTelegramMessageEvent(
      [message({ chat: { id: 42, type: "private" } })],
      5,
      PARAMS,
    );
    expect(dm?.event.chatType).toBe("direct");
    expect(dm?.event.messageThreadId).toBeNull();
    const topic = buildTelegramMessageEvent([message({ message_thread_id: 2 })], 5, PARAMS);
    expect(topic?.event.messageThreadId).toBe("2");
  });

  it("classifies a command message as kind command", () => {
    const build = buildTelegramMessageEvent(
      [
        message({
          text: "/new",
          entities: [{ type: "bot_command", offset: 0, length: 4 }],
        }),
      ],
      5,
      PARAMS,
    );
    expect(build?.kind).toBe("command");
    expect(build?.event.wasMentioned).toBe(true);
  });

  it("folds reply, quote and forward context into the body", () => {
    const build = buildTelegramMessageEvent(
      [
        message({
          text: "answer",
          reply_to_message: {
            message_id: 9,
            chat: { id: -100_1, type: "supergroup" },
            from: { id: 7, is_bot: false, first_name: "Asker", username: "asker" },
            text: "the question",
          },
          quote: { text: "the question", position: 0 },
          forward_origin: {
            type: "user",
            date: 1_699_000_000,
            sender_user: { id: 8, is_bot: false, first_name: "Origin" },
          },
        }),
      ],
      5,
      PARAMS,
    );
    const body = build?.event.body ?? "";
    expect(body).toContain(TELEGRAM_BODY_LABELS.replyTo);
    expect(body).toContain("the question");
    expect(body).toContain(TELEGRAM_BODY_LABELS.quote);
    expect(body).toContain(TELEGRAM_BODY_LABELS.forwarded);
    expect(body.endsWith("answer")).toBe(true);
  });

  it("uses the caption as the body and appends a location line", () => {
    const build = buildTelegramMessageEvent(
      [
        message({
          text: undefined,
          caption: "look at this",
          photo: [{ file_id: "p1", file_unique_id: "u1", width: 1, height: 1 }],
          location: { latitude: 1.5, longitude: 2.5 },
        }),
      ],
      5,
      PARAMS,
    );
    expect(build?.event.body.startsWith("look at this")).toBe(true);
    expect(build?.event.body).toContain("1.5");
  });

  it("collapses a media group into one event carrying every message", () => {
    const first = message({
      message_id: 10,
      media_group_id: "mg-1",
      text: undefined,
      caption: "album",
      photo: [{ file_id: "p1", file_unique_id: "u1", width: 1, height: 1 }],
    });
    const second = message({
      message_id: 11,
      media_group_id: "mg-1",
      text: undefined,
      photo: [{ file_id: "p2", file_unique_id: "u2", width: 1, height: 1 }],
    });
    const build = buildTelegramMessageEvent([first, second], 6, PARAMS);
    expect(build?.event.externalMessageId).toBe("10");
    expect(build?.event.body).toBe("album");
    expect(build?.messages).toHaveLength(2);
  });

  it("marks an edited message", () => {
    const build = buildTelegramInboundEvent(
      update({ edited_message: message({ text: "fixed" }) }, 8),
      PARAMS,
    );
    expect(build?.kind).toBe("edited_message");
    expect(build?.event.body).toBe(`${TELEGRAM_BODY_LABELS.edited} fixed`);
  });
});

describe("channel posts", () => {
  it("admits a channel post authored by the channel itself", () => {
    // A channel post carries no `from`: Telegram attributes it to the posting
    // chat. Reading only `from` dropped the whole family at the door.
    const post = {
      message_id: 77,
      date: 1_700_000_000,
      chat: { id: -100_9, type: "channel", title: "Announce" },
      sender_chat: { id: -100_9, type: "channel", title: "Announce", username: "announce" },
      text: "ship it",
    } as unknown as Message;
    const build = buildTelegramInboundEvent(update({ channel_post: post }, 12), PARAMS);

    expect(build?.kind).toBe("message");
    expect(build?.event).toMatchObject({
      externalEventId: "update:12",
      externalMessageId: "77",
      externalConversationId: "-1009",
      chatType: "group",
      senderId: "-1009",
      senderName: "Announce",
      senderUsername: "announce",
      body: "ship it",
      isOwnMessage: false,
    });
  });

  it("still refuses a post with neither a user nor a sender chat", () => {
    const post = {
      message_id: 78,
      date: 1_700_000_000,
      chat: { id: -100_9, type: "channel" },
      text: "orphan",
    } as unknown as Message;
    expect(buildTelegramInboundEvent(update({ channel_post: post }, 13), PARAMS)).toBeNull();
  });
});

describe("non-message updates", () => {
  it("builds a reaction event", () => {
    const build = buildTelegramInboundEvent(
      update(
        {
          message_reaction: {
            chat: { id: -100_1, type: "supergroup", title: "Test Group" },
            message_id: 10,
            user: { id: 42, is_bot: false, first_name: "Human" },
            date: 1_700_000_100,
            old_reaction: [],
            new_reaction: [{ type: "emoji", emoji: "👍" }],
          },
        },
        9,
      ),
      PARAMS,
    );
    expect(build?.kind).toBe("message_reaction");
    expect(build?.event.externalMessageId).toBe("10");
    expect(build?.event.body).toContain("👍");
    expect(build?.event.wasMentioned).toBe(false);
  });

  it("builds a poll-answer event keyed on the poll id", () => {
    const build = buildTelegramInboundEvent(
      update(
        {
          poll_answer: {
            poll_id: "poll-7",
            user: { id: 42, is_bot: false, first_name: "Human" },
            option_ids: [0, 2],
          },
        },
        10,
      ),
      PARAMS,
    );
    expect(build?.kind).toBe("poll_answer");
    expect(build?.event.externalMessageId).toBe("poll:poll-7");
    expect(build?.event.body).toContain("[0, 2]");
  });

  it("builds join and leave events from the service message", () => {
    const joined = buildTelegramInboundEvent(
      update(
        {
          message: message({
            text: undefined,
            new_chat_members: [{ id: 77, is_bot: false, first_name: "Newcomer" }],
          }),
        },
        11,
      ),
      PARAMS,
    );
    expect(joined?.kind).toBe("chat_member");
    expect(joined?.event.body).toBe(`${TELEGRAM_BODY_LABELS.joined} Newcomer`);
    const left = buildTelegramInboundEvent(
      update(
        {
          message: message({
            text: undefined,
            left_chat_member: { id: 77, is_bot: false, first_name: "Newcomer" },
          }),
        },
        12,
      ),
      PARAMS,
    );
    expect(left?.event.body).toBe(`${TELEGRAM_BODY_LABELS.left} Newcomer`);
  });

  it("builds a topic event from a forum service message", () => {
    const build = buildTelegramInboundEvent(
      update(
        {
          message: message({
            text: undefined,
            message_thread_id: 4,
            forum_topic_created: { name: "Deploys", icon_color: 1 },
          }),
        },
        13,
      ),
      PARAMS,
    );
    expect(build?.kind).toBe("topic_event");
    expect(build?.event.messageThreadId).toBe("4");
    expect(build?.event.body).toBe(`${TELEGRAM_BODY_LABELS.topic} created "Deploys"`);
  });

  it("builds a callback event only for a native-command callback", () => {
    const cq = {
      id: "cbq-1",
      from: { id: 42, is_bot: false, first_name: "Human" },
      chat_instance: "ci",
      message: {
        message_id: 90,
        date: 1,
        chat: { id: -100_1, type: "supergroup", title: "Test Group" },
      },
    };
    const opaque = buildTelegramInboundEvent(
      update({ callback_query: { ...cq, data: "hub-card:allow:1" } }, 14),
      PARAMS,
    );
    expect(opaque).toBeNull();
    const native = buildTelegramInboundEvent(
      update({ callback_query: { ...cq, data: "tgcmd:/model gpt-5" } }, 15),
      PARAMS,
    );
    expect(native?.kind).toBe("callback_query");
    expect(native?.event.senderId).toBe("42");
    expect(native?.event.externalMessageId).toBe("90");
    expect(native?.event.wasMentioned).toBe(true);
    expect(native?.event.body).toContain("/model gpt-5");
  });
});

// --- Slice 23a: the shared inbound family + structured facts ----------------

describe("inbound kinds", () => {
  it("marks plain text as a message with no facts", () => {
    const build = buildTelegramInboundEvent(update({ message: message() }), PARAMS);
    expect(build?.event.kind).toBe("message");
    expect(build?.event.facts).toBeUndefined();
  });

  it("marks a leading slash line as a command and names the verb and args", () => {
    const build = buildTelegramInboundEvent(
      update({ message: message({ text: "/status now please" }) }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("command");
    expect(build?.event.facts?.command).toEqual({ name: "status", args: "now please" });
  });

  it("strips the @bot suffix off the command verb", () => {
    const build = buildTelegramInboundEvent(
      update({ message: message({ text: "/stop@longluong3bot" }) }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("command");
    expect(build?.event.facts?.command).toEqual({ name: "stop", args: "" });
  });

  it("marks an edited message as an edit naming the message it replaced", () => {
    const build = buildTelegramInboundEvent(
      update({ edited_message: message({ text: "fixed" }) }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("edit");
    expect(build?.event.facts?.target).toEqual({ messageId: "10" });
  });

  it("marks a reaction, and reads a cleared list as a removal", () => {
    const added = buildTelegramInboundEvent(
      update({
        message_reaction: {
          chat: { id: -100_1, type: "supergroup" },
          message_id: 77,
          user: { id: 42, is_bot: false, first_name: "Human" },
          date: 1_700_000_000,
          old_reaction: [],
          new_reaction: [{ type: "emoji", emoji: "👍" }],
        },
      }),
      PARAMS,
    );
    expect(added?.event.kind).toBe("reaction");
    expect(added?.event.facts?.reaction).toEqual({
      emoji: "👍",
      added: true,
      messageId: "77",
      actorId: "42",
    });
    const cleared = buildTelegramInboundEvent(
      update({
        message_reaction: {
          chat: { id: -100_1, type: "supergroup" },
          message_id: 77,
          user: { id: 42, is_bot: false, first_name: "Human" },
          date: 1_700_000_000,
          old_reaction: [{ type: "emoji", emoji: "👍" }],
          new_reaction: [],
        },
      }),
      PARAMS,
    );
    expect(cleared?.event.facts?.reaction?.added).toBe(false);
  });

  it("marks a poll answer with the poll, the options and the voter", () => {
    const build = buildTelegramInboundEvent(
      update({
        poll_answer: {
          poll_id: "poll-1",
          option_ids: [0, 2],
          user: { id: 42, is_bot: false, first_name: "Human" },
        },
      }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("poll_answer");
    expect(build?.event.facts?.pollAnswer).toEqual({
      pollId: "poll-1",
      optionIds: [0, 2],
      voterId: "42",
    });
  });

  it("marks a membership update with the user and the direction", () => {
    const joined = buildTelegramInboundEvent(
      update({
        chat_member: {
          chat: { id: -100_1, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Human" },
          date: 1_700_000_000,
          old_chat_member: { status: "left", user: { id: 7, is_bot: false, first_name: "New" } },
          new_chat_member: { status: "member", user: { id: 7, is_bot: false, first_name: "New" } },
        },
      }),
      PARAMS,
    );
    expect(joined?.event.kind).toBe("member");
    expect(joined?.event.facts?.member).toEqual({ userId: "7", joined: true });
  });

  it("marks a join service message as a member event", () => {
    const build = buildTelegramInboundEvent(
      update({
        message: message({
          text: undefined,
          new_chat_members: [{ id: 7, is_bot: false, first_name: "New" }],
        }),
      }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("member");
    expect(build?.event.facts?.member).toEqual({ userId: "7", joined: true });
  });

  it("marks a native-command button press as a callback with its authority facts", () => {
    const build = buildTelegramInboundEvent(
      update({
        callback_query: {
          id: "cb-1",
          from: { id: 42, is_bot: false, first_name: "Human" },
          chat_instance: "ci",
          data: "tgcmd:/status",
          message: {
            message_id: 55,
            date: 1_700_000_000,
            chat: { id: -100_1, type: "supergroup", title: "Test Group" },
          },
        },
      }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("callback");
    expect(build?.event.facts?.callback).toEqual({
      actionId: "/status",
      actorId: "42",
      messageId: "55",
    });
  });

  it("marks a forum topic service message as a topic event", () => {
    const build = buildTelegramInboundEvent(
      update({
        message: message({
          text: undefined,
          message_thread_id: 31,
          forum_topic_created: { name: "deploys", icon_color: 1 },
        }),
      }),
      PARAMS,
    );
    expect(build?.event.kind).toBe("topic");
    expect(build?.event.facts?.topic).toEqual({
      threadId: "31",
      name: "deploys",
      event: 'created "deploys"',
    });
  });
});
