import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import type { HostProfile, HostConnection } from "@/types/host-connection";
import { normalizeHostPort } from "@clisbot/protocol/daemon-endpoints";
import { defaultHostAppearance } from "@/hosts/appearance";

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
    throw new Error(
      "This pairing link changes the Host identity; remove the old Host before pairing a replacement",
    );
  if (offer.pairing.backendId !== offer.serverId) throw new Error("Pairing identity mismatch");
  const connections = offerConnections(offer);
  const now = new Date().toISOString();
  const { password: _password, ...previous } = existing ?? {};
  return {
    serverId: offer.serverId,
    label: input.label ?? existing?.label ?? offer.serverId,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: now,
    ...previous,
    devicePairing: { backendId: offer.serverId, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    connections: [
      ...connections,
      ...(existing?.connections ?? []).filter((c) => !connections.some((n) => n.id === c.id)),
    ],
    preferredConnectionId: connections[0]!.id,
    updatedAt: now,
  };
}

export function offerConnections(
  offer: Pick<DevicePairingOffer, "direct" | "relay" | "daemonPublicKeyB64">,
): HostConnection[] {
  const connections: HostConnection[] = [];
  if (offer.direct) {
    const endpoint = normalizeHostPort(offer.direct.endpoint);
    const useTls = offer.direct.useTls ?? true;
    if (!useTls && !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(endpoint))
      throw new Error("Remote pairing requires HTTPS; use Tailscale Serve");
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
    });
  if (!connections.length) throw new Error("Pairing link has no connection route");
  return connections;
}
