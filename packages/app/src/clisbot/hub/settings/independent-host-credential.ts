import type { StoredDeviceCredential } from "@/device-access/credentials";
import type { HostConnection, HostProfile } from "@/types/host-connection";

/** Availability for reconnect guidance; the daemon still verifies and authorizes the credential. */
export async function hasIndependentHostCredential(
  host: HostProfile,
  readers: {
    readDeviceCredential: (backendId: string) => Promise<StoredDeviceCredential | null>;
    readDesktopManagedLocalCredential: (connection: HostConnection) => Promise<string | undefined>;
  },
): Promise<boolean> {
  const results = await Promise.allSettled([
    readers
      .readDeviceCredential(host.devicePairing?.backendId ?? host.serverId)
      .then((credential) => Boolean(credential?.credentialId)),
    ...host.connections.map(async (connection) =>
      Boolean(await readers.readDesktopManagedLocalCredential(connection)),
    ),
  ]);
  return results.some((result) => result.status === "fulfilled" && result.value);
}
