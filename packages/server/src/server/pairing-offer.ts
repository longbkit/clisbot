import type { Logger } from "pino";
import { DEFAULT_RELAY_ENDPOINT } from "@clisbot/protocol/daemon-endpoints";
import { DEFAULT_APP_BASE_URL } from "@clisbot/protocol/connection-offer";

import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { renderPairingQr } from "./pairing-qr.js";
import { getOrCreateServerId } from "./server-id.js";
import { generateDevicePairingOffer } from "./device-access/pairing.js";
import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";

export interface LocalPairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

export async function generateLocalPairingOffer(args: {
  clisbotHome: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  includeQr?: boolean;
  logger?: Logger;
  devicePairingEnabled?: boolean;
  label?: string;
  ttlMs?: number;
  direct?: DevicePairingOffer["direct"];
  hub?: DevicePairingOffer["hub"];
  managedAccessMode?: DevicePairingOffer["managedAccessMode"];
}): Promise<LocalPairingOffer> {
  const relayEnabled = args.relayEnabled ?? true;
  if (args.devicePairingEnabled)
    return generateDevicePairingOffer({
      ...args,
      relay: relayEnabled
        ? {
            endpoint: args.relayPublicEndpoint ?? args.relayEndpoint ?? DEFAULT_RELAY_ENDPOINT,
            useTls: args.relayPublicUseTls ?? args.relayUseTls ?? true,
          }
        : undefined,
    });
  if (!relayEnabled) {
    return {
      relayEnabled: false,
      url: null,
      qr: null,
    };
  }

  const relayEndpoint = args.relayEndpoint ?? DEFAULT_RELAY_ENDPOINT;
  const relayPublicEndpoint = args.relayPublicEndpoint ?? relayEndpoint;
  const relayUseTls = args.relayUseTls ?? relayEndpoint === DEFAULT_RELAY_ENDPOINT;
  const relayPublicUseTls = args.relayPublicUseTls ?? relayUseTls;
  const appBaseUrl = args.appBaseUrl ?? DEFAULT_APP_BASE_URL;
  const serverId = getOrCreateServerId(args.clisbotHome, { logger: args.logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(args.clisbotHome, args.logger);
  const offer = await createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    relay: { endpoint: relayPublicEndpoint, useTls: relayPublicUseTls },
  });
  const url = encodeOfferToFragmentUrl({ offer, appBaseUrl });

  if (args.includeQr === false) {
    return {
      relayEnabled: true,
      url,
      qr: null,
    };
  }

  let qr: string | null = null;
  try {
    qr = await renderPairingQr(url);
  } catch (error) {
    args.logger?.debug({ error }, "Failed to render pairing QR");
  }

  return {
    relayEnabled: true,
    url,
    qr,
  };
}
