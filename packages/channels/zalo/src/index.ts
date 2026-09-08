// @getpaseo/channels-zalo — the in-repo Zalo Official Account (Bot API) channel
// vertical (goal ledger slice 16). Exports:
// - `default` — the bundled-channel entry (`id: "zalo"`);
// - `zaloPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { zaloPlugin, sendMedia, sendText, startZaloAccount } from "./plugin.js";
export { ZALO_TEXT_CHUNK_LIMIT } from "./outbound.js";
export * from "./api.js";
export { zaloMessageActions } from "./actions.js";
export { zaloChannelActions, ZALO_MESSAGE_ACTIONS } from "./channel-actions.js";
export { setChannelHostRuntime, getHostRuntime, registerAccountInbound } from "./runtime-store.js";
export { probeZalo, type ZaloProbeResult } from "./probe.js";
export { sendMessageZalo } from "./send.js";
export { resolveZaloToken } from "./token.js";
export {
  inspectZaloAccount,
  isZaloAccountConfigured,
  listZaloAccountIds,
  resolveDefaultZaloAccountId,
  resolveZaloAccount,
} from "./accounts.js";
export { normalizeZaloAllowEntry, resolveZaloRuntimeGroupPolicy } from "./group-access.js";
export {
  inspectZaloWebhookEvent,
  parseClaimedUpdate,
  isZaloAuthenticationFailure,
  ZaloWebhookPayloadError,
  ZALO_WEBHOOK_SPOOL_VERSION,
  type ZaloWebhookSpoolPayload,
} from "./webhook-spool.js";
export { zaloWebhookRuntime } from "./monitor.webhook.js";
export {
  createZaloAdmission,
  type ZaloAdmission,
  type ZaloAdmissionResult,
} from "./fusion/admission.js";
export {
  buildZaloInboundEvent,
  resolveZaloTimestampMs,
  wasZaloBotMentioned,
  type ZaloInboundBuild,
  type ZaloInboundParams,
} from "./fusion/inbound-adapter.js";
export {
  assertZaloWebhookMode,
  resolveZaloWebhookMode,
  startZaloWebhookSession,
} from "./fusion/webhook-session.js";
export {
  startZaloPollingSession,
  ZALO_POLL_TIMEOUT_SECONDS,
  ZALO_UPDATE_MAX_ATTEMPTS,
} from "./fusion/polling-session.js";
export { mergeAccountCarrier, resolveZaloDriveAccount } from "./fusion/account-config.js";
export { setSsrfLookupImplementation } from "./fusion/ssrf.js";
export type * from "./types.js";
