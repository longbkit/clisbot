// upstream: src/plugin-sdk/interactive-runtime.ts@5d8067a4483
/**
 * Runtime SDK subpath for interactive replies and message presentation helpers.
 */
export {
  adaptMessagePresentationForChannel,
  applyPresentationActionLimits,
  presentationPageSize,
} from "../channels/plugins/outbound/interactive.js";
export type {
  InteractiveButtonStyle,
  InteractiveReply,
  InteractiveReplyBlock,
  InteractiveReplyButton,
  InteractiveReplyOption,
  LegacyInteractiveReply,
  LegacyInteractiveReplyBlock,
  LegacyInteractiveReplyButton,
  LegacyInteractiveReplyOption,
  LegacyInteractiveReplySelectBlock,
  LegacyInteractiveReplyTextBlock,
  MessagePresentation,
  MessagePresentationAction,
  MessagePresentationBlock,
  MessagePresentationButton,
  MessagePresentationButtonStyle,
  MessagePresentationButtonsBlock,
  MessagePresentationChartBlock,
  MessagePresentationChartSegment,
  MessagePresentationChartSeries,
  MessagePresentationContextBlock,
  MessagePresentationDividerBlock,
  MessagePresentationInteractiveBlock,
  MessagePresentationOption,
  MessagePresentationSelectBlock,
  MessagePresentationTableBlock,
  MessagePresentationTableCell,
  MessagePresentationTextBlock,
  MessagePresentationTone,
  ModelPickerAction,
  ReplyPayloadDelivery,
  ReplyPayloadDeliveryPin,
} from "../interactive/payload.js";
export {
  hasInteractiveReplyBlocks,
  hasLegacyInteractiveReplyBlocks,
  hasMessagePresentationBlocks,
  hasReplyChannelData,
  hasReplyContent,
  interactiveReplyToPresentation,
  legacyInteractiveReplyToPresentation,
  isMessagePresentationInteractiveBlock,
  normalizeMessagePresentation,
  normalizeInteractiveReply,
  normalizeLegacyInteractiveReply,
  presentationToInteractiveControlsReply,
  presentationToInteractiveReply,
  renderMessagePresentationChartFallbackText,
  renderMessagePresentationFallbackText,
  renderMessagePresentationTableFallbackText,
  resolveMessagePresentationActionValue,
  resolveMessagePresentationButtonAction,
  resolveMessagePresentationControlValue,
  resolveMessagePresentationOptionAction,
  resolveInteractiveTextFallback,
  reduceLegacyInteractiveReply,
  resolveLegacyInteractiveTextFallback,
} from "../interactive/payload.js";
// D-CORE-035: the upstream barrel also re-exports `reduceInteractiveReply`
// (channels/plugins/outbound/interactive.js — it is defined in the reply
// pipeline, not the presentation adapter), `renderPresentationForDelivery`
// and the model-picker capability profile. Those pull OpenClaw's outbound
// delivery graph; Fusion's Hub owns delivery. The presentation payload module
// and its channel capability adapter are carried whole.

// Slice 15 addition (Feishu vertical port): the ported Feishu card renderer
// runs presentation blocks through the shared native-render/fallback policy.
// D-CORE-035 kept this out while no vertical drove a native presentation; the
// source module is carried now (`src/channels/plugins/outbound/presentation-delivery.ts`).
export { renderPresentationForDelivery } from "../channels/plugins/outbound/presentation-delivery.js";

// D-W6-02 (Fusion-owned): presentation admission — the boundary rule that
// repairs a table's missing caption and reports every block the normalizer
// refuses, so no authored block is dropped without a word to its author.
export { admitMessagePresentation } from "../interactive/presentation-admission.js";
export type {
  MessagePresentationAdmission,
  MessagePresentationBlockNote,
} from "../interactive/presentation-admission.js";
