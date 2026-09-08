// The inbound-family routing policy: what the plane is allowed to DO with one
// admitted channel event, decided from the event's family rather than its text.
//
// Both verticals admit every inbound family a platform delivers — reactions,
// joins, pins, edits, deletes, topic and poll events, button callbacks — as a
// `ChannelInboundEvent`. Before this module the only routing facts were `body`
// and `wasMentioned`, so an always-reply conversation forwarded
// "Slack reaction added: :+1: …" or "[Joined] Ann" to the agent as if a person
// had typed it. Upstream separates the two with
// `classifyChannelInboundEvent` (`src/channels/inbound-event/classification.ts`):
// actionable user requests wake the agent, room activity does not. This is that
// separation, expressed over the shared `kind` the verticals now set.
//
// The table is code, not config: which families may start a turn is an
// architectural fact about the product, not an operator preference. The two
// leaves operators DO get (`defaults.inbound.*`) only choose whether a room
// event is recorded, and whether an edit is re-run as a message.

import type { ChannelInboundFacts, ChannelInboundKind } from "@getpaseo/channels-shared";
import type { EffectiveDefaults } from "../config/compile.js";
import { ORG_DEFAULTS } from "../config/schema.js";

/** The org floor, for an event whose conversation matches no route: it still
 * has a family and a disposition, it just has no authored knobs. */
export const INBOUND_DEFAULTS_FLOOR: EffectiveDefaults["inbound"] = ORG_DEFAULTS.inbound;

/** What the plane does with one inbound event. */
export type InboundDisposition =
  /** Run the normal message path: route match, binding, agent turn. */
  | "message"
  /** Interpret it as a session command (`/status`, `/stop`, `/new`, `/help`). */
  | "command"
  /** Answer an approval card, or run the command the button encodes. */
  | "callback"
  /** Room activity: never starts a turn. Recorded in channel activity. */
  | "record";

/**
 * The family → disposition table. Every family a vertical can emit has a row;
 * adding a family to `ChannelInboundKind` without a row is a type error, which
 * is the point — a new inbound family must state whether it may wake an agent.
 */
const DISPOSITION: Record<ChannelInboundKind, InboundDisposition> = {
  message: "message",
  command: "command",
  callback: "callback",
  interactive: "callback",
  // An edit is room activity by default; `inbound.editNotifications: all`
  // promotes it to a message (`dispositionFor` applies that override).
  edit: "record",
  delete: "record",
  reaction: "record",
  member: "record",
  channel: "record",
  pin: "record",
  topic: "record",
  poll_answer: "record",
};

/** The families whose recording an operator can switch off. Everything else is
 * always recorded: a join or a delete is the audit trail of the conversation. */
function isRecorded(kind: ChannelInboundKind, inbound: EffectiveDefaults["inbound"]): boolean {
  if (kind === "reaction") return inbound.reactionNotifications !== "off";
  return true;
}

/** The event's family and its structured facts, read off the flat ctxPayload
 * the shared monitor builds. An event from a vertical that predates `kind` has
 * neither key and reads as a plain `message` with no facts. */
export interface InboundKindReading {
  kind: ChannelInboundKind;
  facts: ChannelInboundFacts;
}

const KINDS = new Set<string>(Object.keys(DISPOSITION));

export function readInboundKind(ctxPayload: Record<string, unknown>): InboundKindReading {
  const raw = ctxPayload["EventKind"];
  const kind = typeof raw === "string" && KINDS.has(raw) ? (raw as ChannelInboundKind) : "message";
  const facts = ctxPayload["EventFacts"];
  return {
    kind,
    facts:
      typeof facts === "object" && facts !== null && !Array.isArray(facts)
        ? (facts as ChannelInboundFacts)
        : {},
  };
}

/**
 * The disposition for one event under one route's effective defaults. The route
 * is resolved for `record` events too, so the activity row can be attributed;
 * pass `undefined` when no route owns the conversation (the floor applies).
 */
export function dispositionFor(
  kind: ChannelInboundKind,
  inbound: EffectiveDefaults["inbound"],
): InboundDisposition {
  if (kind === "edit" && inbound.editNotifications === "all") return "message";
  return DISPOSITION[kind];
}

/** Whether a `record` disposition writes an activity row, or drops silently. */
export function recordsActivity(
  kind: ChannelInboundKind,
  inbound: EffectiveDefaults["inbound"],
): boolean {
  return isRecorded(kind, inbound);
}

/** The ignore reason a recorded room event carries into channel activity and
 * the plane's outcome — one wording, so an operator reading the ledger sees the
 * family that was dropped, not a generic "not admitted". */
export function roomEventReason(kind: ChannelInboundKind): string {
  return `channel ${kind} event does not start an agent turn`;
}
