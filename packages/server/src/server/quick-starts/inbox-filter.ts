import { getBotIdFromLabels } from "@clisbot/protocol/bots/labels";
import type { AgentSnapshotPayload, SessionInboundMessage } from "../messages.js";
type Request = Extract<SessionInboundMessage, { type: "fetch_agent_history_request" }>;
/** Filter before search/cursors, so Load more and empty results describe the entire history. */
export function filterInboxCandidates(
  agents: AgentSnapshotPayload[],
  request: SessionInboundMessage,
) {
  if (request.type !== "fetch_agent_history_request" || !request.activityFilter) return agents;
  return agents.filter((agent) => matchesInboxFilter(agent, request.activityFilter!));
}
export function matchesInboxFilter(
  agent: Pick<AgentSnapshotPayload, "labels" | "updatedAt">,
  filter: NonNullable<Request["activityFilter"]>,
) {
  if (filter.kind && (filter.kind === "bot") !== !!getBotIdFromLabels(agent.labels)) return false;
  if (filter.updatedAfter && new Date(agent.updatedAt).getTime() < Date.parse(filter.updatedAfter))
    return false;
  return true;
}
