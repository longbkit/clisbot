// upstream: extensions/discord/src/send.ts@5d8067a4483
// Discord plugin module implements send behavior.
export {
  createChannelDiscord,
  deleteChannelDiscord,
  editChannelDiscord,
  moveChannelDiscord,
  removeChannelPermissionDiscord,
  setChannelPermissionDiscord,
} from "./send.channels.js";
export {
  listGuildEmojisDiscord,
  uploadEmojiDiscord,
  uploadStickerDiscord,
} from "./send.emojis-stickers.js";
export {
  addRoleDiscord,
  banMemberDiscord,
  createScheduledEventDiscord,
  resolveEventCoverImage,
  fetchChannelInfoDiscord,
  fetchGuildInfoDiscord,
  fetchMemberInfoDiscord,
  fetchRoleInfoDiscord,
  fetchVoiceStatusDiscord,
  kickMemberDiscord,
  listGuildChannelsDiscord,
  listScheduledEventsDiscord,
  removeRoleDiscord,
  timeoutMemberDiscord,
} from "./send.guild.js";
export {
  createThreadDiscord,
  deleteMessageDiscord,
  DiscordThreadInitialMessageError,
  editMessageDiscord,
  fetchMessageDiscord,
  listPinsDiscord,
  listThreadsDiscord,
  pinMessageDiscord,
  readMessagesDiscord,
  searchMessagesDiscord,
  unpinMessageDiscord,
} from "./send.messages.js";
export { sendMessageDiscord, sendPollDiscord, sendStickerDiscord } from "./send.outbound.js";
export { sendWebhookMessageDiscord } from "./send.webhook.js";
// D-DC-004: `send.voice.ts` / `voice-message.ts` are omitted (ffmpeg/opus
// transcoding and the @discordjs/voice stack); the re-export goes with them.
export { sendTypingDiscord } from "./send.typing.js";
export {
  canViewDiscordGuildChannel,
  canManageGuildRoleDiscord,
  canManageGuildMemberRoleDiscord,
  fetchChannelPermissionsDiscord,
  hasAllGuildPermissionsDiscord,
  hasAnyChannelPermissionDiscord,
  hasAnyGuildPermissionDiscord,
  fetchMemberGuildPermissionsDiscord,
} from "./send.permissions.js";
export {
  fetchReactionsDiscord,
  reactMessageDiscord,
  removeOwnReactionsDiscord,
  removeReactionDiscord,
} from "./send.reactions.js";
export type {
  DiscordChannelCreate,
  DiscordChannelEdit,
  DiscordChannelMove,
  DiscordChannelPermissionSet,
  DiscordEmojiUpload,
  DiscordMessageEdit,
  DiscordMessageQuery,
  DiscordModerationTarget,
  DiscordReactionRuntimeContext,
  DiscordPermissionsSummary,
  DiscordReactionSummary,
  DiscordReactionUser,
  DiscordReactOpts,
  DiscordRuntimeAccountContext,
  DiscordRoleChange,
  DiscordSearchQuery,
  DiscordSendResult,
  DiscordStickerUpload,
  DiscordThreadCreate,
  DiscordThreadList,
  DiscordTimeoutTarget,
} from "./send.types.js";
export { DiscordSendError } from "./send.types.js";
