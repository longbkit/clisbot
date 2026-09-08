// Fusion-owned host adapter for `src/infra/outbound/deliver.ts` (D-CORE-030).
//
// Upstream's facade runs the whole core delivery queue (planning, queueing,
// transports, durable-final requirements). Fusion's Hub owns durable delivery,
// so only the two payload/deps contracts the ported action layer names are
// carried; both already exist under this root.
export type { OutboundSendDeps } from "./send-deps.js";
export type { OutboundDeliveryResult } from "./deliver-types.js";

/**
 * One outbound payload after core normalization. Upstream declares it in
 * `./payloads.ts` together with the payload planner the Hub replaces.
 */
export type NormalizedOutboundPayload = {
  text: string;
  mediaUrls: string[];
  audioAsVoice?: boolean;
  presentation?: unknown;
  delivery?: unknown;
  channelData?: Record<string, unknown>;
  location?: unknown;
  /** Hook-only content for audio-only TTS payloads. Never used as channel text/caption. */
  hookContent?: string;
  /** Preserves the status/answer distinction through delivery hooks. */
  isStatusNotice?: boolean;
};
