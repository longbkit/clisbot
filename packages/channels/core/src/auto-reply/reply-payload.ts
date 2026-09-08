// Fusion-owned boundary for `src/auto-reply/reply-payload.ts` (D-CORE-207).
//
// Upstream's `ReplyPayload` is the agent-engine reply envelope (media parts,
// presentation, directives, streaming state). The Hub owns reply construction
// in Fusion, so the ported channel types keep the name with an open shape.
import type { AssistantDeliveryTtsFacts } from "../llm/types.host-adapter.js";
import type { ReplyPayload as SharedReplyPayload } from "../shared/reply-payload.types.js";

export type {
  ReplyMediaAttachment,
  ReplyPayloadTtsSupplement,
} from "../shared/reply-payload.types.js";

/**
 * Upstream declares the payload shape in `src/shared/reply-payload.types.ts`,
 * which is now carried verbatim under this root. The open index signature and the
 * per-channel `channelData`/`media` slots stay so host-owned extras still
 * type-check where Fusion adds them.
 */
export type ReplyPayload = Omit<SharedReplyPayload, "channelData"> & {
  media?: unknown;
  /** Per-channel escape hatch the ported channel senders read and rewrite. */
  channelData?: Record<string, unknown> & { telegram?: unknown };
  [key: string]: unknown;
};

/**
 * Internal per-payload metadata, kept off the wire in a WeakMap as upstream does.
 * Upstream's record also carries transcript ownership, session-writer authority,
 * compaction and continuation facts that belong to the OpenClaw agent runtime;
 * Fusion carries the speech facts the ported send/TTS path reads.
 */
export type ReplyPayloadMetadata = {
  /** Persisted assistant speech facts; never serialized into channel payloads. */
  tts?: AssistantDeliveryTtsFacts;
  /** Structured message-tool speech is an explicit request, independent of auto-TTS mode. */
  ttsExplicit?: true;
};

const replyPayloadMetadata = new WeakMap<object, ReplyPayloadMetadata>();

/** Adds internal metadata to a reply payload object. */
export function setReplyPayloadMetadata<T extends object>(
  payload: T,
  metadata: ReplyPayloadMetadata,
): T {
  const previous = replyPayloadMetadata.get(payload);
  replyPayloadMetadata.set(payload, { ...previous, ...metadata });
  return payload;
}

/** Reads internal metadata attached to a reply payload object. */
export function getReplyPayloadMetadata(payload: object): ReplyPayloadMetadata | undefined {
  return replyPayloadMetadata.get(payload);
}

/** Carries internal metadata from one payload object onto a derived one. */
export function copyReplyPayloadMetadata<T extends object>(source: object, payload: T): T {
  const metadata = getReplyPayloadMetadata(source);
  return metadata ? setReplyPayloadMetadata(payload, metadata) : payload;
}
