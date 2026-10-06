// Fusion-owned replacement for `inbound/access-control.ts` and
// `inbound/admission.ts` (D-WA-018).
//
// Upstream decides inside the vertical who may talk to the account: DM and
// group policies, allowlists, pairing challenges (it even replies to a stranger
// with a pairing code) and the ingress-graph projection it hands its dispatcher.
// In Fusion every one of those is the Hub's: Routes and Rules, `access:`,
// pairing and approval (`docs/features/channels/README.md`, "Access policy").
// So this module admits every message to the Hub and keeps only the two facts
// that belong to the platform, with upstream's rules:
//
//  * `isSelfChat` — the account runs in self-chat mode (`selfChatMode`), so the
//    owner's own phone does not get read receipts sent on its behalf.
//  * Own DMs — a DM the linked account sent itself (`fromMe`) is the owner
//    typing on their phone, not inbound work, unless self-chat mode is on and the
//    chat is the owner's own number. Upstream's access-control drops the same
//    messages for the same reason ("Skipping outbound DM (fromMe)").
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { resolveWhatsAppAccount } from "../accounts.js";

/** The ingress projection upstream builds for its own dispatcher; the Hub owns it. */
export type WhatsAppInboundAdmission = { readonly owner: "hub" };

export type AcceptedInboundAccessControlResult = {
  allowed: true;
  shouldMarkRead: true;
  isSelfChat: boolean;
  resolvedAccountId: string;
  admission: WhatsAppInboundAdmission;
};

type BlockedInboundAccessControlResult = {
  allowed: false;
  shouldMarkRead: false;
  isSelfChat: boolean;
  resolvedAccountId: string;
  admission?: never;
};

const HUB_ADMISSION: WhatsAppInboundAdmission = { owner: "hub" };

/** Upstream `checkInboundAccessControl`'s signature; the decision is the Hub's. */
export async function checkInboundAccessControl(params: {
  cfg: OpenClawConfig;
  accountId: string;
  from: string;
  selfE164: string | null;
  group: boolean;
  isFromMe: boolean;
  [fact: string]: unknown;
}): Promise<AcceptedInboundAccessControlResult | BlockedInboundAccessControlResult> {
  const account = resolveWhatsAppAccount({ cfg: params.cfg, accountId: params.accountId });
  const isSelfChat = account.selfChatMode === true;
  const isSamePhone = params.selfE164 !== null && params.from === params.selfE164;
  if (!params.group && params.isFromMe && (account.selfChatMode === false || !isSamePhone)) {
    return {
      allowed: false,
      shouldMarkRead: false,
      isSelfChat,
      resolvedAccountId: account.accountId,
    };
  }
  return {
    allowed: true,
    shouldMarkRead: true,
    isSelfChat,
    resolvedAccountId: account.accountId,
    admission: HUB_ADMISSION,
  };
}
