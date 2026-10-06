// upstream: extensions/whatsapp/src/channel-react-action.runtime.ts@3928bad9bad
// Whatsapp plugin module implements channel react action behavior.
import { readStringOrNumberParam, readStringParam } from "@clisbot/channels-core/plugin-sdk/channel-actions";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";

export { resolveReactionMessageId } from "@clisbot/channels-core/plugin-sdk/channel-actions";
export { handleWhatsAppAction } from "./action-runtime.js";
export { resolveAuthorizedWhatsAppOutboundTarget } from "./action-runtime-target-auth.js";
export { resolveWhatsAppAccount, resolveWhatsAppMediaMaxBytes } from "./accounts.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize.js";
export { sendWhatsAppUploadFile as sendMessageWhatsApp } from "./send.js";
export { readStringOrNumberParam, readStringParam, type OpenClawConfig };
