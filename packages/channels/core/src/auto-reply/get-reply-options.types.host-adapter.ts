// Fusion-owned host adapter for `src/auto-reply/get-reply-options.types.ts` (D-CORE-028).
//
// Upstream's module describes the whole auto-reply option graph (prompt sources,
// history, streaming, throttling, session policy). The ported message-action
// layer reads one member of it, and that member has its own upstream module,
// which is carried verbatim.
export type { SourceReplyDeliveryMode } from "./source-reply-delivery-mode.types.js";
