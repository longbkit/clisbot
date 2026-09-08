// upstream: src/plugin-sdk/channel-outbound.ts@5d8067a4483
// Outbound receipt + formatting contracts for channel senders.
export {
  createMessageReceiptFromOutboundResults,
  listMessageReceiptPlatformIds,
  resolveMessageReceiptThreadId,
} from "../channels/message/receipt.js";
export type {
  MessageReceipt,
  MessageReceiptPart,
  MessageReceiptPartKind,
  MessageReceiptSourceResult,
} from "../channels/message/types.js";
export type { OutboundDeliveryFormattingOptions } from "../infra/outbound/formatting.js";
// D-CORE-230: the upstream barrel is the whole outbound engine (draft
// streaming, durable receive, the ingress queue/drain, reply pipeline,
// outbound bridge, send deps, session context). Fusion's Hub owns durable
// delivery (goal slices 1-3, 8); only the receipt normalizer and the formatting
// options the ported senders build are carried.

// Slice 10b additions (Slack send port): the unknown-send reconciliation
// contracts the ported Slack sender implements, from the same carried source
// module, and the outbound identity/send-dep helpers upstream's barrel exports
// from `src/infra/outbound/*`.
export type {
  ChannelMessageUnknownSendContext,
  ChannelMessageUnknownSendReconciliationResult,
} from "../channels/message/types.js";
export type { OutboundIdentity } from "../infra/outbound/identity-types.js";
export { resolveOutboundSendDep } from "../infra/outbound/send-deps.js";

// Slice 9b addition (Telegram action-runtime port): upstream's barrel exports the
// durable batch sender and the outbound session-context builder from
// `src/channels/message/runtime.ts` / `src/infra/outbound/session-context.ts`.
// Fusion's Hub owns durable delivery, so both come from the host adapter for
// those source modules (D-CORE-260).
export {
  buildOutboundSessionContext,
  sendDurableMessageBatch,
  type DurableMessageBatchSendParams,
  type DurableMessageBatchSendResult,
  type OutboundSessionContext,
} from "../infra/outbound/durable-batch.host-adapter.js";


// Slice 13 additions (Discord vertical port): the outbound-echo identity record
// the ported Discord webhook sender writes, and the reply-policy resolution
// shape its reply-reference builder reads.
export { recordOutboundMessageIdentity } from "../channels/message/outbound-echo.js";
export type { ReplyToResolution } from "../infra/outbound/reply-policy.js";


// Slice 21/22 additions (Slack inbound parity + streaming/progress port): the
// Slack progress blocks read the plan-step and draft-line shapes, the plan
// checklist renderer and the diff-stat renderer from this barrel, exactly as
// upstream does.
export {
  compactChannelProgressDraftLine,
  formatPlanChecklistLines,
  isChannelProgressAttentionLine,
  normalizeAgentPlanSteps,
  selectPlanChecklistSteps,
} from "../channels/streaming.js";
export type {
  AgentPlanStep,
  AgentPlanStepStatus,
  ChannelProgressDraftLine,
  ChannelProgressDraftLineInput,
} from "../channels/streaming.js";
export { formatChannelProgressDraftDiffStat } from "../channels/progress-draft-diffstat.js";
export type { ChannelProgressDraftDiffStat } from "../channels/progress-draft-diffstat.js";
export type {
  ChannelProgressDraftCompositorLine,
  ChannelProgressDraftCompositorSnapshot,
} from "../channels/progress-draft-compositor.js";

// Slice 22 additions (Telegram streaming/progress port): the ported
// `draft-stream.ts` builds its finalizable controls from the same upstream
// barrel.
export {
  createFinalizableDraftStreamControlsForState,
  takeMessageIdAfterStop,
} from "../channels/draft-stream-controls.js";
export {
  resolveChannelDraftStreamingChunking,
  type ChannelDraftStreamingChunking,
} from "../channels/draft-streaming-chunking.js";

// Slice 14 addition (Google Chat vertical port): the plain-text sanitizer the
// ported Google Chat formatter runs before markdown parsing. Same upstream
// barrel, same source module (`src/infra/outbound/sanitize-text.ts`).
export { sanitizeForPlainText, stripInternalRuntimeScaffolding } from "../infra/outbound/sanitize-text.js";


// Slice 16 addition (Zalo vertical port): the named ingress-error factory the
// ported Zalo webhook spool builds its payload error from. Same upstream
// barrel, same source module (`src/channels/message/ingress-errors.ts`).
export { createChannelIngressError } from "../channels/message/ingress-errors.js";
