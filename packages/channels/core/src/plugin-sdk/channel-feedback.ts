// upstream: src/plugin-sdk/channel-feedback.ts@5d8067a4483
// Status-reaction and ack-reaction contracts for channel feedback surfaces.
export { DEFAULT_EMOJIS, type StatusReactionEmojis } from "../channels/status-reactions.js";
// D-CORE-216: the upstream barrel also re-exports the ack-reaction resolver
// (`src/channels/ack-reactions.ts`), the channel log helpers
// (`src/channels/logging.ts`), the agent identity reader and the outbound
// target-error classes. Those are host surfaces the port stops at.

// WhatsApp port addition: the ported WhatsApp target resolver raises upstream's
// missing-target error. Of the D-CORE-216 omissions, only this factory is
// carried (`src/infra/outbound/target-errors.ts`, already ported).
export { missingTargetError } from "../infra/outbound/target-errors.js";
