// upstream: extensions/discord/src/actions/runtime.messaging.runtime.ts@5d8067a4483
// D-DC-004: the `voice_message` action is omitted with `send.voice.ts` /
// `voice-message.ts` (ffmpeg + opus transcoding, @discordjs/voice).
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
// Discord plugin module implements runtime.messaging behavior.
import { readDiscordComponentSpec } from "../components.js";
import { sendDiscordComponentMessage } from "../send.components.js";
import {
  createThreadDiscord,
  deleteMessageDiscord,
  editMessageDiscord,
  editChannelDiscord,
  fetchChannelInfoDiscord,
  fetchGuildInfoDiscord,
  fetchChannelPermissionsDiscord,
  fetchMessageDiscord,
  fetchReactionsDiscord,
  listPinsDiscord,
  listThreadsDiscord,
  pinMessageDiscord,
  reactMessageDiscord,
  readMessagesDiscord,
  removeOwnReactionsDiscord,
  removeReactionDiscord,
  searchMessagesDiscord,
  sendMessageDiscord,
  sendStickerDiscord,
  unpinMessageDiscord,
} from "../send.js";
import { resolveDiscordTargetChannelId } from "../send.shared.js";
import { resolveDiscordChannelId } from "../targets.js";

export const discordMessagingActionRuntime = {
  createThreadDiscord,
  deleteMessageDiscord,
  editChannelDiscord,
  editMessageDiscord,
  fetchChannelInfoDiscord,
  fetchGuildInfoDiscord,
  fetchChannelPermissionsDiscord,
  fetchMessageDiscord,
  fetchReactionsDiscord,
  listPinsDiscord,
  listThreadsDiscord,
  pinMessageDiscord,
  reactMessageDiscord,
  readDiscordComponentSpec,
  readMessagesDiscord,
  removeOwnReactionsDiscord,
  removeReactionDiscord,
  resolveDiscordReactionTargetChannelId,
  resolveDiscordChannelId,
  searchMessagesDiscord,
  sendDiscordComponentMessage,
  sendMessageDiscord,
  sendStickerDiscord,
  // D-DC-004: `sendVoiceMessageDiscord` omitted with `send.voice.ts`.
  unpinMessageDiscord,
};

async function resolveDiscordReactionTargetChannelId(params: {
  target: string;
  cfg: OpenClawConfig;
  accountId?: string;
}): Promise<string> {
  try {
    return resolveDiscordChannelId(params.target);
  } catch {
    return (
      await resolveDiscordTargetChannelId(params.target, {
        cfg: params.cfg,
        accountId: params.accountId,
      })
    ).channelId;
  }
}
