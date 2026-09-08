// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `zalouserPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the members the Hub reads, `outbound` exposes the ported Zalo Personal
// primitives by their upstream names so the message-action runner can dispatch
// without re-deriving a send path, and `setup` carries the QR verbs a
// token-based channel does not need (HUB-WIRING.md §7).

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { zalouserChannelActions } from "./channel-actions.js";
import { listZalouserDirectoryGroupMembers } from "./directory.js";
import {
  collectZalouserToolRegistrations,
  registerZalouserTools,
  ZALOUSER_TOOL_NAMES,
} from "./fusion/tools.js";
import {
  cancelZalouserQrLogin,
  logoutZalouser,
  pollZalouserQrLogin,
  startZalouserQrLogin,
} from "./fusion/qr-setup.js";
import {
  boundZalouserAccountId,
  createHostRuntimeSessionStore,
  hydrateZalouserSessions,
  installZalouserSessionStore,
} from "./fusion/session-store.js";
import { startZalouserAccount } from "./lifecycle/start-account.js";
import { sendMedia, sendText } from "./outbound.js";
import { probeZalouser } from "./probe.js";
import { getHostRuntime } from "./runtime-store.js";
import {
  sendDeliveredZalouser,
  sendImageZalouser,
  sendLinkZalouser,
  sendMessageZalouser,
  sendReactionZalouser,
  sendSeenZalouser,
  sendTypingZalouser,
} from "./send.js";
import {
  listZaloFriendsMatching,
  listZaloGroupMembers,
  listZaloGroupsMatching,
} from "./zalo-js.js";

/** What the Hub hands a QR verb: the profile, and the account when it names one. */
interface QrLoginParams {
  profile: string;
  accountId?: string;
}

/** The account a QR verb operates on: the caller's, else the one bound last. */
function accountScoped(params: QrLoginParams): QrLoginParams & { accountId?: string } {
  const accountId = params.accountId ?? boundZalouserAccountId();
  return { ...params, ...(accountId === undefined ? {} : { accountId }) };
}

export const zalouserPlugin: ChannelPlugin = {
  /** Message-tool discovery, schema contributions and the native
   * `handleAction` dispatcher. */
  actions: zalouserChannelActions,
  messageActions: zalouserChannelActions,
  /** The `zalouser` agent tool. Same shape as the Feishu vertical's, because the
   * Hub reads exactly one (`packages/hub/src/channels/channel-agent-tools.ts`
   * `readAgentToolsSurface`): a name list for discovery plus a `collect` that
   * re-runs against the account's current config. The bare factory list stays
   * exported from `fusion/tools.ts` for callers that want the catalog. */
  agentTools: {
    names: ZALOUSER_TOOL_NAMES,
    collect: collectZalouserToolRegistrations,
    registerTools: registerZalouserTools,
  },
  /** QR login is this channel's whole onboarding; the Hub drives these verbs. */
  setup: {
    auth: "qr",
    /**
     * Point the session store at one account before any QR verb runs.
     *
     * `lifecycle/start-account.ts` does this too, but a profile that is not
     * linked yet FAILS the start (D-ZU-020) — which is exactly when the QR
     * verbs are used. Without this the freshly scanned credentials would live
     * only in the in-process cache and the next account start would hydrate an
     * empty store and report "not linked" again.
     */
    bindAccountSession: async ({ accountId }: { accountId: string }): Promise<void> => {
      installZalouserSessionStore(
        accountId,
        createHostRuntimeSessionStore({ hostRuntime: getHostRuntime(), accountId }),
      );
      await hydrateZalouserSessions(accountId);
    },
    // Every verb names the account it is linking. The Hub calls
    // `bindAccountSession` first and passes only `{profile}`
    // (`supervisor/qr-login.ts`), so the account defaults to the one just
    // bound; a caller that names one wins. Without this a relink of a profile
    // ANOTHER account also holds (`ZALOUSER_PROFILE`, or the same authored
    // `profile`) wrote the new session into that account's encrypted store,
    // because the key already had a cache holding it.
    startQrLogin: (params: QrLoginParams) => startZalouserQrLogin(accountScoped(params)),
    pollQrLogin: (params: QrLoginParams) => pollZalouserQrLogin(accountScoped(params)),
    cancelQrLogin: (params: QrLoginParams) => cancelZalouserQrLogin(accountScoped(params)),
    relinkQrLogin: (params: QrLoginParams) =>
      startZalouserQrLogin({ ...accountScoped(params), relink: true }),
    logout: (params: QrLoginParams) => logoutZalouser(accountScoped(params)),
  },
  gateway: {
    startAccount: (ctx) =>
      startZalouserAccount(ctx, (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime()),
  },
  // The shared `ChannelPlugin.directory` slot types only `resolveConversation`;
  // group-member listing is this vertical's own surface, so it rides the open
  // key set (HUB-WIRING.md §8).
  directoryMembers: {
    listGroupMembers: listZalouserDirectoryGroupMembers,
  },
  outbound: {
    sendText,
    sendMedia,
    // The ported Zalo Personal primitives, by their upstream names.
    sendMessageZalouser,
    sendImageZalouser,
    sendLinkZalouser,
    sendReactionZalouser,
    sendTypingZalouser,
    sendDeliveredZalouser,
    sendSeenZalouser,
    listZaloFriendsMatching,
    listZaloGroupsMatching,
    listZaloGroupMembers,
    probeZalouser,
  },
};

export { startZalouserAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText } from "./outbound.js";
