// The drive surface: the pinned export name `whatsappPlugin` carrying
// `gateway.startAccount` + `outbound.sendText`/`sendMedia`, the message-tool
// actions, and the QR setup verbs (packages/channels/whatsapp/HUB-WIRING.md).
import type { ChannelPlugin, HostRuntime } from "@clisbot/channels-shared";
import { bindWhatsAppAuthDir, unbindWhatsAppAuthDir } from "./fusion/auth-fs.js";
import { whatsappMessageActions } from "./fusion/message-actions.js";
import {
  cancelWhatsAppQrLogin,
  logoutWhatsApp,
  pollWhatsAppQrLogin,
  startWhatsAppQrLogin,
} from "./fusion/qr-setup.js";
import { setWhatsAppAccountRuntimeConfig } from "./fusion/runtime-config.js";
import {
  collectWhatsAppToolRegistrations,
  registerWhatsAppTools,
  WHATSAPP_TOOL_NAMES,
} from "./fusion/tools.js";
import { startWhatsAppAccount } from "./lifecycle/start-account.js";
import { sendMedia, sendText, sendTyping } from "./outbound.js";
import { accountHostRuntime, forgetAccountHostRuntime, getHostRuntime } from "./runtime-store.js";
import { stopWhatsAppTypingForAccount } from "./fusion/typing.js";
import { sendReactionWhatsApp } from "./send.js";

/** What the Hub hands a QR verb: the account id, as `profile`, and the
 * account's own HostRuntime (`supervisor/qr-login.ts`). */
interface QrLoginParams {
  profile: string;
  accountId?: string;
  hostRuntime?: HostRuntime;
}

function accountOf(params: QrLoginParams): string {
  return params.accountId ?? params.profile;
}

export const whatsappPlugin: ChannelPlugin = {
  actions: whatsappMessageActions,
  messageActions: whatsappMessageActions,
  /** `whatsapp_send_location` (`fusion/tools.ts`), mounted by the Hub per call. */
  agentTools: {
    names: WHATSAPP_TOOL_NAMES,
    collect: collectWhatsAppToolRegistrations,
    registerTools: registerWhatsAppTools,
  },
  /** QR linking is this channel's whole onboarding; the Hub drives these verbs. */
  setup: {
    auth: "qr",
    /**
     * Bind the account's encrypted auth directory before any QR verb runs. The
     * account start does this too, but an unlinked account fails its start —
     * exactly when these verbs are used — and the scanned keys must reach the
     * encrypted store, not only memory.
     */
    bindAccountSession: async ({
      accountId,
      hostRuntime,
    }: {
      accountId: string;
      hostRuntime?: HostRuntime;
    }): Promise<void> => {
      await bindWhatsAppAuthDir({ accountId, hostRuntime: accountHostRuntime(accountId, hostRuntime) });
      setWhatsAppAccountRuntimeConfig(accountId, {});
    },
    startQrLogin: (params: QrLoginParams) => startWhatsAppQrLogin({ accountId: accountOf(params) }),
    pollQrLogin: (params: QrLoginParams) => pollWhatsAppQrLogin({ accountId: accountOf(params) }),
    cancelQrLogin: (params: QrLoginParams) => cancelWhatsAppQrLogin({ accountId: accountOf(params) }),
    relinkQrLogin: (params: QrLoginParams) =>
      startWhatsAppQrLogin({ accountId: accountOf(params), relink: true }),
    logout: (params: QrLoginParams) =>
      logoutWhatsApp({
        accountId: accountOf(params),
        ...(params.hostRuntime === undefined ? {} : { hostRuntime: params.hostRuntime }),
      }),
  },
  /**
   * The Hub's loader calls this when it unloads the account's vertical — a QR
   * setup session handing over to the account start, an account removed or
   * reloaded. A setup session's bound auth directory would otherwise outlive it:
   * a removed account re-added under the same id would answer "already logged
   * in" from memory and write the deleted credential back.
   */
  disposeAccount: (accountId: string) => {
    stopWhatsAppTypingForAccount(accountId);
    forgetAccountHostRuntime(accountId);
    void unbindWhatsAppAuthDir(accountId).catch(() => undefined);
  },
  gateway: {
    startAccount: (ctx) =>
      startWhatsAppAccount(ctx, (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime()),
  },
  outbound: {
    sendText,
    sendMedia,
    typing: sendTyping,
    // The ported WhatsApp primitive, by its upstream name.
    sendReactionWhatsApp,
  },
};

export { startWhatsAppAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText } from "./outbound.js";
