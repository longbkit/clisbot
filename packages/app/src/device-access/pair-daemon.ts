import { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import { buildRelayWebSocketUrl } from "@clisbot/protocol/daemon-endpoints";
import { createAppWebSocketFactory } from "@/runtime/websocket-factory";
import type { HostProfile } from "@/types/host-connection";
import { prepareDevicePairing, daemonDeviceAccess } from "./credentials";
import { suggestedDeviceLabel } from "./device-label";

export async function pairDaemon(
  offer: DevicePairingOffer,
  profile: HostProfile,
  deviceLabel = suggestedDeviceLabel(),
): Promise<string | null> {
  if (offer.pairing.expiresAt <= Date.now())
    throw new Error("Pairing invitation expired; print a new QR code");
  await prepareDevicePairing(offer.serverId, offer.pairing.token, deviceLabel);
  let failure: unknown;
  for (const connection of profile.connections) {
    if (connection.type !== "directTcp" && connection.type !== "relay") continue;
    const url =
      connection.type === "relay"
        ? buildRelayWebSocketUrl({
            endpoint: connection.relayEndpoint,
            serverId: offer.serverId,
            role: "client",
            useTls: connection.useTls ?? true,
          })
        : `${connection.useTls ? "wss" : "ws"}://${connection.endpoint}/ws`;
    const client = new DaemonClient({
      url,
      clientId: `pair:${offer.serverId}`,
      clientType: "mobile",
      connectTimeoutMs: 5000,
      reconnect: { enabled: false },
      webSocketFactory: createAppWebSocketFactory(),
      e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      resolveDeviceAccess: () => daemonDeviceAccess(offer.serverId, true),
    });
    try {
      await client.connect();
      const info = client.getLastServerInfoMessage();
      if (info?.serverId !== offer.serverId) throw new Error("Unexpected Host identity");
      return info.hostname ?? null;
    } catch (error) {
      failure = error;
    } finally {
      await client.close();
    }
  }
  throw failure instanceof Error
    ? failure
    : new Error("Unable to reach the Host; check Tailscale or relay");
}
