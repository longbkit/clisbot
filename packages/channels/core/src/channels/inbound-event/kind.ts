// upstream: src/channels/inbound-event/kind.ts@5d8067a4483
/**
 * High-level inbound event class used to separate actionable user requests from room activity.
 */
export type InboundEventKind = "user_request" | "room_event";
