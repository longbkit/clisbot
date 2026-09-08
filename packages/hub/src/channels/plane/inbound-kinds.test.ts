// The inbound-family routing table (slice 23a). These are the pure decisions —
// which family may wake an agent, which is room activity, and what the two
// operator knobs move. The production-path proof (a reaction that never reaches
// an always-reply agent, `/new`, `/stop`, a card click) lives in
// `execution/execution.test.ts`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { EffectiveDefaults } from "../config/compile.js";
import {
  dispositionFor,
  INBOUND_DEFAULTS_FLOOR,
  readInboundKind,
  recordsActivity,
  roomEventReason,
} from "./inbound-kinds.js";

const FLOOR: EffectiveDefaults["inbound"] = INBOUND_DEFAULTS_FLOOR;

describe("readInboundKind", () => {
  it("reads a vertical that predates the contract as a plain message", () => {
    const reading = readInboundKind({ Body: "hello" });
    assert.equal(reading.kind, "message");
    assert.deepEqual(reading.facts, {});
  });

  it("reads the kind and the structured facts off the ctxPayload", () => {
    const reading = readInboundKind({
      EventKind: "reaction",
      EventFacts: { reaction: { emoji: "+1", added: true, messageId: "1.2", actorId: "U0" } },
    });
    assert.equal(reading.kind, "reaction");
    assert.deepEqual(reading.facts.reaction, {
      emoji: "+1",
      added: true,
      messageId: "1.2",
      actorId: "U0",
    });
  });

  it("falls back to message for a kind this Hub does not know", () => {
    assert.equal(readInboundKind({ EventKind: "presence" }).kind, "message");
    assert.equal(readInboundKind({ EventKind: 7 }).kind, "message");
  });

  it("ignores facts that are not an object", () => {
    assert.deepEqual(readInboundKind({ EventKind: "member", EventFacts: ["x"] }).facts, {});
  });
});

describe("dispositionFor", () => {
  it("keeps requests on the agent path and room activity off it", () => {
    assert.equal(dispositionFor("message", FLOOR), "message");
    assert.equal(dispositionFor("command", FLOOR), "command");
    assert.equal(dispositionFor("callback", FLOOR), "callback");
    assert.equal(dispositionFor("interactive", FLOOR), "callback");
    for (const kind of [
      "edit",
      "delete",
      "reaction",
      "member",
      "channel",
      "pin",
      "topic",
      "poll_answer",
    ] as const) {
      assert.equal(dispositionFor(kind, FLOOR), "record", kind);
    }
  });

  it("promotes an edit to a message only when the route asked for it", () => {
    assert.equal(dispositionFor("edit", { ...FLOOR, editNotifications: "all" }), "message");
    // The knob speaks about edits alone; a delete stays room activity.
    assert.equal(dispositionFor("delete", { ...FLOOR, editNotifications: "all" }), "record");
  });
});

describe("recordsActivity", () => {
  it("drops reactions at the floor and records them once notifications are on", () => {
    assert.equal(recordsActivity("reaction", FLOOR), false);
    assert.equal(recordsActivity("reaction", { ...FLOOR, reactionNotifications: "own" }), true);
    assert.equal(recordsActivity("reaction", { ...FLOOR, reactionNotifications: "all" }), true);
  });

  it("always records the families that are the conversation's audit trail", () => {
    for (const kind of ["delete", "member", "channel", "pin", "topic", "poll_answer"] as const) {
      assert.equal(recordsActivity(kind, FLOOR), true, kind);
    }
  });
});

describe("roomEventReason", () => {
  it("names the family that was dropped", () => {
    assert.equal(roomEventReason("member"), "channel member event does not start an agent turn");
  });
});
