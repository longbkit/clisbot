import type { ClisbotDaemonConfig } from "../bootstrap.js";
import { DEFAULT_RELAY_ENDPOINT } from "@clisbot/protocol/daemon-endpoints";
import { ConnectionOfferSchema } from "@clisbot/protocol/connection-offer";
import { createConnectionOfferV2 } from "../connection-offer.js";
import { readPersistedConfig } from "../persisted-config.js";

export async function createPublishedConnectionOffer(
  config: ClisbotDaemonConfig,
  relayEnabled: boolean | undefined,
  serverId: string,
  daemonPublicKeyB64: string,
  requireProtectedSecurity = config.relayRequireProtectedSecurity ?? false,
) {
  const { enabled, endpoint, useTls } = publicRelay(config, relayEnabled);
  if (!enabled && !config.devicePairingEnabled) return null;
  const directEndpoint = config.directEndpoint?.trim();
  if (!config.devicePairingEnabled)
    return legacyPublishedOffer(
      config,
      serverId,
      daemonPublicKeyB64,
      { endpoint, useTls },
      requireProtectedSecurity,
    );
  const direct = readPersistedConfig(config.clisbotHome).daemon?.direct;
  const publishedEndpoint = direct?.endpoint?.trim() || directEndpoint;
  if (!enabled && !publishedEndpoint) return null;
  return ConnectionOfferSchema.parse({
    v: 5,
    encrypted: true,
    ...(requireProtectedSecurity ? { minimumSecurityMode: "protected" } : {}),
    serverId,
    daemonPublicKeyB64,
    relay: enabled ? { endpoint, useTls } : undefined,
    direct: publishedEndpoint
      ? { endpoint: publishedEndpoint, useTls: direct?.useTls ?? config.directUseTls ?? true }
      : undefined,
  });
}

function legacyPublishedOffer(
  config: ClisbotDaemonConfig,
  serverId: string,
  daemonPublicKeyB64: string,
  relay: { endpoint: string; useTls: boolean },
  requireProtectedSecurity: boolean,
) {
  const endpoint = config.directEndpoint?.trim();
  return createConnectionOfferV2({
    serverId,
    daemonPublicKeyB64,
    relay,
    ...(requireProtectedSecurity ? { minimumSecurityMode: "protected" as const } : {}),
    ...(endpoint ? { direct: { endpoint, useTls: config.directUseTls ?? true } } : {}),
  });
}

function publicRelay(config: ClisbotDaemonConfig, relayEnabled?: boolean) {
  const enabled = relayEnabled ?? config.relayEnabled ?? true;
  const endpoint = config.relayPublicEndpoint ?? config.relayEndpoint ?? DEFAULT_RELAY_ENDPOINT;
  const useTls =
    config.relayPublicUseTls ?? config.relayUseTls ?? endpoint === DEFAULT_RELAY_ENDPOINT;
  return { enabled, endpoint, useTls };
}
