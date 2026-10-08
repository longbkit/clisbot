import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostConnection, HostProfile } from "@/types/host-connection";

const store = vi.hoisted(() => ({ read: vi.fn(), local: vi.fn(), access: vi.fn() }));
vi.mock("@/device-access/credentials", () => ({
  readDeviceCredential: store.read,
  daemonDeviceAccess: store.access,
}));
vi.mock("@/desktop/daemon/local-credential", () => ({
  readDesktopManagedLocalCredential: store.local,
}));
const { deviceCredentialAccess, resolveHostDeviceAccess } =
  await import("./device-credential-gate");

const tailnet = { id: "direct:wss:ts", type: "directTcp", endpoint: "ts:8443" } as HostConnection;
const loopback = {
  id: "direct:localhost:57860",
  type: "directTcp",
  endpoint: "localhost:57860",
} as HostConnection;
const paired = {
  serverId: "srv",
  devicePairing: { backendId: "srv", daemonPublicKeyB64: "pk" },
  connections: [tailnet, loopback],
} as HostProfile;

describe("deviceCredentialAccess", () => {
  beforeEach(() => {
    store.read.mockReset();
    store.local.mockReset();
    store.access.mockReset();
  });

  it("is missing only when the store has no credential and no local connection exists", async () => {
    store.read.mockResolvedValue(null);
    store.local.mockResolvedValue(undefined);
    expect(await deviceCredentialAccess(paired)).toEqual({
      missing: true,
      localConnectionId: null,
    });
  });

  it("uses the desktop's local connection for its own daemon", async () => {
    store.read.mockResolvedValue(null);
    store.local.mockImplementation(async (connection: HostConnection) =>
      connection.id === loopback.id ? "local-token" : undefined,
    );
    expect(await deviceCredentialAccess(paired)).toEqual({
      missing: false,
      localConnectionId: loopback.id,
    });
  });

  it("lets the connection attempt decide when the store cannot be read", async () => {
    store.read.mockImplementation(async () => {
      throw new Error("keychain locked");
    });
    expect(await deviceCredentialAccess(paired)).toEqual({
      missing: false,
      localConnectionId: null,
    });
  });

  it("ignores Hosts that do not use a device credential", async () => {
    const external = {
      ...paired,
      management: { managedAccessMode: "external" },
    } as unknown as HostProfile;
    expect((await deviceCredentialAccess(external)).missing).toBe(false);
    expect(store.read).not.toHaveBeenCalled();
  });
});

describe("resolveHostDeviceAccess", () => {
  beforeEach(() => {
    store.local.mockReset();
    store.access.mockReset();
  });

  it("connects with the local credential when the device credential is gone", async () => {
    store.access.mockRejectedValue(new Error("credential unavailable"));
    store.local.mockResolvedValue("local-token");
    expect(await resolveHostDeviceAccess(paired, loopback)).toBeUndefined();
  });

  it("still fails on a connection without the local credential", async () => {
    store.access.mockRejectedValue(new Error("credential unavailable"));
    store.local.mockResolvedValue(undefined);
    await expect(resolveHostDeviceAccess(paired, tailnet)).rejects.toThrow(
      "credential unavailable",
    );
  });
});
