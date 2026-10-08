import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { getIsElectron, isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";

/**
 * Why a pairing link failed, when the reason is known. A browser page served over HTTPS (the
 * official web app) cannot open an unencrypted `ws://` connection in every browser; Safari
 * blocks it. A link whose only route is such a connection, with no relay to fall back to,
 * then fails there however healthy the Host is.
 */
export function pairingLinkFailureMessage(
  url: string,
  page: { browser: boolean; secure: boolean } = currentPage(),
): string {
  if (page.browser && page.secure && onlyUnencryptedDirectRoute(url))
    return i18n.t("hub.connection.errors.browserBlocksDirect");
  return i18n.t("hub.connection.errors.pairingLinkFailed");
}

function onlyUnencryptedDirectRoute(url: string): boolean {
  try {
    const offer = parseDevicePairingOfferFromUrl(url);
    return !!offer?.direct && offer.direct.useTls === false && !offer.relay;
  } catch {
    return false;
  }
}

function currentPage(): { browser: boolean; secure: boolean } {
  const browser = isWeb && !getIsElectron();
  return { browser, secure: browser && globalThis.location?.protocol === "https:" };
}
