// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `discordPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the members the Hub reads, `outbound` exposes the ported OpenClaw send
// primitives by their upstream names so the message-action runner can dispatch
// every native action without re-deriving a send path.

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { discordMessageActions } from "./channel-actions.js";
import { disposeDiscordRuntime } from "./fusion/runtime.js";
import { startDiscordAccount } from "./lifecycle/start-account.js";
import { discordTyping, sendMedia, sendText, updateText } from "./outbound.js";
import { getHostRuntime } from "./runtime-store.js";
import { buildDiscordInteractiveComponents } from "./shared-interactive.js";
import {
  addRoleDiscord,
  createChannelDiscord,
  createThreadDiscord,
  deleteMessageDiscord,
  editMessageDiscord,
  fetchChannelInfoDiscord,
  fetchGuildInfoDiscord,
  fetchMemberInfoDiscord,
  fetchReactionsDiscord,
  fetchRoleInfoDiscord,
  listGuildChannelsDiscord,
  listGuildEmojisDiscord,
  listPinsDiscord,
  listThreadsDiscord,
  pinMessageDiscord,
  reactMessageDiscord,
  readMessagesDiscord,
  removeReactionDiscord,
  removeRoleDiscord,
  searchMessagesDiscord,
  sendMessageDiscord,
  sendPollDiscord,
  sendStickerDiscord,
  sendTypingDiscord,
  sendWebhookMessageDiscord,
  unpinMessageDiscord,
  uploadEmojiDiscord,
  uploadStickerDiscord,
} from "./send.js";

export const discordPlugin: ChannelPlugin = {
  /** Message-tool discovery, schema contributions, target aliases and the
   * native `handleAction` dispatcher. */
  actions: discordMessageActions,
  gateway: {
    startAccount: (ctx) =>
      startDiscordAccount(ctx, (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime()),
  },
  /** The Hub's loader calls this when it unloads this account's vertical: it
   * releases the account's ported plugin runtime (keyed stores, log sink), which
   * the loader's own registries do not own. */
  disposeAccount: (accountId: string) => {
    disposeDiscordRuntime(accountId);
  },
  outbound: {
    sendText,
    // COMPAT(clisbot-control-plane): the approval card's in-place update.
    updateText,
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post.
    sendMedia,
    // COMPAT(clisbot-control-plane): the `sync.progress` liveness surface.
    typing: async (args: Record<string, unknown>) => {
      await discordTyping(args as never);
    },
    // The ported OpenClaw send primitives, by their upstream names. The
    // message-action runner dispatches `message` tool actions onto these.
    sendMessageDiscord,
    sendPollDiscord,
    sendStickerDiscord,
    sendWebhookMessageDiscord,
    sendTypingDiscord,
    editMessageDiscord,
    deleteMessageDiscord,
    readMessagesDiscord,
    searchMessagesDiscord,
    pinMessageDiscord,
    unpinMessageDiscord,
    listPinsDiscord,
    createThreadDiscord,
    listThreadsDiscord,
    reactMessageDiscord,
    removeReactionDiscord,
    fetchReactionsDiscord,
    listGuildEmojisDiscord,
    uploadEmojiDiscord,
    uploadStickerDiscord,
    createChannelDiscord,
    listGuildChannelsDiscord,
    fetchChannelInfoDiscord,
    fetchGuildInfoDiscord,
    fetchMemberInfoDiscord,
    fetchRoleInfoDiscord,
    addRoleDiscord,
    removeRoleDiscord,
    buildDiscordInteractiveComponents,
  },
};

export { startDiscordAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText, updateText } from "./outbound.js";
