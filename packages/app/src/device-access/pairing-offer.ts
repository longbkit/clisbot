import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { DevicePairingGrantSchema } from "@clisbot/protocol/device-access";
import {
  parseDevicePairingOfferFromUrl,
  type HubDeviceOffer,
} from "@clisbot/protocol/device-pairing-offer";
import { isElectronRuntime } from "@/desktop/host";
import { getDesktopDaemonPairingOffer } from "@/desktop/daemon/desktop-daemon";
import type { HubProfile } from "./hub-profiles";
import { PairedHubTransport } from "./hub-transport";
import { readHubDeviceCapabilities } from "./hub-capabilities";

/** Combine independently approved grants, using OS authority only for this desktop's Host. */
export async function appDevicePairingOffer(
  client: DaemonClient,
  profiles: readonly HubProfile[],
  managedHubOrigin?: string,
): Promise<{ url: string; relayEnabled: boolean }> {
  const info = client.getLastServerInfoMessage();
  const local =
    info?.features?.devicePairing && isElectronRuntime()
      ? await getDesktopDaemonPairingOffer(info.serverId)
      : null;
  const result = local ?? (await client.getDaemonPairingOffer());
  const offer = parseDevicePairingOfferFromUrl(result.url);
  if (!offer || offer.hub?.pairing) return result;
  let profile = profiles.find((value) => managedHubOrigin === `hub://${value.hubId}`);
  if (!profile && info?.features?.hubRelationship) {
    const relationship = (await client.getHubStatus()).status;
    profile = profiles.find((value) => value.origin === relationship.hubOrigin);
  }
  if (profile) return client.getDaemonPairingOffer({ hub: await approvedHubOffer(profile) });
  if (offer.managedAccessMode === "external")
    throw new Error(
      "Pair this Host's Hub and sign in as its instance operator, or ask its operator for `clisbot hub pair`.",
    );
  return result;
}

async function approvedHubOffer(profile: HubProfile): Promise<HubDeviceOffer> {
  const transport = new PairedHubTransport(profile);
  try {
    const capabilities = await readHubDeviceCapabilities(transport);
    if (capabilities.hubId !== profile.hubId || !capabilities.canManageDevices)
      throw new Error("The Hub instance operator must approve pairing another device.");
    const response = await transport.request("/api/auth/clisbot/device/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error(`Hub pairing invitation failed (${response.status})`);
    const pairing = DevicePairingGrantSchema.parse(await response.json());
    if (pairing.backendId !== profile.hubId) throw new Error("Hub pairing identity mismatch");
    return { ...profile, pairing };
  } finally {
    transport.close();
  }
}
