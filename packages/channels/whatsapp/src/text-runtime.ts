// upstream: extensions/whatsapp/src/text-runtime.ts@3928bad9bad
// Whatsapp plugin module implements text runtime behavior.
export {
  sanitizeAssistantVisibleText,
  sanitizeAssistantVisibleTextWithProfile,
  stripToolCallXmlTags,
} from "@clisbot/channels-core/plugin-sdk/text-chunking";
export { normalizeE164, resolveUserPath } from "@clisbot/channels-core/plugin-sdk/text-utility-runtime";
export {
  assertWebChannel,
  isSelfChatMode,
  jidToE164,
  markdownToWhatsApp,
  markdownToWhatsAppChunks,
  resolveEquivalentWhatsAppDirectChatJids,
  resolveJidToE164,
  toWhatsappJid,
  toWhatsappJidWithLid,
  type JidToE164Options,
  type WebChannel,
} from "./targets-runtime.js";
