import { randomUUID } from "node:crypto";
import type { JournalEntry } from "./paged-journal.js";
import type { SessionEventKind } from "./session-event-log.js";

/** Derived pointer into `events.jsonl`. Always rebuildable from the log itself. */
export interface EventPointer {
  offset: number;
  length: number;
}

/** Lightweight user-message anchor: enough to list and jump, never enough to render. */
export interface SessionMessageAnchor {
  messageId: string;
  preview: string;
  epoch: string;
  seq: number;
  timestamp: string;
}

/** A lookup that resolved to more than one row cannot answer an identity question. */
export const AMBIGUOUS_ID = -1;

export interface SessionEventIndex {
  version: 2;
  epoch: string;
  /** Bytes of `events.jsonl` already folded in. The tail past it is rescanned on load. */
  scannedBytes: number;
  operationOrder: number;
  revision: number;
  pointers: Record<string, EventPointer>;
  anchors: SessionMessageAnchor[];
  ids: Record<string, number>;
  tools: Record<string, number[]>;
  summary?: unknown;
}

export interface SessionEventEnvelope<T> extends JournalEntry<T> {
  kind: SessionEventKind;
  epoch: string;
}

const PREVIEW_LIMIT = 120;
/** Past this a tool's lifecycle is no longer cheap to complete from an index alone. */
export const TOOL_OCCURRENCE_LIMIT = 256;
/** Checkpoint interval. Rewriting the whole index per append would cost O(rows²) bytes. */
export const CHECKPOINT_ROWS = 64;
export const CHECKPOINT_BYTES = 256 * 1024;

/** Collapse whitespace so a preview never carries layout from the original message. */
export function messagePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= PREVIEW_LIMIT
    ? collapsed
    : `${collapsed.slice(0, PREVIEW_LIMIT - 1)}…`;
}

export function emptyIndex(epoch: string = randomUUID()): SessionEventIndex {
  return {
    version: 2,
    epoch,
    scannedBytes: 0,
    operationOrder: 0,
    revision: 0,
    pointers: {},
    anchors: [],
    ids: {},
    tools: {},
  };
}

export function isIndex(value: unknown): value is SessionEventIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<SessionEventIndex>;
  return (
    index.version === 2 &&
    typeof index.epoch === "string" &&
    typeof index.scannedBytes === "number" &&
    typeof index.operationOrder === "number" &&
    typeof index.revision === "number" &&
    Boolean(index.pointers) &&
    Array.isArray(index.anchors) &&
    Boolean(index.ids) &&
    Boolean(index.tools)
  );
}

/** Applies one persisted line to the derived index. Unreadable lines are skipped, never fatal. */
export function absorbLine(
  index: SessionEventIndex,
  anchors: Map<string, SessionMessageAnchor>,
  line: string,
  offset: number,
): void {
  let envelope: SessionEventEnvelope<unknown>;
  try {
    envelope = JSON.parse(line) as SessionEventEnvelope<unknown>;
  } catch {
    return;
  }
  if (typeof envelope.kind !== "string" || typeof envelope.seq !== "number") return;
  if (typeof envelope.epoch === "string") index.epoch = envelope.epoch;
  index.pointers[`${envelope.kind}:${envelope.seq}`] = {
    offset,
    length: Buffer.byteLength(line) + 1,
  };
  if (envelope.operation)
    index.operationOrder = Math.max(index.operationOrder, envelope.operation.order);
  for (const [key, seq] of derivedIds(envelope))
    index.ids[key] = mergeId(key.slice(0, key.indexOf(":")), index.ids[key], seq);
  const callId = toolCallId(envelope);
  if (callId) {
    const seqs = (index.tools[callId] ??= []);
    // Overflow is recorded as a truncated list; readers widen to a full projection instead.
    if (seqs.length < TOOL_OCCURRENCE_LIMIT && !seqs.includes(envelope.seq))
      seqs.push(envelope.seq);
  }
  const anchor = derivedAnchor(envelope, index.epoch);
  if (anchor) anchors.set(anchor.messageId, anchor);
}

export function mergeId(namespace: string, existing: number | undefined, seq: number): number {
  if (existing === undefined || existing === seq) return seq;
  if (namespace === "submission" || namespace === "permission") return Math.max(existing, seq);
  return AMBIGUOUS_ID;
}

/** Identity keys a record carries. Nothing here is inferred from text or position. */
function derivedIds(envelope: SessionEventEnvelope<unknown>): [string, number][] {
  const value = envelope.value as Record<string, unknown> | undefined;
  if (!value) return [];
  if (envelope.kind === "submission" || envelope.kind === "permission") {
    return typeof value.id === "string" ? [[`${envelope.kind}:${value.id}`, envelope.seq]] : [];
  }
  const item = value.item as
    | { type?: string; messageId?: string; clientMessageId?: string }
    | undefined;
  if (item?.type !== "user_message") return [];
  const keys: [string, number][] = [];
  if (item.clientMessageId) keys.push([`client:${item.clientMessageId}`, envelope.seq]);
  for (const id of [value.providerMessageId, item.messageId])
    if (typeof id === "string" && id) keys.push([`provider:${id}`, envelope.seq]);
  return keys;
}

function toolCallId(envelope: SessionEventEnvelope<unknown>): string | null {
  if (envelope.kind !== "timeline") return null;
  const item = (envelope.value as { item?: { type?: string; callId?: string } } | undefined)?.item;
  return item?.type === "tool_call" && typeof item.callId === "string" ? item.callId : null;
}

function derivedAnchor(
  envelope: SessionEventEnvelope<unknown>,
  epoch: string,
): SessionMessageAnchor | null {
  if (envelope.kind !== "timeline") return null;
  const value = envelope.value as
    | { item?: Record<string, unknown>; timestamp?: string }
    | undefined;
  const item = value?.item as
    | { type?: string; text?: string; messageId?: string; clientMessageId?: string }
    | undefined;
  if (item?.type !== "user_message" || typeof item.text !== "string") return null;
  const messageId = item.messageId ?? item.clientMessageId;
  if (!messageId) return null;
  return {
    messageId,
    preview: messagePreview(item.text),
    epoch,
    seq: envelope.seq,
    timestamp: typeof value?.timestamp === "string" ? value.timestamp : "",
  };
}
