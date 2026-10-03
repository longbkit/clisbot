import { z } from "zod";
import type { HubTransport } from "@/clisbot/hub/transport/contract";

const CapabilitiesSchema = z.object({
  hubId: z.string(),
  paired: z.literal(true),
  loginRequired: z.boolean(),
  accountAuthentication: z.enum(["personal", "required", "signedIn"]),
  canManageDevices: z.boolean(),
  canConfigureLogin: z.boolean(),
  // COMPAT(ownerLoginConfigured): older Hubs omit operator-only setup metadata.
  ownerLoginConfigured: z.boolean().optional(),
});
export type HubDeviceCapabilities = z.infer<typeof CapabilitiesSchema>;

export class HubDeviceCapabilityError extends Error {
  constructor(readonly status: number) {
    super("Hub access is unavailable");
  }
}

export async function readHubDeviceCapabilities(
  transport: HubTransport,
): Promise<HubDeviceCapabilities> {
  const response = await transport.request("/api/auth/clisbot/device/capabilities");
  if (!response.ok) throw new HubDeviceCapabilityError(response.status);
  return CapabilitiesSchema.parse(await response.json());
}
