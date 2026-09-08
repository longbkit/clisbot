// Fusion-owned host adapter for the `src/utils/message-channel.ts` barrel (D-CORE-013).
//
// Upstream's barrel re-exports the normalizers together with gateway client-info
// types and the bundled-channel catalog reader. Only the two symbols below are
// used by the ported message-tool layer, and both come from the ported source
// modules underneath the barrel.
export {
  INTERNAL_MESSAGE_CHANNEL,
  isInternalNonDeliveryChannel,
} from "./message-channel-constants.js";
export { normalizeMessageChannel } from "./message-channel-core.js";
export {
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  normalizeGatewayClientMode,
  normalizeGatewayClientName,
} from "../gateway-protocol/client-info.js";
export type { GatewayClientMode, GatewayClientName } from "../gateway-protocol/client-info.js";
import { normalizeAnyChannelId } from "../channels/plugins/message-action-discovery.host-adapter.js";

/**
 * Upstream answers this from the generated bundled-channel id list plus the
 * registered plugin ids. Fusion has no generated list, so a registered plugin id
 * (or one of its aliases) is the deliverable set.
 */
export function isDeliverableMessageChannel(value: string): boolean {
  return normalizeAnyChannelId(value) !== null;
}
