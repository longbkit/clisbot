// Slice 23a: the shared inbound family (`kind`) and structured facts each
// Slack builder sets. The Hub routes on these, so a reaction or a join can
// never reach an always-reply agent as user text.

import { describe, expect, it } from "vitest";
import {
  buildSlackInboundEvent,
  buildSlackSlashCommandEvent,
} from "../../transport/socket-event-filter.js";
import {
  buildSlackChannelFacts,
  buildSlackMemberFacts,
  buildSlackMessageSubtypeFacts,
  buildSlackPinFacts,
  buildSlackReactionFacts,
  buildSlackSystemInboundEvent,
} from "./system-events.js";
import {
  buildSlackInteractiveInboundEvent,
  parseSlackInteractiveCallback,
} from "./interactions.js";

const IDENTITY = { botUserId: "U0BOT", botId: "B0BOT" };

describe("message and slash builders", () => {
  it("marks a plain message as a message", () => {
    const event = buildSlackInboundEvent(
      { type: "message", channel: "C0APP", ts: "1.1", user: "U0ALICE", text: "hello" },
      "message",
      IDENTITY,
    );
    expect(event?.kind).toBe("message");
    expect(event?.facts).toBeUndefined();
  });

  it("marks a native slash command and names the sub-command verb", () => {
    const event = buildSlackSlashCommandEvent(
      {
        command: "/paseo",
        text: "status now",
        user_id: "U0ALICE",
        channel_id: "C0APP",
        trigger_id: "t1",
      },
      "/paseo",
    );
    expect(event?.kind).toBe("command");
    expect(event?.facts?.command).toEqual({ name: "status", args: "now" });
  });

  it("reads a bare registered command as help", () => {
    const event = buildSlackSlashCommandEvent(
      { command: "/paseo", text: "", user_id: "U0ALICE", channel_id: "C0APP", trigger_id: "t2" },
      "/paseo",
    );
    expect(event?.facts?.command).toEqual({ name: "help", args: "" });
  });
});

describe("system-event builders", () => {
  it("marks a reaction with its emoji, direction, target and actor", () => {
    const facts = buildSlackReactionFacts({
      event: {
        user: "U0ALICE",
        reaction: "+1",
        item: { type: "message", channel: "C0APP", ts: "1.1" },
      },
      action: "added",
      eventId: "Ev1",
    });
    expect(facts?.facts?.reaction).toEqual({
      emoji: "+1",
      added: true,
      messageId: "1.1",
      actorId: "U0ALICE",
    });
    const event = buildSlackSystemInboundEvent(facts!, { eventId: "Ev1" });
    expect(event.kind).toBe("reaction");
    expect(event.wasMentioned).toBe(false);
  });

  it("marks a member join and a member leave", () => {
    const joined = buildSlackMemberFacts({
      event: { channel: "C0APP", user: "U0ALICE" },
      verb: "joined",
      eventId: "Ev2",
    });
    expect(joined?.facts?.member).toEqual({ userId: "U0ALICE", joined: true });
    expect(buildSlackSystemInboundEvent(joined!, { eventId: "Ev2" }).kind).toBe("member");
    const left = buildSlackMemberFacts({
      event: { channel: "C0APP", user: "U0ALICE" },
      verb: "left",
      eventId: "Ev3",
    });
    expect(left?.facts?.member).toEqual({ userId: "U0ALICE", joined: false });
  });

  it("marks a channel lifecycle event", () => {
    const facts = buildSlackChannelFacts({
      event: { channel: { id: "C0NEW", name: "deploys" } },
      kind: "created",
      eventId: "Ev4",
    });
    expect(buildSlackSystemInboundEvent(facts!, { eventId: "Ev4" }).kind).toBe("channel");
  });

  it("marks a pin with the message it pinned", () => {
    const facts = buildSlackPinFacts({
      event: {
        channel_id: "C0APP",
        user: "U0ALICE",
        item: { type: "message", message: { ts: "1.1" } },
      },
      action: "pinned",
      contextKeySuffix: "added",
      eventId: "Ev5",
    });
    expect(facts?.facts?.target).toEqual({ messageId: "1.1" });
    expect(buildSlackSystemInboundEvent(facts!, { eventId: "Ev5" }).kind).toBe("pin");
  });

  it("marks an edit and a delete with the message they act on", () => {
    const edited = buildSlackMessageSubtypeFacts({
      event: {
        type: "message",
        subtype: "message_changed",
        channel: "C0APP",
        ts: "2.0",
        message: { ts: "1.1", user: "U0ALICE", text: "fixed" },
        previous_message: { ts: "1.1", user: "U0ALICE", text: "typo" },
      },
    });
    expect(edited?.facts?.target).toEqual({ messageId: "1.1" });
    expect(buildSlackSystemInboundEvent(edited!, { eventId: "Ev6" }).kind).toBe("edit");
    const deleted = buildSlackMessageSubtypeFacts({
      event: {
        type: "message",
        subtype: "message_deleted",
        channel: "C0APP",
        ts: "2.0",
        deleted_ts: "1.1",
        previous_message: { ts: "1.1", user: "U0ALICE", text: "gone" },
      },
    });
    expect(deleted?.facts?.target).toEqual({ messageId: "1.1" });
    expect(buildSlackSystemInboundEvent(deleted!, { eventId: "Ev7" }).kind).toBe("delete");
  });
});

describe("interactive builders", () => {
  it("marks a button click as a callback carrying its authority facts", () => {
    const callback = parseSlackInteractiveCallback({
      type: "block_actions",
      user: { id: "U0ALICE" },
      channel: { id: "C0APP" },
      message: { ts: "1.1" },
      actions: [{ action_id: "approval", value: "allow:card-1" }],
    });
    const event = buildSlackInteractiveInboundEvent(callback!, { eventId: "Ev8" });
    expect(event.kind).toBe("callback");
    expect(event.facts?.callback).toEqual({
      actionId: "approval",
      value: "allow:card-1",
      actorId: "U0ALICE",
      messageId: "1.1",
    });
  });

  it("marks a modal submit as interactive", () => {
    const callback = parseSlackInteractiveCallback({
      type: "view_submission",
      user: { id: "U0ALICE" },
      view: { callback_id: "settings", private_metadata: "C0APP" },
    });
    const event = buildSlackInteractiveInboundEvent(callback!, { eventId: "Ev9" });
    expect(event.kind).toBe("interactive");
    expect(event.facts?.callback?.actionId).toBe("settings");
  });
});
