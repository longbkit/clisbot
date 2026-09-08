// upstream: extensions/telegram/src/send.runtime.ts@5d8067a4483
// Telegram plugin module implements send behavior.
export { requireRuntimeConfig } from "@getpaseo/channels-core/plugin-sdk/plugin-config-runtime";
export { resolveMarkdownTableMode } from "@getpaseo/channels-core/plugin-sdk/markdown-table-runtime";
export type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
export type { PollInput } from "@getpaseo/channels-core/plugin-sdk/media-runtime";
export {
  buildOutboundMediaLoadOptions,
  getImageMetadata,
  normalizePollInput,
  probeVideoDimensions,
} from "@getpaseo/channels-core/plugin-sdk/media-runtime";
export { loadWebMedia } from "@getpaseo/channels-core/plugin-sdk/web-media";
