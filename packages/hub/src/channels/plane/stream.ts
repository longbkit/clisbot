// Stream-event narrowing at the wire boundary (plan §4-S3 one code path). The
// trusted-client socket hands each agent stream event to the plane as `unknown`
// (`daemon/ws-client.ts` `onStream`), and the declared `AgentStreamEvent` union
// ends in a `{ type: string; [key]: unknown }` catch-all that defeats TypeScript
// discriminant narrowing — a `switch` on `event.type` would leave `event.item` /
// `event.request` as `unknown`. So the plane narrows the wire `unknown` here, in
// one place, into the typed shapes the relay and the approval engine consume.
// The facade's `onStreamEvent` is the single consumer: it asks these guards what
// each event is, then routes to the approval engine or the relay.
import type { AgentPermissionRequest, AgentStreamTimelineItem } from "../daemon/types.js";

/** A wire stream event narrowed to the shapes the relay consumes. */
export type RelayedStreamEvent =
  | { kind: "timeline"; item: AgentStreamTimelineItem; turnId: string }
  | { kind: "turn_completed"; turnId: string }
  | { kind: "turn_closed"; turnId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The request of a `permission_requested` wire event, or undefined. */
export function asPermissionRequest(event: unknown): AgentPermissionRequest | undefined {
  if (!isRecord(event) || event["type"] !== "permission_requested") return undefined;
  const request = event["request"];
  if (!isRecord(request) || typeof request["id"] !== "string") return undefined;
  return request as unknown as AgentPermissionRequest;
}

/** The request id of a `permission_resolved` wire event, or undefined. */
export function asPermissionResolved(event: unknown): string | undefined {
  if (!isRecord(event) || event["type"] !== "permission_resolved") return undefined;
  const requestId = event["requestId"];
  return typeof requestId === "string" ? requestId : undefined;
}

/** A wire event narrowed to a relay-consumable shape, or undefined when the
 * event is not one the relay acts on (turn_started, attention, unknown). */
export function asRelayedEvent(event: unknown): RelayedStreamEvent | undefined {
  if (!isRecord(event)) return undefined;
  const turnId = typeof event["turnId"] === "string" ? event["turnId"] : "";
  switch (event["type"]) {
    case "timeline": {
      const item = event["item"];
      if (!isRecord(item)) return undefined;
      return { kind: "timeline", item: item as AgentStreamTimelineItem, turnId };
    }
    case "turn_completed":
      return { kind: "turn_completed", turnId };
    case "turn_failed":
    case "turn_canceled":
      return { kind: "turn_closed", turnId };
    default:
      return undefined;
  }
}
