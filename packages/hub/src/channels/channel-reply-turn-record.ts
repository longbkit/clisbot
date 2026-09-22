// What the `message` tool delivered for an Agent's running turn. The capability
// registry keeps one record per capability; the relay takes the Agent's merged
// record when the turn ends: a `tool`-path turn that answered nothing gets a
// fallback, and a `hybrid` turn does not relay text the tool already posted
// (docs/audits/2026-09-22-channel-reply-hybrid-mode.md). Successful calls only.

import type { ChannelMessageActionName } from "@getpaseo/channels-core/channels/plugins/types.public.host-adapter";

export interface ToolTurnDeliveries {
  /** The channel started this turn (a first prompt or a follow-up), so what
   * the turn ends with is owed to the conversation. A turn started from the
   * Paseo app, or by the Agent on its own, is not. */
  channelTurn: boolean;
  /** A `send` with `final` true or omitted, or an action that posts new
   * content, landed. */
  answered: boolean;
  /** A `final=false` progress `send` landed. */
  progress: boolean;
  /** A visible action on an existing message (react, edit, pin, …) landed. */
  acted: boolean;
  /** The text of the latest sends that landed, oldest first. */
  texts: string[];
}

/** One landed tool call. */
export type ToolDelivery =
  | { kind: "send"; final: boolean; text?: string | undefined }
  | { kind: "action" };

/**
 * The shortest gap between two `final=false` sends of one turn. The prompt
 * asks for about a minute; this is the floor the Hub enforces, so an Agent
 * that ignores the prompt still cannot flood the conversation.
 */
export const TOOL_PROGRESS_MIN_INTERVAL_MS = 30_000;

/** Enough for the duplicate check; a record the relay never takes (a
 * Workflow on `tool` has no relay) must not grow for the capability's life. */
const KEPT_TEXTS = 20;

export interface ToolTurnRecord extends ToolTurnDeliveries {
  lastProgressAt: number | null;
}

export function emptyToolTurn(): ToolTurnRecord {
  return {
    channelTurn: false,
    answered: false,
    progress: false,
    acted: false,
    texts: [],
    lastProgressAt: null,
  };
}

/** Fold one landed call into the record. A progress send starts the pacing window. */
export function recordToolDelivery(record: ToolTurnRecord, delivery: ToolDelivery, now: number) {
  if (delivery.kind === "action") {
    record.acted = true;
    return;
  }
  if (delivery.final) {
    record.answered = true;
  } else {
    record.progress = true;
    record.lastProgressAt = now;
  }
  if (delivery.text === undefined || delivery.text === "") return;
  record.texts.push(delivery.text);
  if (record.texts.length > KEPT_TEXTS) record.texts.shift();
}

/** Whether a `final=false` send may go out now. */
export function progressAllowed(record: ToolTurnRecord | undefined, now: number): boolean {
  const last = record?.lastProgressAt ?? null;
  return last === null || now - last >= TOOL_PROGRESS_MIN_INTERVAL_MS;
}

/** One Agent's records merged (a re-issued token keeps its turn). */
export function mergeToolTurns(records: readonly ToolTurnRecord[]): ToolTurnDeliveries | undefined {
  if (records.length === 0) return undefined;
  return {
    channelTurn: records.some((record) => record.channelTurn),
    answered: records.some((record) => record.answered),
    progress: records.some((record) => record.progress),
    acted: records.some((record) => record.acted),
    texts: records.flatMap((record) => record.texts),
  };
}

/**
 * How each message action counts for the turn. `answer` posts new content in
 * the conversation; `act` changes something the user can see (the reaction
 * or the edit can be the whole answer); `read` leaves nothing behind. Keyed by
 * the core vocabulary so a new action cannot be left unclassified.
 */
const ACTION_KINDS: Record<ChannelMessageActionName, "answer" | "act" | "read"> = {
  send: "answer",
  broadcast: "answer",
  poll: "answer",
  reply: "answer",
  sendWithEffect: "answer",
  sendAttachment: "answer",
  "thread-create": "answer",
  "thread-reply": "answer",
  sticker: "answer",
  "upload-file": "answer",
  "poll-vote": "act",
  react: "act",
  edit: "act",
  unsend: "act",
  delete: "act",
  pin: "act",
  unpin: "act",
  renameGroup: "act",
  setGroupIcon: "act",
  addParticipant: "act",
  removeParticipant: "act",
  leaveGroup: "act",
  "emoji-upload": "act",
  "sticker-upload": "act",
  "role-add": "act",
  "role-remove": "act",
  "channel-create": "act",
  "channel-edit": "act",
  "channel-delete": "act",
  "channel-move": "act",
  "category-create": "act",
  "category-edit": "act",
  "category-delete": "act",
  "topic-create": "act",
  "topic-edit": "act",
  "event-create": "act",
  timeout: "act",
  kick: "act",
  ban: "act",
  "set-profile": "act",
  "set-presence": "act",
  reactions: "read",
  read: "read",
  "list-pins": "read",
  permissions: "read",
  "thread-list": "read",
  search: "read",
  "sticker-search": "read",
  "member-info": "read",
  "role-info": "read",
  "emoji-list": "read",
  "channel-info": "read",
  "channel-list": "read",
  "conversation-open": "read",
  "voice-status": "read",
  "event-list": "read",
  "download-file": "read",
};

/** How a landed non-send action counts; `undefined` = not at all (a read, or a
 * name outside the vocabulary, which the tool refuses before it runs). */
export function actionDelivery(action: string): ToolDelivery | undefined {
  const kind = (ACTION_KINDS as Record<string, "answer" | "act" | "read">)[action];
  if (kind === "answer") return { kind: "send", final: true };
  if (kind === "act") return { kind: "action" };
  return undefined;
}
