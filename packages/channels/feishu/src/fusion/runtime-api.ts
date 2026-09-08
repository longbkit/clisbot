// Fusion-owned replacement for the extension's private runtime barrel
// `extensions/feishu/runtime-api.ts` (D-FS-002).
//
// Upstream's barrel re-exports ~30 members from `openclaw/plugin-sdk/core`,
// `plugin-sdk/channel-status`, `plugin-sdk/channel-pairing`,
// `plugin-sdk/setup-runtime` and friends — the OpenClaw plugin host's whole
// surface, most of it for `channel.ts` / `setup-surface.ts`, which this vertical
// does not port (see upstream-sync.json `omitted`). The ported files here read
// a handful of members; every one of them comes from `@getpaseo/channels-core`,
// which carries the same upstream source modules.
//
// Import specifiers are the only thing the ported files change: every ported
// `import … from "../runtime-api.js"` was rewritten to this module.

export type { OpenClawConfig as ClawdbotConfig } from "@getpaseo/channels-core/plugin-sdk/core";
export type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/core";
export type { ChannelGroupContext } from "@getpaseo/channels-core/plugin-sdk/core";
export type { OutboundIdentity } from "@getpaseo/channels-core/plugin-sdk/channel-outbound";
export type { ReplyPayload } from "@getpaseo/channels-core/plugin-sdk/reply-payload";
export type { AnyAgentTool } from "@getpaseo/channels-core/agents/tools/common.host-adapter";
export type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
  PluginLogger,
  ToolFsPolicy,
} from "@getpaseo/channels-core/plugin-sdk/plugin-entry";

/** The runtime env a channel account's monitor receives (upstream's text). */
export type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
