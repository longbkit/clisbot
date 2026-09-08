// Fusion-owned host adapter for `src/config/sessions/session-accessor.ts` (D-CORE-047).
//
// Reads one entry from OpenClaw's session store. Fusion has no such store; see
// `config/sessions.host-adapter.ts` for the boundary.
export type SessionEntryReadOnly = {
  ttsAuto?: "off" | "on" | "reply";
  [key: string]: unknown;
};

export function loadSessionEntryReadOnly(_params: {
  agentId?: string;
  sessionKey: string;
  storePath?: string;
}): SessionEntryReadOnly | undefined {
  return undefined;
}
