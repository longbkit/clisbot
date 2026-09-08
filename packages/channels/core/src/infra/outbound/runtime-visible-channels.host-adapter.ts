// Fusion-owned host adapter for `src/infra/outbound/runtime-visible-channels.ts` (D-CORE-036).
//
// Upstream filters the process plugin registry by the current Gateway request
// scope so a scoped client cannot broadcast into channels it may not see. Fusion
// scopes visibility at the Hub (organization + grants) before the tool exists,
// so every registered plugin is visible to the call that reached core.
import {
  getChannelPlugin,
  listChannelPlugins,
} from "../../channels/plugins/message-action-discovery.host-adapter.js";
import type { ChannelPlugin } from "../../channels/plugins/types.public.js";

export function getRuntimeVisibleChannelPlugin(channel: string): ChannelPlugin | undefined {
  return getChannelPlugin(channel);
}

export function listRuntimeVisibleChannelPlugins(): readonly ChannelPlugin[] {
  return listChannelPlugins();
}
