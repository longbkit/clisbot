// @getpaseo/channels-discord — the in-repo Discord channel vertical (goal
// ledger slice 13). Exports:
// - `default` — the bundled-channel entry (`id: "discord"`);
// - `discordPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { discordPlugin, sendMedia, sendText, startDiscordAccount, updateText } from "./plugin.js";
export { installDiscordRuntime, disposeDiscordRuntime } from "./fusion/runtime.js";
export * from "./send.js";
export { discordMessageActions } from "./channel-actions.js";
export { handleDiscordMessageAction } from "./channel-actions.runtime.js";
export { setChannelHostRuntime, getHostRuntime, registerAccountInbound } from "./runtime-store.js";
export {
  assertNoDuplicateDiscordTokens,
  claimDiscordGateway,
  resolveDiscordIdentity,
} from "./lifecycle/start-account.js";
export {
  normalizeDiscordMessage,
  resolveDiscordGatewayIntents,
  runDiscordGateway,
} from "./transport/gateway.js";
export * from "./targets.js";
export * from "./normalize.js";
export { chunkDiscordTextWithMode } from "./chunk.js";
export { renderDiscordMarkdown } from "./markdown.js";
export { probeDiscord, parseApplicationIdFromToken } from "./probe.js";
export { resolveDiscordToken } from "./token.js";
export {
  listDiscordAccountIds,
  resolveDiscordAccount,
  resolveDiscordAccountConfig,
  mergeDiscordAccountConfig,
} from "./accounts.js";
