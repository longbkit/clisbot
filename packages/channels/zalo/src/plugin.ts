// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `zaloPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the members the Hub reads, `outbound` exposes the ported Zalo Bot API
// primitives by their upstream names so the message-action runner can dispatch
// without re-deriving a send path.

import type { ChannelPlugin, HostRuntime } from "@clisbot/channels-shared";
import {
  deleteWebhook,
  getMe,
  getUpdates,
  getWebhookInfo,
  sendChatAction,
  sendMessage,
  sendPhoto,
  setWebhook,
} from "./api.js";
import { zaloChannelActions } from "./channel-actions.js";
import { startZaloAccount } from "./lifecycle/start-account.js";
import { sendMedia, sendText } from "./outbound.js";
import { probeZalo } from "./probe.js";
import { getHostRuntime } from "./runtime-store.js";
import { sendMessageZalo } from "./send.js";
import { zaloTyping } from "./typing.js";

export const zaloPlugin: ChannelPlugin = {
  /** Message-tool discovery, schema contributions and the native
   * `handleAction` dispatcher. */
  actions: zaloChannelActions,
  messageActions: zaloChannelActions,
  gateway: {
    startAccount: (ctx) =>
      startZaloAccount(ctx, (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime()),
  },
  outbound: {
    sendText,
    // The Bot API has no upload endpoint; `outbound.ts` refuses loudly.
    sendMedia,
    // The `sync.progress` liveness surface: `sendChatAction("typing")` while a turn runs.
    typing: async (args: Record<string, unknown>) => {
      await zaloTyping(args as never);
    },
    // The ported Zalo Bot API primitives, by their upstream names.
    sendMessageZalo,
    sendMessage,
    sendPhoto,
    sendChatAction,
    getMe,
    getUpdates,
    setWebhook,
    deleteWebhook,
    getWebhookInfo,
    probeZalo,
  },
};

export { startZaloAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText } from "./outbound.js";
