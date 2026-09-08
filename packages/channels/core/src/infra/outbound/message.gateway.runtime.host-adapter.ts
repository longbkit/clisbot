// Fusion-owned host adapter for `src/infra/outbound/message.gateway.runtime.ts` (D-CORE-043).
//
// Upstream lazily loads the OpenClaw Gateway RPC client so a `gateway`-mode
// channel action executes in the process that holds the live account state.
// Fusion runs the account inside the Hub supervisor, so there is no second
// process to call: `gateway` execution mode resolves locally and reaching this
// module is a bug, not a fallback. `randomIdempotencyKey` is a pure helper and is
// carried so the key shape stays identical.
import { randomUUID } from "node:crypto";

export async function callGatewayLeastPrivilege<T>(_params: unknown): Promise<T> {
  throw new Error(
    "Gateway-mode message delivery is not available in Fusion; the Hub runs the channel account itself.",
  );
}

/** Upstream narrows a transport failure so the caller can inspect `error.kind`. */
export type GatewayTransportError = Error & { kind?: "timeout" | "closed" | "protocol" };

export function isGatewayTransportError(error: unknown): error is GatewayTransportError {
  return error instanceof Error && typeof (error as GatewayTransportError).kind === "string";
}

export function randomIdempotencyKey(): string {
  return randomUUID();
}
