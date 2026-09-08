// upstream: src/plugin-sdk/channel-contract.ts@5d8067a4483
// Channel plugin contract types shared by bundled and third-party channels.
export type {
  ChannelId,
  ChannelMessageActionAdapter,
  ChannelMessageActionDiscoveryContext,
  ChannelMessageActionName,
  ChannelMessageToolDiscovery,
  ChannelMessageToolSchemaContribution,
  ChannelPlugin,
  ChannelThreadingContext,
  ChannelThreadingToolContext,
} from "../channels/plugins/types.public.js";
// D-CORE-212: the upstream barrel also re-exports the channel runtime surface,
// legacy state-migration and adapter type universe from
// `src/channels/plugins/channel-runtime-surface.types.ts`,
// `legacy-state-migration.types.ts` and `types.adapters.ts` — host lifecycle
// contracts the port stops at (D-CORE-010). `ChannelThreadingContext` is
// upstream's alias for the threading tool context.

// Slice 10b additions (Slack send/actions port): the ported Slack action and
// probe surfaces read these from the same upstream barrel.
export type {
  ChannelMessageActionContext,
  ChannelMessageActionTargetAliasSpec,
} from "../channels/plugins/types.public.js";
export type { BaseProbeResult, ChannelGroupContext, ChannelOutboundContext } from "../channels/plugins/channel-contract.host-adapter.js";


// Slice 13 addition (Discord vertical port): the base token-resolution shape the
// ported Discord `token.ts` extends, from upstream's `types.core.ts` (Fusion
// boundary `types.public.host-adapter.ts`).
export type { BaseTokenResolution } from "../channels/plugins/types.public.host-adapter.js";

// Slice 21 addition (Slack Bolt provider port): the monitor context type the
// ported Slack monitor tree reads for the plugin runtime surface.
export type {
  ChannelRuntimeContextRegistry,
  ChannelRuntimeSurface,
} from "../channels/plugins/channel-runtime-surface.types.js";

// Slice 20 addition (Telegram inbound port): the ported polling status publisher
// patches the account snapshot upstream re-exports from this barrel.
export type { ChannelAccountSnapshot } from "../channels/plugins/account-snapshot.types.js";

// Slice 17 addition (Zalo Personal vertical port): the ported `directory.ts`
// maps Zalo group members onto the directory entry shape upstream re-exports
// from this barrel.
export type {
  ChannelDirectoryEntry,
  ChannelDirectoryEntryKind,
} from "../channels/plugins/types.public.host-adapter.js";
