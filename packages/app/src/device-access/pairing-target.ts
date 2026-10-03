import {
  parseDevicePairingOfferFromUrl,
  parseHubPairingOfferFromUrl,
  type HubDeviceOffer,
} from "@clisbot/protocol/device-pairing-offer";

export function hubOnlyPairingTarget(link: string): HubDeviceOffer | null {
  const hubOffer = parseHubPairingOfferFromUrl(link);
  if (hubOffer) return hubOffer.hub;
  const daemon = parseDevicePairingOfferFromUrl(link);
  if (daemon?.managedAccessMode !== "external") return null;
  if (!daemon.hub)
    throw new Error(
      "This managed Host requires Hub access. Ask its operator for a Hub URL or approved connection link; enrollment alone cannot grant access.",
    );
  return daemon.hub;
}

export function pairedHubSettingsRoute(
  link: string,
): "/settings/hub/account" | "/settings/hub/overview" {
  const hub = parseHubPairingOfferFromUrl(link)?.hub ?? parseDevicePairingOfferFromUrl(link)?.hub;
  return hub?.ownerSetupToken || !hub?.pairing ? "/settings/hub/account" : "/settings/hub/overview";
}
