import { z } from "zod";
import { DevicePairingGrantSchema } from "./device-access.js";
import {
  DEFAULT_APP_BASE_URL,
  decodeOfferFragmentPayload,
  encodeOfferFragmentPayload,
} from "./connection-offer.js";

const EndpointSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  useTls: z.boolean().optional(),
});

export const HubDeviceOfferSchema = z.object({
  hubId: z.string().min(1).max(128),
  publicKey: z.string().min(1).max(128),
  origin: z.string().min(1).max(2048).optional(),
  relay: EndpointSchema.optional(),
  pairing: DevicePairingGrantSchema.optional(),
  // COMPAT(ownerSetup): optional approval distinct from ordinary device access.
  ownerSetupToken: z.string().length(43).optional(),
});
export type HubDeviceOffer = z.infer<typeof HubDeviceOfferSchema>;
/** Public discovery can suggest a route; it cannot carry an access/setup grant. */
export const HubConnectionSchema = HubDeviceOfferSchema.omit({
  pairing: true,
  ownerSetupToken: true,
});
export type HubConnection = z.infer<typeof HubConnectionSchema>;
export const HubPairingOfferSchema = z.object({
  v: z.literal(4),
  hub: HubDeviceOfferSchema.extend({ pairing: DevicePairingGrantSchema }),
});
export type HubPairingOffer = z.infer<typeof HubPairingOfferSchema>;

export const DevicePairingOfferSchema = z.object({
  v: z.literal(3),
  serverId: z.string().min(1).max(128),
  daemonPublicKeyB64: z.string().min(1).max(128),
  managedAccessMode: z.enum(["off", "external"]).optional(),
  direct: EndpointSchema.optional(),
  relay: EndpointSchema.optional(),
  pairing: DevicePairingGrantSchema,
  hub: HubDeviceOfferSchema.optional(),
});
export type DevicePairingOffer = z.infer<typeof DevicePairingOfferSchema>;

export function parseDevicePairingOfferFromUrl(input: string): DevicePairingOffer | null {
  const marker = "#offer=";
  const index = input.indexOf(marker);
  if (index < 0) return null;
  const fragment = input.slice(index + marker.length).trim();
  if (fragment.length > 16_384) throw new Error("Pairing link is too large");
  const value = decodeOfferFragmentPayload(fragment);
  if (!value || typeof value !== "object" || !("v" in value) || value.v !== 3) return null;
  const offer = DevicePairingOfferSchema.parse(value);
  if (!offer.direct && !offer.relay) throw new Error("Pairing link has no connection route");
  if (
    offer.pairing.backendId !== offer.serverId ||
    (offer.hub?.pairing && offer.hub.pairing.backendId !== offer.hub.hubId)
  )
    throw new Error("Pairing identity mismatch");
  return offer;
}

/** A Hub-only pairing link (offer v4), as `clisbot hub pair` prints it. */
export function hubPairingOfferUrl(
  hub: HubPairingOffer["hub"],
  appBaseUrl: string = DEFAULT_APP_BASE_URL,
): string {
  return `${appBaseUrl}/#offer=${encodeOfferFragmentPayload({ v: 4, hub })}`;
}

export function parseHubPairingOfferFromUrl(input: string): HubPairingOffer | null {
  const fragment = input.split("#offer=")[1];
  if (!fragment) return null;
  if (fragment.length > 16_384) throw new Error("Pairing link is too large");
  const value = decodeOfferFragmentPayload(fragment);
  if (!value || typeof value !== "object" || !("v" in value) || value.v !== 4) return null;
  const offer = HubPairingOfferSchema.parse(value);
  if (offer.hub.pairing.backendId !== offer.hub.hubId || (!offer.hub.origin && !offer.hub.relay))
    throw new Error("Invalid Hub pairing identity or endpoint");
  return offer;
}
