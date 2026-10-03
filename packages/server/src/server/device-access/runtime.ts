import { readPersistedConfig } from "../persisted-config.js";
import path from "node:path";
import { DeviceAuthority } from "@clisbot/device-access/authority";
import { FileDeviceAuthorityStore } from "@clisbot/device-access/file-store";
import type { DaemonRuntimeConfig } from "../session/daemon/daemon-session.js";

export function createDaemonDeviceAuthority(
  enabled: boolean | undefined,
  home: string,
  id: string,
): DeviceAuthority | undefined {
  return enabled
    ? new DeviceAuthority(new FileDeviceAuthorityStore(path.join(home, "device-access.json"), id))
    : undefined;
}

export function createDeviceRuntimeAccess(
  authority: DeviceAuthority | undefined,
  server: () =>
    | {
        deviceSessions(id: string): { clientId: string; connected: boolean }[];
        revokeDeviceSessions(id: string): Promise<void>;
      }
    | undefined
    | null,
): DaemonRuntimeConfig["devices"] {
  if (!authority) return undefined;
  return {
    authority,
    sessions: (id) => server()?.deviceSessions(id) ?? [],
    revokeSessions: async (id) => {
      await server()?.revokeDeviceSessions(id);
    },
  };
}

export function readDevicePairingConfiguration(home: string) {
  const daemon = readPersistedConfig(home, { defaultsIfMissing: true }).daemon;
  return {
    managedAccessMode: daemon?.managedAccess?.mode,
    direct: daemon?.direct?.endpoint
      ? { endpoint: daemon.direct.endpoint, useTls: daemon.direct.useTls }
      : undefined,
  };
}
