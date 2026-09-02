import { z } from "zod";

/** Daemon-owned policy. `off` preserves ordinary Paseo trust. */
export const ManagedAccessModeSchema = z.enum(["off", "external"]);
export type ManagedAccessMode = z.infer<typeof ManagedAccessModeSchema>;

export const MutableManagedAccessConfigSchema = z
  .object({ mode: ManagedAccessModeSchema })
  .strict();
export type MutableManagedAccessConfig = z.infer<typeof MutableManagedAccessConfigSchema>;
