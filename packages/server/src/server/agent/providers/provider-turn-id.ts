import { randomUUID } from "node:crypto";

/**
 * A new turn id for a provider session. A resumed session (idle close, daemon
 * restart, reload) is a new runtime for the same agent and writes into the same
 * channel delivery ledger, which is keyed by agent and turn id. A process-local
 * counter would hand a new turn an id an earlier runtime already delivered, and
 * the Hub would skip the new answer as a replay (#40). Events of one turn keep
 * the id they were given, so a true replay still deduplicates.
 */
export function createProviderTurnId(prefix: string): string {
  return `${prefix}-turn-${randomUUID()}`;
}
