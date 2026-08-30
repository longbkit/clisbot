// L2 — the approval card's button-click envelope (COMPAT(clisbot-control-plane)):
// the Socket Mode `block_actions` payload (docs.slack.dev
// /reference/interaction-payloads/block_actions-payload) narrowed to the
// control plane's approval card. The vertical parses the CHANNEL envelope
// only (who clicked, where the card sits); the card VALUE stays opaque and
// is parsed once in the hub (its card-value scheme owns the format).
//
// Wire facts (verified against @slack/socket-mode's envelope dispatch + the
// Slack `block_actions` payload reference): the Socket Mode ENVELOPE type of
// a click is `"interactive"` (`block_actions` is the PAYLOAD's type — the
// transport listens on the envelope type and filters on the payload type).
// The click's user, the clicked element (with its `value`), the clicked
// MESSAGE, and the CONVERSATION sit at the payload's top level — `user`,
// `actions[]`, `message`, `channel: {id, name}` — with no `callback_event`
// nesting (that shape belongs to the legacy `interactive_message` payload).
// The `message` object is the stored message and carries NO `channel` field
// (the live 2026-08-29 click proved it): the conversation id is the top-level
// `channel.id` (fallback `container.channel_id`), the card ts is
// `message.ts`, and a threaded card carries `message.thread_ts`.

import { inferSlackChannelType } from "./socket-event-filter.js";

/** One approval-card button click, parsed from the `block_actions` payload.
 * The hub's approval seam receives these facts verbatim (the card value
 * opaque, the identities pre-normalized to the plane's vocabulary). */
export interface ApprovalCardClick {
  /** The clicking user's native id (`U…` — no `slack:` prefix: the caller
   * applies the plane's `<channel>:<id>` identity). */
  senderId: string;
  /** The clicked element's opaque card value (hub card-value scheme). */
  cardValue: string;
  /** The ROOT conversation id (the clicked message's channel — a card in a
   * thread reports the root channel, the thread riding on `threadTs`). */
  rootChannelId: string;
  /** The card's thread ts when the card was posted in a thread; absent at
   * the root. */
  threadTs?: string | undefined;
  /** The card's own ts (the in-place-update target). */
  messageTs: string;
}

/** A string field off an open record, undefined when not a non-empty string. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Narrow a raw `block_actions` payload to the approval card's click. Null for
 * anything that is not a click on a posted message (a modal/home-tab
 * interaction carries no `message`; a click with no user or no element value
 * is unactionable). Does NOT check the element's `action_id`: the hub's
 * card-value parse + open-prompt lookup is the card-ownership test (a value
 * this card did not mint fails closed there).
 */
export function parseApprovalCardClick(body: Record<string, unknown>): ApprovalCardClick | null {
  if (body["type"] !== "block_actions") return null;
  const user = body["user"];
  if (typeof user !== "object" || user === null) return null;
  const senderId = readString(user as Record<string, unknown>, "id");
  if (senderId === undefined) return null;
  const actions = body["actions"];
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const [first] = actions;
  if (typeof first !== "object" || first === null) return null;
  const cardValue = readString(first as Record<string, unknown>, "value");
  if (cardValue === undefined) return null;
  const message = body["message"];
  if (typeof message !== "object" || message === null) return null;
  const messageRecord = message as Record<string, unknown>;
  // The conversation id lives at the payload's top level as a `channel`
  // OBJECT (`{id, name}`); `container.channel_id` is the same id as a
  // string and serves as the fallback.
  const topChannel = body["channel"];
  const rootChannelId =
    (typeof topChannel === "object" && topChannel !== null
      ? readString(topChannel as Record<string, unknown>, "id")
      : readString(body, "channel")) ??
    (typeof body["container"] === "object" && body["container"] !== null
      ? readString(body["container"] as Record<string, unknown>, "channel_id")
      : undefined);
  const messageTs = readString(messageRecord, "ts");
  if (rootChannelId === undefined || messageTs === undefined) return null;
  return {
    senderId,
    cardValue,
    rootChannelId,
    ...(readString(messageRecord, "thread_ts") !== undefined
      ? { threadTs: readString(messageRecord, "thread_ts") }
      : {}),
    messageTs,
  };
}

/**
 * The plane's root-conversation kind of a Slack channel id (the vertical's
 * normalization for the hub's approval seam, matching the inbound path's
 * native → plane table): `D…` DM → `dm`, `G…` group → `group`, anything else
 * (incl. unknown prefixes) → `channel`.
 */
export function approvalRootKind(channelId: string): "dm" | "channel" | "group" {
  const native = inferSlackChannelType(channelId);
  if (native === "im") return "dm";
  if (native === "group") return "group";
  return "channel";
}
