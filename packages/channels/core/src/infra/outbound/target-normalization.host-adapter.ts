// Fusion-owned host adapter for `src/infra/outbound/target-normalization.ts` (D-CORE-034).
//
// Upstream canonicalizes a provider target through the loaded plugin's
// `messaging.normalizeTarget`, reading the process plugin registry and its
// generation counter. Fusion reads the same hook off the plugin the Hub
// registered; an unknown channel leaves the target untouched, as upstream does.
import { getChannelPlugin } from "../../channels/plugins/message-action-discovery.host-adapter.js";

export function normalizeTargetForProvider(channel: string, target: string): string | undefined {
  const normalize = getChannelPlugin(channel)?.messaging?.normalizeTarget;
  return normalize ? normalize(target) : target;
}
