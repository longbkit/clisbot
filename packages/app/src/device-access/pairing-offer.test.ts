import { afterEach, expect, test, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { DevicePairingOffer } from "@clisbot/protocol/device-pairing-offer";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { appDevicePairingOffer } from "./pairing-offer";

const state = vi.hoisted(() => ({
  electron: false,
  local: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => state.electron }));
vi.mock("@/desktop/daemon/desktop-daemon", () => ({ getDesktopDaemonPairingOffer: state.local }));
vi.mock("./hub-transport", () => ({
  PairedHubTransport: class {
    request = state.request;
    close = state.close;
  },
}));
afterEach(() => {
  state.electron = false;
  vi.resetAllMocks();
});

const profile = {
  hubId: "hub-one",
  publicKey: "hub-key",
  label: "Home",
  origin: "https://home.example.test",
};
const hubGrant = { backendId: "hub-one", token: "h".repeat(43), expiresAt: Date.now() + 300_000 };
function payload(mode: "off" | "external", hub?: DevicePairingOffer["hub"]) {
  const offer: DevicePairingOffer = {
    v: 3,
    serverId: "daemon-one",
    daemonPublicKeyB64: "daemon-key",
    managedAccessMode: mode,
    direct: { endpoint: "home.example.test:443", useTls: true },
    pairing: { backendId: "daemon-one", token: "d".repeat(43), expiresAt: Date.now() + 300_000 },
    ...(hub ? { hub } : {}),
  };
  return {
    relayEnabled: false,
    url: `https://app.clisbot.com/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`,
  };
}
function client(mode: "off" | "external") {
  const value = {
    getLastServerInfoMessage: () => ({
      serverId: "daemon-one",
      features: { devicePairing: true, hubRelationship: true },
    }),
    getHubStatus: vi.fn(async () => ({ status: { hubOrigin: profile.origin } })),
    getDaemonPairingOffer: vi.fn(async (options?: { hub?: DevicePairingOffer["hub"] }) =>
      payload(mode, options?.hub),
    ),
  };
  return { value, typed: value as unknown as DaemonClient };
}
function capabilities(canManageDevices: boolean) {
  return Response.json({
    hubId: profile.hubId,
    paired: true,
    loginRequired: false,
    accountAuthentication: "personal",
    canManageDevices,
    canConfigureLogin: canManageDevices,
  });
}

test("desktop shares a fresh combined offer from its local operator without creating another daemon grant", async () => {
  state.electron = true;
  const local = payload("off", { ...profile, pairing: hubGrant });
  state.local.mockResolvedValue(local);
  const daemon = client("off");
  expect(await appDevicePairingOffer(daemon.typed, [])).toEqual(local);
  expect(state.local).toHaveBeenCalledWith("daemon-one");
  expect(daemon.value.getDaemonPairingOffer).not.toHaveBeenCalled();
});

test.each(["off", "external"] as const)(
  "%s combines only the matching Hub's independently approved invitation",
  async (mode) => {
    const daemon = client(mode);
    state.local.mockResolvedValue(null);
    state.request
      .mockResolvedValueOnce(capabilities(true))
      .mockResolvedValueOnce(Response.json(hubGrant));
    const result = await appDevicePairingOffer(daemon.typed, [profile], `hub://${profile.hubId}`);
    expect(parseDevicePairingOfferFromUrl(result.url)?.hub).toMatchObject({
      hubId: "hub-one",
      pairing: hubGrant,
    });
    expect(state.request).toHaveBeenCalledWith(
      "/api/auth/clisbot/device/invitations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.close).toHaveBeenCalledOnce();
  },
);

test("an unrelated Hub is never paired merely because it is selected in the app", async () => {
  const daemon = client("external");
  await expect(
    appDevicePairingOffer(daemon.typed, [
      { ...profile, hubId: "other", origin: "https://other.test" },
    ]),
  ).rejects.toThrow("Hub and sign in");
  expect(state.request).not.toHaveBeenCalled();
  expect(daemon.value.getDaemonPairingOffer).toHaveBeenCalledOnce();
});

test("a paired Hub member cannot mint another device's owner invitation", async () => {
  state.request.mockResolvedValue(capabilities(false));
  const daemon = client("external");
  await expect(appDevicePairingOffer(daemon.typed, [profile])).rejects.toThrow("instance operator");
  expect(state.request).toHaveBeenCalledOnce();
  expect(daemon.value.getDaemonPairingOffer).toHaveBeenCalledOnce();
  expect(state.close).toHaveBeenCalledOnce();
});
