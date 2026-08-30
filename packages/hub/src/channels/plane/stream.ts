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
  | { kind: "turn_started"; turnId: string }
  | { kind: "timeline"; item: AgentStreamTimelineItem; turnId: string }
  | { kind: "turn_completed"; turnId: string }
  | { kind: "turn_closed"; turnId: string };

/**
 * The relay scope of a timeline item: the root agent's own timeline, or one of
 * its subagents (Task tool) — whose text rides the separate
 * `agent.provider_subagents.update` wire frame (the `provider_subagents`
 * client capability), never the root `agent_stream`. The scope keys the
 * relay's state + ledger so root and subagent posts never mix, and renders
 * the subagent post prefix.
 */
export type StreamScope =
  | { kind: "root" }
  | { kind: "subagent"; subagentId: string; label: string | null };

/** The root agent's own timeline scope. */
export const ROOT_SCOPE: StreamScope = { kind: "root" };

/** A subagent wire frame narrowed to the shapes the relay consumes. */
export type SubagentStreamEvent =
  | {
      kind: "upsert";
      parentAgentId: string;
      subagentId: string;
      /** The subagent's display label (title, falling back to description). */
      label: string | null;
      status: string;
    }
  | {
      kind: "timeline";
      parentAgentId: string;
      subagentId: string;
      item: AgentStreamTimelineItem;
    }
  | { kind: "remove"; parentAgentId: string; subagentId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The upsert's display label: the title, falling back to the description. */
function subagentLabel(title: unknown, description: unknown): string | null {
  if (typeof title === "string" && title !== "") return title;
  if (typeof description === "string" && description !== "") return description;
  return null;
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

/**
 * A `agent.provider_subagents.update` wire frame narrowed to the subagent
 * shapes the relay consumes, or undefined when the frame is not one of them.
 * `upsert` is remembered for its label only (no relay post); `timeline` maps
 * the row's item into the same `AgentStreamTimelineItem` union the root
 * timeline uses; `remove` ends the subagent's scope state.
 */
export function asSubagentEvent(frame: unknown): SubagentStreamEvent | undefined {
  if (!isRecord(frame) || frame["type"] !== "agent.provider_subagents.update") return undefined;
  const payload = frame["payload"];
  if (!isRecord(payload)) return undefined;
  switch (payload["kind"]) {
    case "upsert": {
      const subagent = payload["subagent"];
      if (!isRecord(subagent)) return undefined;
      const parentAgentId = subagent["parentAgentId"];
      const subagentId = subagent["id"];
      if (typeof parentAgentId !== "string" || typeof subagentId !== "string") return undefined;
      const title = subagent["title"];
      const description = subagent["description"];
      const status = subagent["status"];
      return {
        kind: "upsert",
        parentAgentId,
        subagentId,
        label: subagentLabel(title, description),
        status: typeof status === "string" ? status : "running",
      };
    }
    case "timeline": {
      const parentAgentId = payload["parentAgentId"];
      const subagentId = payload["subagentId"];
      const item = payload["item"];
      if (typeof parentAgentId !== "string" || typeof subagentId !== "string" || !isRecord(item))
        return undefined;
      return { kind: "timeline", parentAgentId, subagentId, item: item as AgentStreamTimelineItem };
    }
    case "remove": {
      const parentAgentId = payload["parentAgentId"];
      const subagentId = payload["subagentId"];
      if (typeof parentAgentId !== "string" || typeof subagentId !== "string") return undefined;
      return { kind: "remove", parentAgentId, subagentId };
    }
    default:
      return undefined;
  }
}

/** A wire event narrowed to a relay-consumable shape, or undefined when the
 * event is not one the relay acts on (turn_started, attention, unknown). */
export function asRelayedEvent(event: unknown): RelayedStreamEvent | undefined {
  if (!isRecord(event)) return undefined;
  const turnId = typeof event["turnId"] === "string" ? event["turnId"] : "";
  switch (event["type"]) {
    // The turn-open signal: the only thing that can start a liveness surface
    // (the `sync.progress` typing indicator / reaction). It carries no text, so
    // it never entered the relay before the typing seam existed.
    case "turn_started":
      return { kind: "turn_started", turnId };
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
