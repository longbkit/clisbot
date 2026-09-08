// upstream: src/plugin-sdk/channel-send-result.ts@5d8067a4483
// Channel send result contracts normalize outbound delivery outcomes from channel plugins.

export type { ChannelOutboundAdapter } from "../channels/plugins/outbound.types.js";
// D-CORE-034: the upstream barrel also carries the legacy raw-send-result
// adapters (`attachChannelToResult(s)`, `createAttachedChannelResultAdapter`,
// poll results) over `OutboundDeliveryResult` from OpenClaw's `infra/outbound`
// delivery graph. Fusion's Hub owns delivery results; only the outbound adapter
// type the ported Slack presentation contract reads is carried.


// Slice 13 addition (Discord vertical port): the ported Discord receipt builder
// stamps the channel onto raw send results before normalizing them. Upstream
// declares both helpers in this same barrel over `OutboundDeliveryResult`; the
// bodies are unchanged, generic over the caller's result shape (D-CORE-034).

/** Attaches the channel id to one outbound send result. */
export function attachChannelToResult<T extends object>(
  /** Channel id to stamp onto the returned delivery result. */
  channel: string,
  /** Delivery-shaped result without channel metadata. */
  result: T,
) {
  return {
    ...result,
    channel,
  };
}

/** Attaches the channel id to each outbound send result in order. */
export function attachChannelToResults<T extends object>(
  /** Channel id to stamp onto every returned delivery result. */
  channel: string,
  /** Ordered delivery-shaped results without channel metadata. */
  results: readonly T[],
) {
  return results.map((result) => attachChannelToResult(channel, result));
}
