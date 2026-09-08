// upstream: src/infra/outbound/reply-policy.ts@5d8067a4483
// D-CORE-307: upstream's module is the outbound reply-policy resolver over
// OpenClaw's `ReplyPayload` / `OutboundReplyFacts` delivery graph. Fusion's Hub
// owns reply policy; only the two payload-facing types the ported Discord
// reply-reference builder reads are carried, verbatim.
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
