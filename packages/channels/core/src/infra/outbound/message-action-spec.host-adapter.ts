// Fusion-owned host adapter for `src/infra/outbound/message-action-spec.ts` (D-CORE-016).
//
// Upstream reads plugin-declared target aliases from the OpenClaw bootstrap
// plugin registry. Fusion serves the same lookup from the channel plugins the
// Hub registered, so alias resolution stays data-driven instead of hardcoded.
import { getChannelPlugin } from "../../channels/plugins/message-action-discovery.host-adapter.js";
import type { ChannelPlugin } from "../../channels/plugins/types.public.host-adapter.js";

/** Returns the registered plugin for alias lookups, or undefined when unknown. */
export function getBootstrapChannelPlugin(channel: string): ChannelPlugin | undefined {
  return getChannelPlugin(channel);
}
