// upstream: src/plugin-sdk/gateway-runtime.ts@5d8067a4483
// D-CORE-401: upstream's barrel re-exports the whole OpenClaw gateway client
// surface (CLI RPC, node registry, capability tokens, startup auth, the gateway
// client itself). Fusion's Hub owns every one of those; the only member the
// ported channel source reads is the channel status-patch factory family, so
// this barrel keeps just that group and drops the rest.
export {
  channelBlockedPatch,
  channelReadyPatch,
  channelStoppedPatch,
  createConnectedChannelStatusPatch,
  createTransportActivityStatusPatch,
} from "../gateway/channel-status-patches.js";
