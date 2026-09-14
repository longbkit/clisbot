import {
  AgentSnapshotPayloadSchema,
  type AgentSnapshotPayload,
  type SessionOutboundMessage,
} from "../messages.js";
import type { AgentPermissionRequest } from "./agent-sdk-types.js";

function projectRequest<T extends AgentPermissionRequest>(request: T): T {
  if (!request.metadata || !("paseoPermissionGeneration" in request.metadata)) return request;
  const metadata = { ...request.metadata };
  delete metadata.paseoPermissionGeneration;
  return { ...request, metadata };
}
function projectSnapshot<T extends AgentSnapshotPayload | null>(agent: T): T {
  if (!agent) return agent;
  const pendingPermissions = agent.pendingPermissions.map(projectRequest);
  if (pendingPermissions.every((request, index) => request === agent.pendingPermissions[index]))
    return agent;
  return { ...agent, pendingPermissions };
}
function projectAgent<T extends { payload: { agent: AgentSnapshotPayload | null } }>(
  message: T,
): T {
  const agent = projectSnapshot(message.payload.agent);
  return agent === message.payload.agent
    ? message
    : { ...message, payload: { ...message.payload, agent } };
}
function projectAgents<T extends { payload: { agents: AgentSnapshotPayload[] } }>(message: T): T {
  const agents = message.payload.agents.map(projectSnapshot);
  return agents.every((agent, index) => agent === message.payload.agents[index])
    ? message
    : { ...message, payload: { ...message.payload, agents } };
}

function projectAgentUpdate(
  message: Extract<SessionOutboundMessage, { type: "agent_update" }>,
): SessionOutboundMessage {
  if (message.payload.kind !== "upsert") return message;
  const agent = projectSnapshot(message.payload.agent);
  return agent === message.payload.agent
    ? message
    : { ...message, payload: { ...message.payload, agent } };
}
function projectStatus(
  message: Extract<SessionOutboundMessage, { type: "status" }>,
): SessionOutboundMessage {
  if (!message.payload.agent) return message;
  const parsed = AgentSnapshotPayloadSchema.safeParse(message.payload.agent);
  if (!parsed.success) return message;
  const agent = projectSnapshot(parsed.data);
  return agent === parsed.data ? message : { ...message, payload: { ...message.payload, agent } };
}
function projectStream<
  T extends Extract<
    SessionOutboundMessage,
    { type: "agent_stream" | "hub.execution.agent.stream" }
  >,
>(message: T): T {
  const event = message.payload.event;
  if (event.type !== "permission_requested") return message;
  const request = projectRequest(event.request);
  return request === event.request
    ? message
    : { ...message, payload: { ...message.payload, event: { ...event, request } } };
}

/** COMPAT(agent_session_storage): remove after the official client floor negotiates this capability (review 2027-03-11). */
export function withoutPermissionGeneration(
  message: SessionOutboundMessage,
): SessionOutboundMessage {
  switch (message.type) {
    case "fetch_agent_response":
    case "fetch_agent_timeline_response":
    case "cancel_agent_response":
    case "hub.execution.agent.create.response":
    case "hub.execution.agent.update":
      return projectAgent(message);
    case "status":
      return projectStatus(message);
    case "agent_update":
      return projectAgentUpdate(message);
    case "clear_agent_attention_response":
      return projectAgents(message);
    case "agent_status": {
      const info = projectSnapshot(message.payload.info);
      return info === message.payload.info
        ? message
        : { ...message, payload: { ...message.payload, info } };
    }
    case "wait_for_finish_response": {
      const final = projectSnapshot(message.payload.final);
      return final === message.payload.final
        ? message
        : { ...message, payload: { ...message.payload, final } };
    }
    case "fetch_agents_response":
    case "fetch_agent_history_response": {
      const entries = message.payload.entries.map((entry) => {
        const agent = projectSnapshot(entry.agent);
        return agent === entry.agent ? entry : { ...entry, agent };
      });
      return entries.every((entry, index) => entry === message.payload.entries[index])
        ? message
        : { ...message, payload: { ...message.payload, entries } };
    }
    case "agent_stream":
    case "hub.execution.agent.stream":
      return projectStream(message);
    default:
      return message;
  }
}
