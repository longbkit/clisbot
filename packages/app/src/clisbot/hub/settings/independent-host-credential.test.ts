import { expect, it, vi } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import { hasIndependentHostCredential } from "./independent-host-credential";

const host = {
  serverId: "daemon-one",
  password: "legacy-password",
  management: { kind: "hub", managedAccessMode: "external" },
  connections: [{ type: "directTcp", endpoint: "localhost:6767" }],
} as HostProfile;
const key = { publicKey: "public", privateKey: "private" };

it("does not treat Hub enrollment, a device key, or pending invitation as daemon authorization", async () => {
  const readDeviceCredential = vi.fn(async () => ({
    backendId: "daemon-one",
    key,
    invitationToken: "not-yet-redeemed",
  }));
  expect(
    await hasIndependentHostCredential(host, {
      readDeviceCredential,
      readDesktopManagedLocalCredential: async () => undefined,
    }),
  ).toBe(false);
  expect(readDeviceCredential).toHaveBeenCalledWith("daemon-one");
});

it("recognizes the daemon's separately stored credential without issuing a new one", async () => {
  expect(
    await hasIndependentHostCredential(host, {
      readDeviceCredential: async () => ({
        backendId: "daemon-one",
        key,
        credentialId: "device-one",
      }),
      readDesktopManagedLocalCredential: async () => undefined,
    }),
  ).toBe(true);
});

it("accepts the Desktop bridge's independently verified local operator credential", async () => {
  const readDesktopManagedLocalCredential = vi.fn(async () => "verified-local-token");
  expect(
    await hasIndependentHostCredential(host, {
      readDeviceCredential: async () => null,
      readDesktopManagedLocalCredential,
    }),
  ).toBe(true);
  expect(readDesktopManagedLocalCredential).toHaveBeenCalledWith(host.connections[0]);
});

it("fails closed for missing or unreadable credentials, while checking independent alternatives", async () => {
  expect(
    await hasIndependentHostCredential(host, {
      readDeviceCredential: async () => {
        throw new Error("Secret storage locked");
      },
      readDesktopManagedLocalCredential: async () => {
        throw new Error("No Desktop bridge");
      },
    }),
  ).toBe(false);
});
