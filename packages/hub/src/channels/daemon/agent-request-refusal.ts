/**
 * The daemon keys every channel prompt by its message id and keeps a receipt
 * (`packages/server/src/server/agent/requests/index.ts`). Two of its refusals
 * are answers about that receipt, not faults, and a replay of the same message
 * gets the same answer every time:
 *
 * - `agent_request_key_conflict`: the key already names a different request.
 * - `agent_request_outcome_unknown`: an earlier attempt may have reached the
 *   Agent and the daemon cannot confirm it did not.
 *
 * The ingress dead-letters a message refused this way instead of retrying it
 * (`ingress/non-retryable.ts`). It never resends under a new key: after
 * `outcome_unknown` the Agent may already have the message, so resending is the
 * sender's call.
 */
const AGENT_REQUEST_REFUSALS = [
  "agent_request_key_conflict",
  "agent_request_outcome_unknown",
] as const;

export type AgentRequestRefusal = (typeof AGENT_REQUEST_REFUSALS)[number];

export class AgentRequestRefusedError extends Error {
  readonly code: AgentRequestRefusal;

  constructor(code: AgentRequestRefusal) {
    super(code);
    this.name = "AgentRequestRefusedError";
    this.code = code;
  }
}

function isAgentRequestRefusal(error: string): error is AgentRequestRefusal {
  return (AGENT_REQUEST_REFUSALS as readonly string[]).includes(error);
}

/** The error a declined `send_agent_message_request` throws. */
export function agentMessageRejection(error: string | undefined): Error {
  if (error !== undefined && isAgentRequestRefusal(error)) {
    return new AgentRequestRefusedError(error);
  }
  return new Error(error ?? "agent message rejected");
}
