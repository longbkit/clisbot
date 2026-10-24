import { afterEach, expect, it, vi } from "vitest";
import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import { devicePairedHost } from "./host-profile";
import { pairDaemon } from "./pair-daemon";

const fixture = vi.hoisted(() => ({
  configs: [] as Array<{ e2ee?: { minimumMode?: string }; url?: string }>,
  failFirst: false,
  prepare: vi.fn(async () => undefined),
}));
vi.mock("@clisbot/client/internal/daemon-client", () => ({
  DaemonClient: class {
    private index: number;
    constructor(config: { e2ee?: { minimumMode?: string }; url?: string }) {
      this.index = fixture.configs.length;
      fixture.configs.push(config);
    }
    async connect() {
      if (fixture.failFirst && this.index === 0) throw new Error("direct unreachable");
    }
    getLastServerInfoMessage() {
      return { serverId: "paired-host", hostname: "Paired" };
    }
    async close() {}
  },
}));
vi.mock("./credentials", () => ({
  prepareDevicePairing: fixture.prepare,
  daemonDeviceAccess: vi.fn(),
}));
vi.mock("./device-label", () => ({ suggestedDeviceLabel: () => "Test device" }));
vi.mock("@/runtime/websocket-factory", () => ({ createAppWebSocketFactory: () => undefined }));
afterEach(() => {
  fixture.configs.length = 0;
  fixture.failFirst = false;
  vi.clearAllMocks();
});

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

it("enforces an invitation floor in the initial direct probe and any relay retry", async () => {
  fixture.failFirst = true;
  const invitation = offer("protected");
  await expect(pairDaemon(invitation, devicePairedHost({ offer: invitation }))).resolves.toBe(
    "Paired",
  );
  expect(fixture.configs).toHaveLength(2);
  expect(fixture.configs.map((config) => config.e2ee?.minimumMode)).toEqual([
    "protected",
    "protected",
  ]);
});

it("retains a saved floor for re-pairing while leaving unpinned personal offers optional", async () => {
  const invitation = offer();
  const existing = devicePairedHost({ offer: offer("protected") });
  await pairDaemon(invitation, devicePairedHost({ offer: invitation, existing }));
  expect(fixture.configs[0]?.e2ee?.minimumMode).toBe("protected");
  fixture.configs.length = 0;
  await pairDaemon(invitation, devicePairedHost({ offer: invitation }));
  expect(fixture.configs[0]?.e2ee?.minimumMode).toBeUndefined();
});
