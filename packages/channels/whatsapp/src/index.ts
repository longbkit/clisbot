// @clisbot/channels-whatsapp — the in-repo WhatsApp channel vertical. Exports:
// - `default` — the bundled-channel entry (`id: "whatsapp"`);
// - `whatsappPlugin` — the pinned drive-surface name;
// - the QR verbs, the auth-store boundary and the layer modules for tests.
export { default } from "./entry.js";
export { entry } from "./entry.js";
export { whatsappPlugin, sendMedia, sendText, startWhatsAppAccount } from "./plugin.js";
export { WHATSAPP_TEXT_CHUNK_LIMIT } from "./outbound.js";
export { whatsappMessageActions, WHATSAPP_MESSAGE_ACTIONS } from "./fusion/message-actions.js";
export { setChannelHostRuntime, getHostRuntime } from "./runtime-store.js";
export {
  bindWhatsAppAuthDir,
  flushWhatsAppAuth,
  unbindWhatsAppAuthDir,
  whatsAppAuthDirFor,
  WHATSAPP_AUTH_NAMESPACE,
  WHATSAPP_AUTH_ROOT,
} from "./fusion/auth-fs.js";
export {
  cancelWhatsAppQrLogin,
  logoutWhatsApp,
  pollWhatsAppQrLogin,
  startWhatsAppQrLogin,
  type WhatsAppQrResult,
  type WhatsAppQrStatus,
} from "./fusion/qr-setup.js";
export { buildWhatsAppInboundEvent, wasWhatsAppAddressed } from "./fusion/inbound-adapter.js";
export { checkInboundAccessControl } from "./fusion/inbound-access.js";
export { mergeAccountCarrier, resolveWhatsAppDriveAccount } from "./fusion/account-config.js";
export { WhatsAppNotLinkedError } from "./fusion/listener-session.js";
export { normalizeWhatsAppTarget, isWhatsAppGroupJid } from "./normalize.js";
export { markdownToWhatsApp, toWhatsappJid } from "./text-runtime.js";
