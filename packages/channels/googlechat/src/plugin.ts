// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `googlechatPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the members the Hub reads, `outbound` exposes the ported Google Chat
// REST primitives by their upstream names so the message-action runner can
// dispatch without re-deriving a send path.

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { googlechatChannelActions } from "./channel-actions.js";
import { disposeGoogleChatRuntime } from "./fusion/runtime.js";
import { startGoogleChatAccount } from "./lifecycle/start-account.js";
import { deleteMessage, sendMedia, sendText, updateText } from "./outbound.js";
import { getHostRuntime } from "./runtime-store.js";
import {
  deleteGoogleChatMessage,
  downloadGoogleChatMedia,
  findGoogleChatDirectMessage,
  getGoogleChatSpace,
  probeGoogleChat,
  sendGoogleChatMessage,
  updateGoogleChatMessage,
} from "./api.js";

export const googlechatPlugin: ChannelPlugin = {
  /** Message-tool discovery, schema contributions and the native
   * `handleAction` dispatcher. */
  actions: googlechatChannelActions,
  messageActions: googlechatChannelActions,
  gateway: {
    startAccount: (ctx) =>
      startGoogleChatAccount(
        ctx,
        (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime(),
      ),
  },
  /** The Hub's loader calls this when it unloads this account's vertical: it
   * releases the account's ported plugin runtime (keyed stores, log sink). */
  disposeAccount: (accountId: string) => {
    disposeGoogleChatRuntime(accountId);
  },
  outbound: {
    sendText,
    // COMPAT(clisbot-control-plane): the approval card's in-place update.
    updateText,
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post. Google Chat
    // refuses it (service-account apps cannot upload); see `outbound.ts`.
    sendMedia,
    deleteMessage,
    // The ported Google Chat REST primitives, by their upstream names.
    sendGoogleChatMessage,
    updateGoogleChatMessage,
    deleteGoogleChatMessage,
    downloadGoogleChatMedia,
    findGoogleChatDirectMessage,
    getGoogleChatSpace,
    probeGoogleChat,
  },
};

export { startGoogleChatAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText, updateText } from "./outbound.js";
