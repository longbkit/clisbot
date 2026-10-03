import path from "node:path";
import type { Logger } from "pino";
import { DeviceAuthority } from "@clisbot/device-access/authority";
import { FileDeviceAuthorityStore } from "@clisbot/device-access/file-store";
import {
  DevicePairingOfferSchema,
  type DevicePairingOffer,
} from "@clisbot/protocol/device-pairing-offer";
import { getOrCreateServerId } from "../server-id.js";
import { loadOrCreateDaemonKeyPair } from "../daemon-keypair.js";
import { encodeOfferToFragmentUrl } from "../connection-offer.js";
import { renderPairingQr } from "../pairing-qr.js";
import { DEFAULT_APP_BASE_URL } from "@clisbot/protocol/connection-offer";

export async function generateDevicePairingOffer(options: {
  clisbotHome: string;
  label?: string;
  ttlMs?: number;
  direct?: DevicePairingOffer["direct"];
  relay?: DevicePairingOffer["relay"];
  hub?: DevicePairingOffer["hub"];
  managedAccessMode?: DevicePairingOffer["managedAccessMode"];
  appBaseUrl?: string;
  includeQr?: boolean;
  logger?: Logger;
}): Promise<{ relayEnabled: boolean; url: string; qr: string | null }> {
  if (!options.direct && !options.relay)
    throw new Error("Configure a direct endpoint or enable relay before pairing");
  const serverId = getOrCreateServerId(options.clisbotHome, { logger: options.logger });
  const authority = new DeviceAuthority(
    new FileDeviceAuthorityStore(path.join(options.clisbotHome, "device-access.json"), serverId),
  );
  const pairing = await authority.createInvitation({ label: options.label, ttlMs: options.ttlMs });
  const key = await loadOrCreateDaemonKeyPair(options.clisbotHome, options.logger);
  const offer = DevicePairingOfferSchema.parse({
    v: 3,
    serverId,
    daemonPublicKeyB64: key.publicKeyB64,
    pairing,
    direct: options.direct,
    relay: options.relay,
    hub: options.hub,
    managedAccessMode: options.managedAccessMode,
  });
  const url = encodeOfferToFragmentUrl({
    offer,
    appBaseUrl: options.appBaseUrl ?? DEFAULT_APP_BASE_URL,
  });
  const qr = options.includeQr === false ? null : await renderPairingQr(url);
  return { relayEnabled: Boolean(options.relay), url, qr };
}
