// @getpaseo/channels-zalouser — the in-repo Zalo Personal (`zalouser`) channel
// vertical (goal ledger slice 17). Exports:
// - `default` — the bundled-channel entry (`id: "zalouser"`);
// - `zalouserPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the QR setup verbs, the session-store boundary and the layer modules for
//   targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { zalouserPlugin, sendMedia, sendText, startZalouserAccount } from "./plugin.js";
export { ZALOUSER_TEXT_CHUNK_LIMIT } from "./outbound.js";
export { zalouserChannelActions, ZALOUSER_MESSAGE_ACTIONS } from "./channel-actions.js";
export {
  resolveZalouserQrProfile,
  sendZalouserTextFromContext,
  sendZalouserMediaFromContext,
  zalouserAuthAdapter,
  zalouserGroupsAdapter,
  zalouserMessageActions,
  zalouserMessagingAdapter,
  zalouserResolverAdapter,
} from "./channel.adapters.js";
export {
  setChannelHostRuntime,
  getHostRuntime,
  registerAccountInbound,
  unregisterAccountInbound,
} from "./runtime-store.js";
export { probeZalouser, type ZalouserProbeResult } from "./probe.js";
export { createZalouserTool } from "./tool.js";
export {
  collectZalouserToolRegistrations,
  registerZalouserTools,
  zalouserAgentTools,
  ZALOUSER_TOOL_NAMES,
  type ZalouserToolRegistrar,
  type ZalouserToolRegistration,
} from "./fusion/tools.js";
export {
  cancelZalouserQrLogin,
  logoutZalouser,
  pollZalouserQrLogin,
  startZalouserQrLogin,
  type ZalouserQrPollResult,
  type ZalouserQrStartResult,
  type ZalouserQrStatus,
} from "./fusion/qr-setup.js";
export {
  createHostRuntimeSessionStore,
  createMemorySessionStore,
  flushZalouserSessions,
  getZalouserSessionCache,
  hydrateZalouserSessions,
  installZalouserSessionStore,
  ZALOUSER_SESSION_MAX_ENTRIES,
  ZALOUSER_SESSION_NAMESPACE,
  type ZalouserSessionCache,
  type ZalouserSessionStore,
} from "./fusion/session-store.js";
export {
  clearStoredZaloCredentials,
  loadStoredZaloCredentials,
  normalizeStoredZaloCredentials,
  normalizeZalouserCredentialProfile,
  refreshStoredZaloCredentials,
  saveStoredZaloCredentials,
  zalouserCredentialStoreKey,
  type StoredZaloCredentials,
  type ZaloCredentialStateRecord,
} from "./session-state.js";
export {
  createZalouserAdmission,
  inspectZalouserIngressMessage,
  isZalouserAuthenticationFailure,
  ZalouserIngressPayloadError,
  type ZalouserAdmission,
  type ZalouserAdmissionResult,
} from "./fusion/admission.js";
export {
  buildZalouserInboundEvent,
  wasZalouserAddressed,
  type ZalouserInboundBuild,
  type ZalouserInboundParams,
} from "./fusion/inbound-adapter.js";
export {
  startZalouserListenerSession,
  ZALOUSER_ADMISSION_MAX_ATTEMPTS,
  ZALOUSER_ADMISSION_RETRY_DELAY_MS,
} from "./fusion/listener-session.js";
export {
  mergeAccountCarrier,
  resolveZalouserDriveAccount,
} from "./fusion/account-config.js";
export {
  listZalouserAccountIds,
  resolveDefaultZalouserAccountId,
  resolveZalouserAccountSync,
  checkZcaAuthenticated,
} from "./accounts.js";
export {
  normalizeZalouserTarget,
  parseZalouserDirectoryGroupId,
  parseZalouserOutboundTarget,
} from "./session-route.js";
export { parseZalouserTextStyles } from "./text-styles.js";
export { formatZalouserMessageSidFull, resolveZalouserReactionMessageIds } from "./message-sid.js";
export { normalizeZaloReactionIcon } from "./reaction.js";
export * from "./send.js";
export {
  normalizeZaloInboundMessage,
  startZaloListener,
  startZaloQrLogin,
  waitForZaloQrLogin,
  logoutZaloProfile,
} from "./zalo-js.js";
export type * from "./types.js";
