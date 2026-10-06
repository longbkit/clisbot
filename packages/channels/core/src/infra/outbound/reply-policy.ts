// upstream: src/infra/outbound/reply-policy.ts@5d8067a4483
// D-CORE-307: upstream's module is the outbound reply-policy resolver over
// OpenClaw's `ReplyPayload` / `OutboundReplyFacts` delivery graph. Fusion's Hub
// owns reply policy; only the two payload-facing types the ported Discord
// reply-reference builder reads are carried, verbatim. The WhatsApp port adds
// upstream's `createReplyToFanout` verbatim: the ported WhatsApp send path
// quotes only the first chunk of a multi-part answer in single-use modes.
import { isSingleUseReplyToMode } from "../../auto-reply/reply/reply-reference.js";
import type { ReplyToMode } from "../../config/types.base.js";

/** Per-payload reply target override passed to outbound channel adapters. */
export type ReplyToOverride = {
  replyToId?: string | null | undefined;
  replyToIdSource?: ReplyToResolution["source"] | undefined;
};

/** Resolved reply target plus whether it came from payload or ambient context. */
export type ReplyToResolution = {
  replyToId?: string;
  source?: "explicit" | "implicit";
};

export type { ReplyToMode };

/** Creates a reply-to supplier that consumes implicit single-use reply ids once. */
export function createReplyToFanout(params: {
  replyToId?: string | null;
  replyToMode?: ReplyToMode;
  replyToIdSource?: ReplyToResolution["source"];
}): () => string | undefined {
  const replyToId = params.replyToId ?? undefined;
  if (!replyToId) {
    return () => undefined;
  }
  const singleUse =
    params.replyToIdSource !== "explicit" &&
    params.replyToMode !== undefined &&
    isSingleUseReplyToMode(params.replyToMode);
  if (!singleUse) {
    return () => replyToId;
  }
  let current: string | undefined = replyToId;
  return () => {
    const value = current;
    current = undefined;
    return value;
  };
}
