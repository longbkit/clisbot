import { afterEach, expect, test, vi } from "vitest";
const storage = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => storage.value,
    setItem: async (_key: string, value: string) => {
      storage.value = value;
    },
  },
}));
afterEach(() => {
  storage.value = null;
  vi.resetModules();
});

test("manual route changes retain the pinned Hub identity and omit the consumed grant from profiles", async () => {
  const registry = await import("./hub-profiles");
  await registry.saveHubProfile({
    hubId: "hub-one",
    publicKey: "key-one",
    origin: "https://home.example.test",
    pairing: { backendId: "hub-one", token: "a".repeat(43), expiresAt: Date.now() + 300_000 },
    ownerSetupToken: "owner-setup-secret",
  });
  expect(storage.value).not.toContain('"pairing"');
  expect(storage.value).not.toContain("a".repeat(43));
  expect(storage.value).not.toContain("owner-setup-secret");
  await registry.updateHubProfile("hub-one", {
    label: "Home",
    origin: null,
    relay: registry.parseHubRelayUrl("wss://relay.example.test:8443"),
  });
  expect(registry.currentHubProfile()).toMatchObject({
    hubId: "hub-one",
    publicKey: "key-one",
    label: "Home",
    relay: { endpoint: "relay.example.test:8443", useTls: true },
  });
  expect(registry.currentHubProfile()?.origin).toBeUndefined();
  await expect(registry.updateHubProfile("hub-one", { relay: null })).rejects.toThrow(
    "no connection route",
  );
  await expect(
    registry.saveHubProfile({
      hubId: "hub-one",
      publicKey: "replacement",
      origin: "https://home.example.test",
    }),
  ).rejects.toThrow("identity key changed");
  expect(registry.currentHubProfile()?.publicKey).toBe("key-one");
});

test("manual relay URLs cannot smuggle credentials, paths, queries or non-WebSocket schemes", async () => {
  const { parseHubRelayUrl } = await import("./hub-profiles");
  expect(parseHubRelayUrl("")).toBeNull();
  expect(parseHubRelayUrl("ws://127.0.0.1:8080")).toEqual({
    endpoint: "127.0.0.1:8080",
    useTls: false,
  });
  for (const url of [
    "https://relay.example.test",
    "wss://user:secret@relay.example.test",
    "wss://relay.example.test/ws",
    "wss://relay.example.test?role=server",
    "wss://relay.example.test#key",
  ])
    expect(() => parseHubRelayUrl(url)).toThrow();
});

test("new QR profiles have distinct route or identity labels without renaming saved Hubs", async () => {
  const registry = await import("./hub-profiles");
  const direct = {
    hubId: "host-hub-one",
    publicKey: "key-one",
    origin: "https://work.example.test",
  };
  await registry.saveHubProfile(direct);
  expect(registry.currentHubProfile()?.label).toBe("work.example.test");
  await registry.updateHubProfile(direct.hubId, { label: "Company Hub" });
  await registry.saveHubProfile(direct);
  expect(registry.currentHubProfile()?.label).toBe("Company Hub");
  await registry.saveHubProfile({
    hubId: "personal-hub-two",
    publicKey: "key-two",
    origin: "http://127.0.0.1:6870",
  });
  expect(registry.currentHubProfile()?.label).toBe("Hub · personal");
  await registry.saveHubProfile({
    hubId: "relay-hub-three",
    publicKey: "key-three",
    relay: { endpoint: "relay.example.test" },
  });
  expect(registry.currentHubProfile()?.label).toBe("Hub · relay-hu");
});

test("removing the selected Hub selects another saved Hub, then none", async () => {
  const registry = await import("./hub-profiles");
  const hub = (id: string) => ({ hubId: id, publicKey: `key-${id}`, origin: "https://h.test" });
  await registry.saveHubProfile(hub("old"));
  await registry.saveHubProfile(hub("other"));
  await registry.selectHubProfile("old");

  await registry.removeHubProfile("old");
  expect(registry.currentHubProfile()?.hubId).toBe("other");

  await registry.removeHubProfile("other");
  expect(registry.currentHubProfile()).toBeNull();
});

test("removing a Hub that is not selected keeps the selection", async () => {
  const registry = await import("./hub-profiles");
  const hub = (id: string) => ({ hubId: id, publicKey: `key-${id}`, origin: "https://h.test" });
  await registry.saveHubProfile(hub("stale"));
  await registry.saveHubProfile(hub("current"));

  await registry.removeHubProfile("stale");
  expect(registry.currentHubProfile()?.hubId).toBe("current");
});

test("account Hubs coexist with paired Hubs, survive reload, and pin their OAuth issuer", async () => {
  let registry = await import("./hub-profiles");
  await registry.saveHubProfile({
    hubId: "personal",
    publicKey: "personal-key",
    origin: "https://home.test",
  });
  const company = {
    authentication: "oauth" as const,
    hubId: "https://company.test",
    origin: "https://company.test",
    label: "Company",
    entry: "account" as const,
  };
  await registry.saveDiscoveredHub(company);
  expect(registry.hubProfileOrigin(registry.currentHubProfile()!)).toBe(company.origin);
  await expect(
    registry.updateHubProfile(company.hubId, { origin: "https://elsewhere.test" }),
  ).rejects.toThrow();
  await expect(
    registry.updateHubProfile(company.hubId, { relay: { endpoint: "relay.test" } }),
  ).rejects.toThrow();
  await expect(registry.updateHubProfile(company.hubId, { origin: null })).rejects.toThrow();
  await registry.updateHubProfile(company.hubId, { label: "Work" });
  vi.resetModules();
  registry = await import("./hub-profiles");
  await registry.loadHubProfiles();
  expect(registry.currentHubProfile()).toMatchObject({ ...company, label: "Work" });
  await registry.selectHubProfile("personal");
  expect(registry.hubProfileOrigin(registry.currentHubProfile()!)).toBe("hub://personal");
  await registry.removeHubProfile("personal");
  expect(registry.currentHubProfile()?.hubId).toBe(company.origin);
});
