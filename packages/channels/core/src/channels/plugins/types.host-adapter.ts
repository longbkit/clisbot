// Fusion-owned host adapter for the internal `src/channels/plugins/types.ts`
// barrel (D-CORE-010, same boundary as `types.public.ts`).
//
// Upstream's internal barrel re-exports `types.core.ts` / `types.plugin.ts`;
// the port takes the message-action subset from `types.public.host-adapter.ts`.
export type {
  ChannelMessageActionContext,
  ChannelMessageActionName,
  ChannelPlugin,
} from "./types.public.host-adapter.js";
