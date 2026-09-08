// Fusion-owned host adapter for `src/gateway/message-action-turn-capability.ts` (D-CORE-050).
//
// Upstream issues a per-turn capability inside the Gateway that proves which
// conversation and sender the current agent turn may act as, and reads it back
// from an async-local store during tool execution. Fusion issues that authority
// as the Hub's channel reply capability, resolved from the MCP URL before the
// call reaches core, so the ambient lookup here reports "no ambient turn".

import type { ChannelThreadingToolContext } from "../channels/plugins/types.public.js";

/** The trusted per-turn facts upstream attaches to a running agent turn. */
export type AgentRuntimeMessageActionContext = {
  requesterAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  toolContext?: ChannelThreadingToolContext & { currentSourceTurnId?: string };
};

export function getAgentRuntimeMessageActionContext():
  | AgentRuntimeMessageActionContext
  | undefined {
  return undefined;
}

export function hasAgentRuntimeMessageActionContext(): boolean {
  return false;
}
