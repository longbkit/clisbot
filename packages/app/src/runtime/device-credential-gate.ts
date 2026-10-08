import type { DaemonClientConfig } from "@clisbot/client/internal/daemon-client";
import { readDesktopManagedLocalCredential } from "@/desktop/daemon/local-credential";
import { daemonDeviceAccess, readDeviceCredential } from "@/device-access/credentials";
import type { HostConnection, HostProfile } from "@/types/host-connection";

/** Paired Hosts connect with this device's credential; Hub-managed (`external`) ones use tickets. */
export function usesDeviceCredential(host: HostProfile): boolean {
  return host.devicePairing !== undefined && host.management?.managedAccessMode !== "external";
}

/**
 * How this device can reach a paired Host. The desktop's own daemon has no device credential:
 * it is reached on its loopback connection with the desktop's local credential, even after a
 * Hub adds its routes and pairing key to the saved Host. `missing` is true only when the store
 * answers "no credential" and no such local connection exists; a failed read is not an answer.
 */
export async function deviceCredentialAccess(
  host: HostProfile,
): Promise<{ missing: boolean; localConnectionId: string | null }> {
  const backendId = host.devicePairing?.backendId;
  if (!backendId || !usesDeviceCredential(host)) return { missing: false, localConnectionId: null };
  let stored: unknown;
  try {
    stored = await readDeviceCredential(backendId);
  } catch {
    return { missing: false, localConnectionId: null };
  }
  if (stored !== null) return { missing: false, localConnectionId: null };
  const local = await localCredentialConnection(host);
  return { missing: local === null, localConnectionId: local?.id ?? null };
}

/** Device access for one connection: none when this connection carries the local credential. */
export async function resolveHostDeviceAccess(
  host: HostProfile,
  connection: HostConnection,
): Promise<DaemonClientConfig["deviceAccess"]> {
  if (!host.devicePairing || host.management?.managedAccessMode === "external") return undefined;
  try {
    return await daemonDeviceAccess(host.devicePairing.backendId);
  } catch (error) {
    if (await readDesktopManagedLocalCredential(connection)) return undefined;
    throw error;
  }
}

async function localCredentialConnection(host: HostProfile): Promise<HostConnection | null> {
  for (const connection of host.connections) {
    if (await readDesktopManagedLocalCredential(connection).catch(() => undefined))
      return connection;
  }
  return null;
}
