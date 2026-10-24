import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import type { HostProfile, HostConnection } from "@/types/host-connection";
import { normalizeHostPort } from "@clisbot/protocol/daemon-endpoints";
import { defaultHostAppearance } from "@/hosts/appearance";
import { i18n } from "@/i18n/i18next";

export function devicePairedHost(input: {
  offer: DevicePairingOffer;
  existing?: HostProfile;
  label?: string;
}): HostProfile {
  const { offer, existing } = input;
  const pinnedKey =
    existing?.devicePairing?.daemonPublicKeyB64 ??
    existing?.connections.find((c) => c.type === "relay")?.daemonPublicKeyB64;
  if (pinnedKey && pinnedKey !== offer.daemonPublicKeyB64)
    throw new Error(i18n.t("hub.connection.errors.hostIdentityChanged"));
  if (offer.pairing.backendId !== offer.serverId)
    throw new Error(i18n.t("hub.connection.errors.pairingMismatch"));
  const devicePairing = devicePairingFromOffer(offer, existing);
  const connections = offerConnections({
    ...offer,
    minimumSecurityMode: devicePairing.minimumSecurityMode,
  });
  const now = new Date().toISOString();
  const { password: _password, ...previous } = existing ?? {};
  return {
    serverId: offer.serverId,
    label: input.label ?? existing?.label ?? offer.serverId,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: now,
    ...previous,
    devicePairing,
    connections: [
      ...connections,
      ...(existing?.connections ?? []).filter((c) => !connections.some((n) => n.id === c.id)),
    ],
    preferredConnectionId: connections[0]!.id,
    updatedAt: now,
  };
}

/** Caller verifies the offered identity before carrying an existing pin forward. */
export function devicePairingFromOffer(
  offer: Pick<DevicePairingOffer, "serverId" | "daemonPublicKeyB64" | "minimumSecurityMode">,
  existing?: HostProfile,
): NonNullable<HostProfile["devicePairing"]> {
  const learnedRelayPin = existing?.connections.some(
    (connection) =>
      connection.type === "relay" &&
      connection.daemonPublicKeyB64 === offer.daemonPublicKeyB64 &&
      connection.minimumSecurityMode === "protected",
  )
    ? "protected"
    : undefined;
  const minimumSecurityMode =
    offer.minimumSecurityMode ?? existing?.devicePairing?.minimumSecurityMode ?? learnedRelayPin;
  return {
    backendId: offer.serverId,
    daemonPublicKeyB64: offer.daemonPublicKeyB64,
    ...(minimumSecurityMode ? { minimumSecurityMode } : {}),
  };
}

export function offerConnections(
  offer: Pick<
    DevicePairingOffer,
    "direct" | "relay" | "daemonPublicKeyB64" | "minimumSecurityMode"
  >,
): HostConnection[] {
  const connections: HostConnection[] = [];
  if (offer.direct) {
    const endpoint = normalizeHostPort(offer.direct.endpoint);
    const useTls = offer.direct.useTls ?? true;
    if (!useTls && !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(endpoint))
      throw new Error(i18n.t("hub.connection.errors.remoteNeedsHttps"));
    connections.push({
      id: `direct:${useTls ? "wss" : "ws"}:${endpoint}`,
      type: "directTcp",
      endpoint,
      useTls,
    });
  }
  if (offer.relay)
    connections.push({
      id: `relay:${offer.relay.endpoint}`,
      type: "relay",
      relayEndpoint: normalizeHostPort(offer.relay.endpoint),
      useTls: offer.relay.useTls ?? true,
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
      ...(offer.minimumSecurityMode ? { minimumSecurityMode: offer.minimumSecurityMode } : {}),
    });
  if (!connections.length) throw new Error(i18n.t("hub.connection.errors.linkNoRoute"));
  return connections;
}
