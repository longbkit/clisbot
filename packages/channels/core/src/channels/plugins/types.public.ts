// upstream: src/channels/plugins/types.public.ts@5d8067a4483
/**
 * Public channel plugin type barrel.
 *
 * Re-exports stable plugin-facing channel types and message action names.
 */
import type { ChannelMessageActionName as ChannelMessageActionNameFromList } from "./message-action-names.js";

export { CHANNEL_MESSAGE_ACTION_NAMES } from "./message-action-names.js";
// D-CORE-010: upstream re-exports the plugin type universe from `./types.core.js`,
// `./types.adapters.js` and `./types.plugin.js`; the port stops at that host
// boundary and takes the message-tool subset from the adapter instead.
export type {
  ChannelActionReplyPayload,
  ChannelId,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMessageActionDiscoveryContext,
  ChannelMessageActionTargetAliasSpec,
  ChannelMessageToolDiscovery,
  ChannelMessageToolSchemaContribution,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelReplyTransport,
  ChannelThreadingAdapter,
  ChannelThreadingContext,
  ChannelThreadingToolContext,
  ChannelToolSend,
  OpenClawConfig,
} from "./types.public.host-adapter.js";
export type { ChannelMessageCapability } from "./message-capabilities.js";

/** Stable message action name union derived from the registered action list. */
export type ChannelMessageActionName = ChannelMessageActionNameFromList;
