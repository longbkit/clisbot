// Fusion-owned host adapter for `src/audit/message-action-decision.ts` (D-CORE-026).
//
// Upstream appends every allow/deny decision to OpenClaw's audit log file. Fusion
// records outbound authority decisions in the Hub (delivery ledger + failure
// reporting), so the core hook is a sink the host installs.

export type MessageActionDecisionRecord = Record<string, unknown>;

let sink: ((record: MessageActionDecisionRecord) => void) | undefined;

/** Installs the Hub's audit sink; without one, decisions are not duplicated. */
export function setMessageActionDecisionSink(
  next: ((record: MessageActionDecisionRecord) => void) | undefined,
): void {
  sink = next;
}

export function recordMessageActionDecision(record: MessageActionDecisionRecord): void {
  sink?.(record);
}
