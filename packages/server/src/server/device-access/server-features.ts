import type { HubLocalStartStatus } from "@clisbot/protocol/hub-local";

/** Advertise only device-access operations the current session can use. */
export function buildDeviceAccessServerFeatures(options: {
  hasDeviceAuthority: boolean;
  hasHubRelationships: boolean;
  hasHostTailscale: boolean;
  localHubStartStatus: HubLocalStartStatus;
  canStartLocalHub: () => boolean;
}): {
  devicePairing?: true;
  hubDiscovery?: true;
  localHubStart?: true;
  localHubStartStatus: true;
  hostTailscale?: true;
} {
  return {
    localHubStartStatus: true,
    ...(options.hasDeviceAuthority ? { devicePairing: true as const } : {}),
    ...(options.hasDeviceAuthority && options.hasHubRelationships
      ? { hubDiscovery: true as const }
      : {}),
    ...(options.localHubStartStatus.status === "ready" ? { localHubStart: true as const } : {}),
    ...(options.hasHostTailscale && options.canStartLocalHub()
      ? { hostTailscale: true as const }
      : {}),
  };
}

/** The same runtime and authority inputs used by the launch path. A blocked result does
 * not claim that the CLI is outdated; the installed launcher may simply be unavailable. */
export function getHubLocalStartStatus(options: {
  hasDeviceAuthority: boolean;
  hasLocalHubLauncher: boolean;
  managedAccessMode: "off" | "external";
  canStartLocalHub: boolean;
}): HubLocalStartStatus {
  if (options.managedAccessMode === "external")
    return { status: "blocked", reason: "managed_access" };
  if (!options.hasDeviceAuthority) return { status: "blocked", reason: "device_pairing_required" };
  if (!options.canStartLocalHub) return { status: "blocked", reason: "owner_required" };
  if (!options.hasLocalHubLauncher) return { status: "blocked", reason: "launcher_unavailable" };
  return { status: "ready" };
}
