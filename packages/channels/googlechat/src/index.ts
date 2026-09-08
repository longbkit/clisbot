// @getpaseo/channels-googlechat — the in-repo Google Chat channel vertical
// (goal ledger slice 14). Exports:
// - `default` — the bundled-channel entry (`id: "googlechat"`);
// - `googlechatPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export {
  googlechatPlugin,
  sendMedia,
  sendText,
  startGoogleChatAccount,
  updateText,
} from "./plugin.js";
export { deleteMessage } from "./outbound.js";
export { installGoogleChatRuntime, disposeGoogleChatRuntime } from "./fusion/runtime.js";
export * from "./api.js";
export { googlechatMessageActions } from "./actions.js";
export {
  googlechatChannelActions,
  GOOGLECHAT_MESSAGE_ACTIONS,
} from "./channel-actions.js";
export { setChannelHostRuntime, getHostRuntime, registerAccountInbound } from "./runtime-store.js";
export { normalizeAudienceType } from "./lifecycle/start-account.js";
export {
  createGoogleChatAdmission,
  type GoogleChatAdmissionResult,
  type GoogleChatWebhookAdmission,
} from "./fusion/admission.js";
export {
  buildGoogleChatInboundEvent,
  extractMentionInfo,
  type GoogleChatInboundBuild,
} from "./fusion/inbound-adapter.js";
export {
  resolveGoogleChatWebhookMode,
  startGoogleChatWebhookSession,
} from "./fusion/webhook-session.js";
export { resolveGoogleChatDriveAccount, mergeAccountCarrier } from "./fusion/account-config.js";
export { verifyGoogleChatRequest, getGoogleChatAccessToken } from "./auth.js";
export * from "./targets.js";
export { formatGoogleChatTextChunks, GOOGLE_CHAT_FORMAT_PROFILE } from "./format.js";
export { parseGoogleChatInboundPayload, GoogleChatEventPayloadError } from "./monitor-event.js";
export {
  listGoogleChatAccountIds,
  inspectGoogleChatAccount,
  resolveGoogleChatAccount,
  isGoogleChatAccountConfigured,
} from "./accounts.js";
export { setGuardedFetchImplementation } from "./fusion/ssrf-fetch.js";
export type * from "./types.js";
