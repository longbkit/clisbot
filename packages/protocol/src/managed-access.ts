import { z } from "zod";

/** Daemon-owned policy. `off` preserves ordinary Paseo trust. */
export const ManagedAccessModeSchema = z.enum(["off", "external"]);
export type ManagedAccessMode = z.infer<typeof ManagedAccessModeSchema>;

export const MutableManagedAccessConfigSchema = z
  .object({ mode: ManagedAccessModeSchema })
  .strict();
export type MutableManagedAccessConfig = z.infer<typeof MutableManagedAccessConfigSchema>;

/**
 * Close code for sockets replaced by a newer connection from the same client (a fresh ticket, or
 * another window sharing its client id). The session itself continues on the new connection. It is
 * not a revocation: the client keeps its Hub binding and does not reconnect, so two windows never
 * take the session back and forth.
 */
export const MANAGED_SESSION_SUPERSEDED_CLOSE_CODE = 4409;
export const MANAGED_SESSION_SUPERSEDED_REASON = "Session continued in another connection";

/**
 * Close code asking this client to reconnect with a fresh ticket after Hub authority changed. Not a
 * revocation: the session stays in reconnect grace so the new hello rebinds admission in place.
 * Reason text avoids the client's "managed access" revoke matcher so older clients still redial.
 */
export const MANAGED_ACCESS_REBIND_CLOSE_CODE = 4410;
export const MANAGED_ACCESS_REBIND_REASON = "Session continued with updated admission";

/**
 * Close code for a hello the Host could not admit because the Hub was unreachable or failed (network
 * error, timeout, 5xx, 408, 429). Not a revocation: the client keeps the Host and reconnects with a
 * fresh ticket. Reason text avoids the client's revoke matcher so older clients also redial.
 */
export const MANAGED_ACCESS_UNAVAILABLE_CLOSE_CODE = 4503;
export const MANAGED_ACCESS_UNAVAILABLE_REASON = "Hub admission temporarily unavailable";

/**
 * A Hub answer that settles admission (a 4xx other than 408/429, read from `statusCode` or
 * `status`). Network errors, timeouts and 5xx carry no such status and are worth a retry.
 */
export function isDefinitiveAdmissionDenial(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  const code = typeof statusCode === "number" ? statusCode : status;
  return typeof code === "number" && code >= 400 && code < 500 && code !== 408 && code !== 429;
}
