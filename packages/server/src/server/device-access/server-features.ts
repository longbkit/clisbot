/** Advertise only device-access operations the current session can use. */
export function buildDeviceAccessServerFeatures(options: {
  hasDeviceAuthority: boolean;
  hasHubRelationships: boolean;
  hasLocalHubLauncher: boolean;
  canStartLocalHub: () => boolean;
}): {
  devicePairing?: true;
  hubDiscovery?: true;
  localHubStart?: true;
} {
  return {
    ...(options.hasDeviceAuthority ? { devicePairing: true as const } : {}),
    ...(options.hasDeviceAuthority && options.hasHubRelationships
      ? { hubDiscovery: true as const }
      : {}),
    ...(options.hasLocalHubLauncher && options.canStartLocalHub()
      ? { localHubStart: true as const }
      : {}),
  };
}
