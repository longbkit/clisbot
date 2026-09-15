import { z } from "zod";

/** Daemon-owned policy. `off` preserves ordinary Paseo trust. */
export const ManagedAccessModeSchema = z.enum(["off", "external"]);
export type ManagedAccessMode = z.infer<typeof ManagedAccessModeSchema>;

export const MutableManagedAccessConfigSchema = z
  .object({ mode: ManagedAccessModeSchema })
  .strict();
export type MutableManagedAccessConfig = z.infer<typeof MutableManagedAccessConfigSchema>;

/**
 * Close code for a managed session replaced by a newer connection from the same client (a fresh
 * ticket, or another window sharing its client id). It is not a revocation: the client keeps its
 * Hub binding and does not reconnect, so two windows never take the session back and forth.
 */
export const MANAGED_SESSION_SUPERSEDED_CLOSE_CODE = 4409;
export const MANAGED_SESSION_SUPERSEDED_REASON = "Session continued in another connection";
