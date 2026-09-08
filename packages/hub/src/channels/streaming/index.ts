// The Hub-side streaming producer (goal ledger slice 22b). The relay drives
// `ChannelStreamingProducer`; the supervisor builds the account's
// `ChannelStreamingDriver` from the loaded vertical's `plugin.outbound`.
export { createStreamingDriver, type StreamingDriverDeps } from "./driver.js";
export { ChannelStreamingProducer, type StreamingProducerDeps } from "./producer.js";
export type {
  ChannelProgressLine,
  ChannelStreamingDriver,
  ChannelStreamingMode,
  NativeDraftTransport,
  StreamingDraftTarget,
  StreamingFinalizeTransport,
  StreamingLimits,
} from "./types.js";
