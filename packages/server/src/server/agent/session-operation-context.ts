import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionOperationIdentity } from "./session-authorship.js";

// Only trusted daemon entrypoints establish this scope. It never crosses provider echoes.
export interface SessionOperationContext extends SessionOperationIdentity {
  receivedAt?: string;
}
const operations = new AsyncLocalStorage<SessionOperationContext>();
export function currentSessionOperationIdentity(): SessionOperationContext | undefined {
  return operations.getStore();
}
export function withSessionOperationIdentity<T>(
  identity: SessionOperationContext,
  operation: () => T,
): T {
  return operations.run(
    structuredClone({ ...identity, receivedAt: identity.receivedAt ?? new Date().toISOString() }),
    operation,
  );
}
