import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { DevicePairingGrantSchema } from "@clisbot/protocol/device-access";
import {
  parseDevicePairingOfferFromUrl,
  parseHubPairingOfferFromUrl,
  type DevicePairingOffer,
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

/** A Hub invitation approved by this device as the Hub's instance operator. */
export async function approvedHubOffer(profile: HubProfile): Promise<HubDeviceOffer> {
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

export type PairingRoute = "tailscale" | "direct" | "thisComputer" | "relay" | "hub";

/** The routes a pairing link carries, in the order the app tries them. Host links (v3) and
 * Hub-only links (v4) both count; a link that does not parse carries none. */
export function pairingLinkRoutes(url: string): PairingRoute[] {
  let offer: Pick<DevicePairingOffer, "direct" | "relay" | "hub"> | null;
  try {
    const hub = parseHubPairingOfferFromUrl(url)?.hub;
    offer = hub
      ? { ...hubDirect(hub.origin), relay: hub.relay }
      : parseDevicePairingOfferFromUrl(url);
  } catch {
    return [];
  }
  if (!offer) return [];
  const routes: PairingRoute[] = [];
  if (offer.direct) routes.push(directRoute(offer.direct.endpoint));
  if (offer.relay) routes.push("relay");
  if (offer.hub?.pairing) routes.push("hub");
  return routes;
}

function hubDirect(origin: string | undefined): Pick<DevicePairingOffer, "direct"> {
  if (!origin) return {};
  const url = new URL(origin);
  return { direct: { endpoint: url.host, useTls: url.protocol === "https:" } };
}

function directRoute(endpoint: string): PairingRoute {
  const host = endpoint.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (host.endsWith(".ts.net")) return "tailscale";
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return "thisComputer";
  return "direct";
}
