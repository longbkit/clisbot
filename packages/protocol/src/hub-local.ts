import { z } from "zod";
import { HubDeviceOfferSchema } from "./device-pairing-offer.js";
import { TailscaleStateSchema } from "./host-tailscale.js";

// COMPAT(localHubStart): additive Host capability; older peers omit it.
export const HubLocalStartOptionsSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  transport: z.enum(["tailscale", "relay", "local", "https"]).optional(),
  publicUrl: z.string().max(2048).optional(),
});
export const HubLocalStartRequestSchema = HubLocalStartOptionsSchema.extend({
  type: z.literal("hub.local.start.request"),
  requestId: z.string().min(1).max(128),
});
export const HubLocalStartResponseSchema = z.object({
  type: z.literal("hub.local.start.response"),
  payload: z.object({
    requestId: z.string(),
    url: z.string().max(16384),
    hub: HubDeviceOfferSchema,
    origin: z.string().max(2048).optional(),
    transport: z.enum(["tailscale", "relay", "local", "https"]).optional(),
    tailscaleState: TailscaleStateSchema.optional(),
    networkGuidance: z.string().max(4096).optional(),
  }),
});
export type HubLocalStartOptions = z.infer<typeof HubLocalStartOptionsSchema>;
export type HubLocalStartResult = Omit<
  z.infer<typeof HubLocalStartResponseSchema>["payload"],
  "requestId"
>;

/** Eligibility for this connection, not a guarantee that process startup will succeed. */
export const HubLocalStartStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready") }),
  z.object({
    status: z.literal("blocked"),
    reason: z.enum([
      "managed_access",
      "device_pairing_required",
      "owner_required",
      "launcher_unavailable",
    ]),
  }),
]);
export type HubLocalStartStatus = z.infer<typeof HubLocalStartStatusSchema>;
