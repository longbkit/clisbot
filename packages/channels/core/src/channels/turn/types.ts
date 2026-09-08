// upstream: src/channels/turn/types.ts@5d8067a4483
// D-CORE-206: upstream declares the whole channel-turn contract here (turn
// lifecycle, delivery adapters, durable-final requirements, agent-run terminal
// outcomes, hook payloads). Fusion's Hub owns the turn lifecycle, so this file
// carries the delivery-result triple the ported channel senders read, verbatim
// from upstream, with the suppression reason union inlined instead of imported
// from `src/infra/outbound/payloads.ts`.
import type { MediaFact } from "../../media/media-facts.js";
import type { MessageReceipt } from "../message/types.js";

/** Outbound queue policy recorded on a deferred delivery intent. */
export type OutboundDeliveryQueuePolicy = "drop" | "queue" | "replace";

/** Intentional no-send reasons produced by outbound payload policy. */
export type OutboundPayloadDeliverySuppressionReason =
  | "empty_payload"
  | "duplicate_payload"
  | "policy_blocked"
  | "cancelled";

/** Durable delivery queue intent recorded when a reply is deferred. */
export type ChannelDeliveryIntent = {
  id: string;
  kind: "outbound_queue";
  queuePolicy: OutboundDeliveryQueuePolicy;
};

/** Provider-accepted outcome for one logical channel reply payload. */
export type ChannelDeliveryOutcome = {
  messageIds?: string[];
  receipt?: MessageReceipt;
  threadId?: string;
  replyToId?: string;
  visibleReplySent?: boolean;
  /** Final provider-visible text used for this logical payload's terminal observation. */
  content?: string;
};

/** Result returned after delivering one channel reply payload. */
export type ChannelDeliveryResult = ChannelDeliveryOutcome & {
  deliveryIntent?: ChannelDeliveryIntent;
  /** Intentional no-send outcome after payload policy or modifying hooks settle. */
  suppression?: {
    reason: OutboundPayloadDeliverySuppressionReason | "channel_transform" | "no_visible_result";
    cancelReason?: string;
    metadata?: Record<string, unknown>;
  };
  /** Same-payload native settlement; resolved fields override this result before observation. */
  finalization?: Promise<ChannelDeliveryOutcome>;
};

// Slice 20 addition (Telegram inbound port): the inbound attachment fact shape
// the ported Telegram body helpers and message cache are declared against,
// verbatim from the same upstream file.
/** Inbound media facts supplied to the agent context. */
export type InboundMediaFacts = Omit<MediaFact, "staged" | "workspaceDir">;
