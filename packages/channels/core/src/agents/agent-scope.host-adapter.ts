// Fusion-owned host adapter for `src/agents/agent-scope.ts` (D-CORE-021).
//
// Upstream resolves the agent id and its workspace directory from OpenClaw's
// session store and agent config tree. The Hub already knows both facts when it
// builds a message-action input and passes them explicitly, so these hooks stay
// inert: an unresolved session key means "the caller did not supply one".

/** Upstream reads the session store; Fusion passes `agentId` on the input. */
export function resolveSessionAgentId(_params: {
  sessionKey: string;
  config: unknown;
}): string | undefined {
  return undefined;
}

/** Upstream reads the agent's configured workspace; the Hub passes `workspaceDir`. */
export function resolveAgentWorkspaceDir(_cfg: unknown, _agentId: string): string | undefined {
  return undefined;
}
