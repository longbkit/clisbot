import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildSlackInboundEvent,
  withBotMentionNamed,
  withoutAddressingMention,
} from "./socket-event-filter.js";

const IDENTITY = { botUserId: "U0BOT" };

describe("withoutAddressingMention", () => {
  it("drops the bot's own leading mention, in the forms a client sends it", () => {
    assert.equal(withoutAddressingMention("<@U0BOT> 2+2", IDENTITY), "2+2");
    assert.equal(withoutAddressingMention("<@U0BOT>: <@U0BOT> /status", IDENTITY), "/status");
    assert.equal(withoutAddressingMention("  <@u0bot>, hi", IDENTITY), "hi");
  });

  it("keeps a mention that belongs to the sentence, and anyone else's", () => {
    assert.equal(withoutAddressingMention("ask <@U0BOT> later", IDENTITY), "ask <@U0BOT> later");
    assert.equal(withoutAddressingMention("<@U0ALICE> look", IDENTITY), "<@U0ALICE> look");
  });

  it("keeps a message that is nothing but the mention", () => {
    assert.equal(withoutAddressingMention("<@U0BOT>", IDENTITY), "<@U0BOT>");
  });
});

describe("buildSlackInboundEvent", () => {
  it("states the mention as a fact and leaves it out of the body the agent reads", () => {
    const event = buildSlackInboundEvent(
      { type: "message", channel: "C0ROOM", ts: "1.2", user: "U0ALICE", text: "<@U0BOT> 2+2" },
      "message",
      IDENTITY,
    );
    assert.equal(event?.body, "2+2");
    assert.equal(event?.wasMentioned, true);
  });
});

describe("withBotMentionNamed", () => {
  const NAMED = { botUserId: "U0BOT", botName: "clisbot" };

  it("renders the bot's mentions left in the body as its name", () => {
    assert.equal(withBotMentionNamed("ask <@U0BOT> or <@u0bot>", NAMED), "ask @clisbot or @clisbot");
    assert.equal(withBotMentionNamed("<@U0ALICE> look", NAMED), "<@U0ALICE> look");
    assert.equal(withBotMentionNamed("ask <@U0BOT>", IDENTITY), "ask <@U0BOT>");
  });

  it("names the bot inside the body the agent reads, after the addressing mention goes", () => {
    const event = buildSlackInboundEvent(
      {
        type: "message",
        channel: "C0ROOM",
        ts: "1.2",
        user: "U0ALICE",
        text: "<@U0BOT> tell <@U0BOT> hi",
      },
      "message",
      NAMED,
    );
    assert.equal(event?.body, "tell @clisbot hi");
  });
});
