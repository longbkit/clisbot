import { describe, expect, it } from "vitest";
import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import { normalizeStoredHostProfile } from "@/types/host-connection";
import { devicePairedHost, offerConnections } from "./host-profile";

function offer(minimumSecurityMode?: "protected"): DevicePairingOffer {
  return {
    v: 3,
    serverId: "paired-host",
    daemonPublicKeyB64: "same-pinned-key",
    direct: { endpoint: "host.example.test:443", useTls: true },
    relay: { endpoint: "relay.example.test:443", useTls: true },
    pairing: { backendId: "paired-host", token: "t".repeat(43), expiresAt: Date.now() + 60_000 },
    ...(minimumSecurityMode ? { minimumSecurityMode } : {}),
  };
}

describe("device paired Host security floor", () => {
  it("preserves an invitation's protected floor on both direct and relay sessions after storage", () => {
    const profile = devicePairedHost({ offer: offer("protected") });
    const restored = normalizeStoredHostProfile(JSON.parse(JSON.stringify(profile)));
    expect(restored?.devicePairing?.minimumSecurityMode).toBe("protected");
    expect(restored?.connections.map((connection) => connection.type)).toEqual([
      "directTcp",
      "relay",
    ]);
    expect(restored?.connections.find((connection) => connection.type === "relay")).toMatchObject({
      minimumSecurityMode: "protected",
    });
  });

  it("retains a prior same-identity floor when an older invitation omits it", () => {
    const existing = devicePairedHost({ offer: offer("protected") });
    expect(devicePairedHost({ offer: offer(), existing }).devicePairing?.minimumSecurityMode).toBe(
      "protected",
    );
    const learned = devicePairedHost({ offer: offer() });
    learned.connections = learned.connections.map((connection) =>
      connection.type === "relay"
        ? { ...connection, minimumSecurityMode: "protected" }
        : connection,
    );
    expect(
      devicePairedHost({ offer: offer(), existing: learned }).devicePairing?.minimumSecurityMode,
    ).toBe("protected");
  });

  it("does not impose a new floor on an invitation without one", () => {
    const profile = devicePairedHost({ offer: offer() });
    expect(profile.devicePairing?.minimumSecurityMode).toBeUndefined();
    expect(
      offerConnections(offer()).find((connection) => connection.type === "relay"),
    ).not.toHaveProperty("minimumSecurityMode");
  });

  it("does not promote a different manual relay identity's floor onto the paired identity", () => {
    const existing = devicePairedHost({ offer: offer() });
    existing.connections = existing.connections.map((connection) =>
      connection.type === "relay"
        ? {
            ...connection,
            daemonPublicKeyB64: "different-manual-key",
            minimumSecurityMode: "protected",
          }
        : connection,
    );
    const refreshed = devicePairedHost({ offer: offer(), existing });
    expect(refreshed.devicePairing?.minimumSecurityMode).toBeUndefined();
    expect(
      refreshed.connections.find((connection) => connection.type === "relay"),
    ).not.toHaveProperty("minimumSecurityMode");
  });

  it("does not carry an old identity's pin across a changed daemon key", () => {
    const existing = devicePairedHost({ offer: offer("protected") });
    expect(() =>
      devicePairedHost({ offer: { ...offer(), daemonPublicKeyB64: "other-key" }, existing }),
    ).toThrow();
  });
});
