// upstream: extensions/whatsapp/src/inbound/send-result.test-helper.ts@3928bad9bad
import { createMessageReceiptFromOutboundResults } from "@clisbot/channels-core/plugin-sdk/channel-outbound";
import type { WhatsAppSendKind, WhatsAppSendResult } from "./send-result.js";

export function createAcceptedWhatsAppSendResult(
  kind: WhatsAppSendKind,
  id: string,
): WhatsAppSendResult {
  return {
    kind,
    messageId: id,
    receipt: createMessageReceiptFromOutboundResults({
      kind: kind === "media" || kind === "text" ? kind : "unknown",
      results: [{ channel: "whatsapp", messageId: id }],
    }),
    keys: [{ id }],
    providerAccepted: true,
  };
}
