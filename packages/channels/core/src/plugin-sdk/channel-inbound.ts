// upstream: src/plugin-sdk/channel-inbound.ts@5d8067a4483
// Inbound channel contracts reused by outbound senders (locations, partial delivery).
export {
  formatLocationText,
  normalizeOutboundLocation,
  type OutboundLocation,
} from "../channels/location.js";
export {
  createChannelPartialDeliveryError,
  isChannelPartialDeliveryError,
  type ChannelPartialDeliveryError,
} from "../channels/turn/delivery-result.js";
// D-CORE-229: the upstream barrel is the whole inbound pipeline (envelopes,
// debounce, mention gating, classification, channel-turn execution, hook types).
// The Hub owns inbound admission and turn execution in Fusion (goal slices 1-3,
// 8); only the location contract and the partial-delivery error the ported
// senders raise are carried.

// Slice 20 additions (Telegram inbound port): the ported inbound body helpers
// and message cache read the location and plugin-media input contracts from the
// same upstream barrel.
export type { NormalizedLocation, LocationSource } from "../channels/location.js";
export type {
  ChannelInboundMediaInput,
  MediaPlaceholderTextFact,
} from "../channels/inbound-event/media.js";
