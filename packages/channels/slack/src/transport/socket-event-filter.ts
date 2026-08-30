// L2 event filter (blueprint §6.5): the pure, transport-agnostic facts the
// Slack Socket Mode handler needs to turn a raw `message` / `app_mention`
// payload into a normalized `ChannelInboundEvent`. Sync reference:
// @openclaw/slack@2026.7.1 dist/provider-C1-DFSpw.js
// [extensions/slack/src/monitor/channel-type.ts,
//  extensions/slack/src/monitor/events/messages.ts].
//
// Split out of socket-mode.ts so the socket loop stays small and these facts
// are unit-testable without a live socket. No OpenClaw imports.

import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { decodeSlackEntities } from "../mrkdwn.js";

/** The identity facts L4 probes from `auth.test` (client/web-api.ts): the
 * bot user id + app/team ids this account's tokens belong to. */
export interface SlackTransportIdentity {
  botUserId?: string;
  botId?: string;
  teamId?: string;
  apiAppId?: string;
}

/** The Slack `message` event payload (the shape Socket Mode delivers; a
 * structural subset of @slack/types' `Message` — the vertical never imports
 * OpenClaw types). */
export interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  channel?: string;
  channel_type?: string;
  thread_ts?: string;
  event_ts?: string;
  [key: string]: unknown;
}

/** The `app_mention` event payload. */
export interface SlackAppMentionEvent extends SlackMessageEvent {
  channel_id?: string;
  [key: string]: unknown;
}

/** The envelope Socket Mode emits for each events_api message. */
export interface SocketEventEnvelope {
  ack: (response?: unknown) => Promise<void>;
  envelope_id: string;
  body: Record<string, unknown>;
  event?: Record<string, unknown>;
  retry_num?: number;
  retry_reason?: string;
  accepts_response_payload?: boolean;
}

/** The two inbound event sources the transport admits. */
export type SlackInboundSource = "message" | "app_mention";

/** Resolve a Slack channel id's native type from its id prefix when the event
 * payload omits `channel_type` (pinned `inferSlackChannelType`): D… → im,
 * C… → channel, G… → group. */
export function inferSlackChannelType(
  channelId: string | undefined,
): "im" | "channel" | "group" | undefined {
  const trimmed = channelId?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("D")) return "im";
  if (trimmed.startsWith("C")) return "channel";
  if (trimmed.startsWith("G")) return "group";
  return undefined;
}

/** Normalize the `channel_type` fact, falling back to the id-prefix inference
 * (pinned `normalizeSlackChannelType`). */
export function normalizeSlackChannelType(
  channelType: string | undefined,
  channelId: string | undefined,
): "im" | "mpim" | "channel" | "group" {
  const normalized = channelType?.trim().toLowerCase();
  const inferred = inferSlackChannelType(channelId);
  if (
    normalized === "im" ||
    normalized === "mpim" ||
    normalized === "channel" ||
    normalized === "group"
  ) {
    if (inferred === "im" && normalized !== "im") return "im";
    return normalized;
  }
  return inferred ?? "channel";
}

/** Native conversation kind (pinned `resolveSlackChatType`,
 * docs/audits/pinned-vertical-contracts/inbound.md): im → direct,
 * mpim → group, else channel. Threads are NOT a kind — a threaded message
 * keeps `channel` and carries its thread ts. */
export function resolveSlackChatType(channelType: "im" | "mpim" | "channel" | "group"): string {
  if (channelType === "im") return "direct";
  if (channelType === "mpim") return "group";
  return "channel";
}

/** Slack ts ("1700000000.000200") → milliseconds (pinned
 * `resolveSlackTimestampMs`). */
const SLACK_TIMESTAMP_RE = /^\d+\.\d+$/;

export function resolveSlackTimestampMs(ts: string | undefined): number | undefined {
  const trimmed = ts?.trim();
  if (!trimmed || !SLACK_TIMESTAMP_RE.test(trimmed)) return undefined;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER / 1000) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}

/** The `<@U…>` / `<@W…>` mention forms (pinned strip pattern
 * `["<@[^>\\s]+>"]` on the plugin's `mentions.stripPatterns`). */
export const SLACK_USER_MENTION_RE = /<@[A-Z0-9]+>/gi;

/** True when the message was authored by this account's own bot — either the
 * sender user id or the message bot_id matches the identity. Own messages are
 * flagged (and dropped by the L3) so the bot never answers itself. */
export function isSlackOwnMessage(
  event: SlackMessageEvent,
  identity: SlackTransportIdentity,
  botId?: string,
): boolean {
  const botUserId = identity.botUserId?.trim() === "" ? undefined : identity.botUserId;
  if (botUserId !== undefined && event.user === botUserId) return true;
  const effectiveBotId = botId?.trim() === "" ? undefined : (botId ?? identity.botId);
  return (
    effectiveBotId !== undefined && event.bot_id !== undefined && event.bot_id === effectiveBotId
  );
}

/** Mention fact: the `app_mention` source always counts; on a `message` event
 * the pinned fact is an explicit `<@botUserId>` in the text. Subteam mentions
 * + implicit thread mentions are OpenClaw activation-policy inputs (group E)
 * and stay out. */
export function resolveSlackWasMentioned(
  event: SlackMessageEvent,
  source: SlackInboundSource,
  identity: SlackTransportIdentity,
): boolean {
  if (source === "app_mention") return true;
  const botUserId = identity.botUserId?.trim() === "" ? undefined : identity.botUserId;
  if (botUserId === undefined) return false;
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<@${escaped}>`, "i").test(event.text ?? "");
}

/** One normalized inbound event from a raw `message` / `app_mention` payload,
 * or undefined when the payload lacks the ids the L3 needs. */
export function buildSlackInboundEvent(
  event: SlackMessageEvent,
  source: SlackInboundSource,
  identity: SlackTransportIdentity,
  botId?: string,
): ChannelInboundEvent | undefined {
  const channelId =
    typeof event.channel === "string" && event.channel !== "" ? event.channel : undefined;
  const ts = typeof event.ts === "string" && event.ts !== "" ? event.ts : undefined;
  if (channelId === undefined || ts === undefined) return undefined;
  const channelType = normalizeSlackChannelType(
    typeof event.channel_type === "string" ? event.channel_type : undefined,
    channelId,
  );
  const senderId = typeof event.user === "string" && event.user !== "" ? event.user : "";
  // Slack's API delivers `text` with its own entity escaping (`=&gt;`,
  // `&lt;@U…&gt;` outside link tokens). Decode at the boundary so the agent
  // reads what the user typed; the outbound render re-escapes idempotently.
  const text = decodeSlackEntities(event.text ?? "");
  const timestampMs =
    resolveSlackTimestampMs(typeof event.event_ts === "string" ? event.event_ts : undefined) ??
    resolveSlackTimestampMs(ts) ??
    0;
  const threadTs =
    typeof event.thread_ts === "string" && event.thread_ts !== "" ? event.thread_ts : undefined;
  return {
    channel: "slack",
    // externalEventId (transport-level in-flight dedupe key) and
    // externalMessageId (durable ledger dedupe key) are both the message ts:
    // a plain `message` event carries no separate event_id, so the ts stands
    // in for both.
    externalEventId: ts,
    externalMessageId: ts,
    externalConversationId: channelId,
    chatType: resolveSlackChatType(channelType),
    ...(threadTs !== undefined ? { messageThreadId: threadTs } : { messageThreadId: null }),
    senderId,
    body: text,
    wasMentioned: resolveSlackWasMentioned(event, source, identity),
    timestampMs,
    ...(isSlackOwnMessage(event, identity, botId) ? { isOwnMessage: true } : {}),
  };
}

/** The Socket Mode `slash_commands` envelope body (an app-registered native
 * slash command; NOT an events_api message — the command arrives flat). */
export interface SlackSlashCommandBody {
  command?: string;
  text?: string;
  user_id?: string;
  channel_id?: string;
  trigger_id?: string;
  [key: string]: unknown;
}

/**
 * Rewrite a native `slash_commands` body into the plain-text inbound command
 * the shared parser (hub `commands.ts`) already understands, so a team that
 * registered a native command gets the SAME commands with zero extra wiring.
 * The registered command is a single alias whose FIRST WORD picks the
 * sub-command (`/paseo approve`, `/paseo status`); the body's `text` is the
 * remainder. A bare `/paseo` (empty text) becomes `help`.
 *
 * Returns undefined when the body is not a command we can mint (no channel,
 * no user, or a command name the vertical was not told to accept — the
 * caller passes `acceptedCommand` from the account's `transport.slashCommand`
 * config; absent config = native ingestion off, the text spellings still
 * work). The synthetic event carries the invoker as a `<@USERID>` mention so
 * the decided-state path and trigger policy see the real person; Slack does
 * NOT deliver the slash text as a message, so no dedupe collision with the
 * `message` path is possible.
 */
export function buildSlackSlashCommandEvent(
  body: SlackSlashCommandBody,
  acceptedCommand: string | undefined,
): ChannelInboundEvent | undefined {
  if (acceptedCommand === undefined) return undefined;
  const command = (body.command ?? "").trim();
  const alias = acceptedCommand.trim();
  if (alias === "" || command === "" || command.toLowerCase() !== alias.toLowerCase()) {
    return undefined;
  }
  const channelId = typeof body.channel_id === "string" ? body.channel_id.trim() : "";
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (channelId === "" || userId === "") return undefined;
  const args = (body.text ?? "").trim();
  const text = args === "" ? "help" : args;
  const nowMs = Date.now();
  return {
    channel: "slack",
    // Slash commands carry no message ts; the trigger_id is unique per
    // invocation, so it is the honest dedupe key.
    externalEventId:
      typeof body.trigger_id === "string" && body.trigger_id !== ""
        ? body.trigger_id
        : `slash:${nowMs}:${userId}`,
    externalMessageId:
      typeof body.trigger_id === "string" && body.trigger_id !== ""
        ? body.trigger_id
        : `slash:${nowMs}:${userId}`,
    externalConversationId: channelId,
    chatType: resolveSlackChatType(normalizeSlackChannelType(undefined, channelId)),
    messageThreadId: null,
    senderId: userId,
    body: `<@${userId}> ${text}`,
    wasMentioned: true,
    timestampMs: nowMs,
  };
}

/** The app/team mismatch guard (pinned `shouldDropMismatchedSlackEvent`):
 * events from a different app or team than the one this account's tokens
 * belong to are dropped. Returns the drop reason, or null to keep. */
export function shouldDropMismatchedSlackEvent(
  body: Record<string, unknown>,
  identity: SlackTransportIdentity,
): "api-app-id" | "team-id" | null {
  const expectedApiAppId = identity.apiAppId?.trim() === "" ? undefined : identity.apiAppId;
  const expectedTeamId = identity.teamId?.trim() === "" ? undefined : identity.teamId;
  const incomingApiAppId = typeof body["api_app_id"] === "string" ? body["api_app_id"] : "";
  if (
    expectedApiAppId !== undefined &&
    incomingApiAppId !== "" &&
    incomingApiAppId !== expectedApiAppId
  ) {
    return "api-app-id";
  }
  const rawTeamId = typeof body["team_id"] === "string" ? body["team_id"] : undefined;
  const teamObj = body["team"];
  let teamIdFromObj: string | undefined;
  if (teamObj !== null && typeof teamObj === "object" && "id" in teamObj) {
    const teamId = (teamObj as { id?: unknown }).id;
    teamIdFromObj = typeof teamId === "string" ? teamId : undefined;
  }
  const incomingTeamId = rawTeamId ?? teamIdFromObj ?? "";
  if (expectedTeamId !== undefined && incomingTeamId !== "" && incomingTeamId !== expectedTeamId) {
    return "team-id";
  }
  return null;
}
