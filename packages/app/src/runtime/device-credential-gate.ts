import type { DaemonClientConfig } from "@clisbot/client/internal/daemon-client";
import { readDesktopManagedLocalCredential } from "@/desktop/daemon/local-credential";
import { daemonDeviceAccess, readDeviceCredential } from "@/device-access/credentials";
import type { HostConnection, HostProfile } from "@/types/host-connection";

/** Paired Hosts connect with this device's credential; Hub-managed (`external`) ones use tickets. */
export function usesDeviceCredential(host: HostProfile): boolean {
  return host.devicePairing !== undefined && host.management?.managedAccessMode !== "external";
}

/** Prefer the live Desktop target's existing local authority, independently of Hub/device login. */
export async function deviceCredentialAccess(
  host: HostProfile,
): Promise<{ missing: boolean; localConnectionId: string | null }> {
  const local = await localCredentialConnection(host);
  if (local) return { missing: false, localConnectionId: local.id };
  const backendId = host.devicePairing?.backendId;
  if (!backendId || !usesDeviceCredential(host)) return { missing: false, localConnectionId: null };
  let stored: unknown;
  try {
    stored = await readDeviceCredential(backendId);
  } catch {
    return { missing: false, localConnectionId: null };
  }
  if (stored !== null) return { missing: false, localConnectionId: null };
  return { missing: true, localConnectionId: null };
}

/** Device access for one connection: none when this connection carries the local credential. */
export async function resolveHostDeviceAccess(
  host: HostProfile,
  connection: HostConnection,
): Promise<DaemonClientConfig["deviceAccess"]> {
  if (await readDesktopManagedLocalCredential(connection).catch(() => undefined)) return undefined;
  if (!host.devicePairing || host.management?.managedAccessMode === "external") return undefined;
  return daemonDeviceAccess(host.devicePairing.backendId);
}

async function localCredentialConnection(host: HostProfile): Promise<HostConnection | null> {
  for (const connection of host.connections) {
    if (await readDesktopManagedLocalCredential(connection).catch(() => undefined))
      return connection;
  }
  return null;
}
