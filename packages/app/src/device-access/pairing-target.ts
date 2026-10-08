import {
  parseDevicePairingOfferFromUrl,
  parseHubPairingOfferFromUrl,
  type HubDeviceOffer,
} from "@clisbot/protocol/device-pairing-offer";
import { i18n } from "@/i18n/i18next";

export function hubOnlyPairingTarget(link: string): HubDeviceOffer | null {
  const hubOffer = parseHubPairingOfferFromUrl(link);
  if (hubOffer) return hubOffer.hub;
  const daemon = parseDevicePairingOfferFromUrl(link);
  if (daemon?.managedAccessMode !== "external") return null;
  if (!daemon.hub) throw new Error(i18n.t("hub.connection.errors.managedNeedsHub"));
  return daemon.hub;
}

export function pairedHubSettingsRoute(
  link: string,
): "/settings/hub/account" | "/settings/hub/overview" {
  const hub = parseHubPairingOfferFromUrl(link)?.hub ?? parseDevicePairingOfferFromUrl(link)?.hub;
  return hub?.ownerSetupToken || !hub?.pairing ? "/settings/hub/account" : "/settings/hub/overview";
}
