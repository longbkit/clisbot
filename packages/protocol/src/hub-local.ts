import { z } from "zod";
import { HubDeviceOfferSchema } from "./device-pairing-offer.js";

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
    tailscaleState: z
      .enum(["ready", "missing", "stopped", "login-required", "unavailable"])
      .optional(),
    networkGuidance: z.string().max(4096).optional(),
  }),
});
export type HubLocalStartOptions = z.infer<typeof HubLocalStartOptionsSchema>;
export type HubLocalStartResult = Omit<
  z.infer<typeof HubLocalStartResponseSchema>["payload"],
  "requestId"
>;
