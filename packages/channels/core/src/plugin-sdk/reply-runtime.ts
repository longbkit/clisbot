// Fusion-owned boundary for `src/plugin-sdk/reply-runtime.ts` (D-CORE-262).
//
// Upstream's barrel is the whole agent reply runtime: inbound dispatch, the reply
// pipeline, heartbeat/activation/abort commands, chunking and the inbound debouncer.
// Fusion's Hub owns inbound dispatch and the agent turn, so only the reply payload
// contract the ported channel senders type against is carried, from the same source
// module upstream re-exports it from.
import type { ReplyPayload } from "../auto-reply/reply-payload.js";

export type { ReplyPayload };

// Slice 20 addition (Telegram inbound port): the ported Telegram message cache
// derives its cached-node type from `MsgContext["ReplyChain"]`, which upstream
// re-exports from this same barrel.
export type { MsgContext } from "../auto-reply/templating.js";
