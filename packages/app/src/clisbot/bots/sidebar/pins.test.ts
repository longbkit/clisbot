import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("@/clisbot/hub/account-provider", () => ({ useHubAccount: () => ({ enabled: false }) }));
import { togglePin, useResourcePinsStore, pinKey } from "./pins";
beforeEach(() => useResourcePinsStore.setState({ scopes: {} }));
it("keeps Host/type identities distinct and never persists display names", () => {
  const a = { kind: "bot" as const, serverId: "a", id: "cto" };
  const b = { ...a, serverId: "b" };
  const pins = togglePin(togglePin([], a), b);
  expect(pins).toHaveLength(2);
  expect(togglePin(pins, a)).toEqual([b]);
  expect(pinKey({ ...a, kind: "chat" })).not.toBe(pinKey(a));
});
it("isolates users and organizations while preserving pin intent", () => {
  const pin = { kind: "project" as const, serverId: "host", id: "project" };
  useResourcePinsStore.getState().toggle("alice:org-a", pin);
  expect(useResourcePinsStore.getState().scopes["alice:org-a"]).toEqual([pin]);
  expect(useResourcePinsStore.getState().scopes["bob:org-a"]).toBeUndefined();
  expect(useResourcePinsStore.getState().scopes["alice:org-b"]).toBeUndefined();
});

const dm = {
  serverId: "host-a",
  id: "dm-a",
  kind: "direct" as const,
  participants: [{ botId: "bot-a", agentId: null }],
};
const botPin = { kind: "bot" as const, serverId: dm.serverId, id: "bot-a" };
const dmPin = { kind: "chat" as const, serverId: dm.serverId, id: dm.id };

it("pins a DM with the same identity as its bot and unpins from either surface", () => {
  expect(togglePin([], dmPin, [dm])).toEqual([botPin]);
  expect(togglePin([botPin], dmPin, [dm])).toEqual([]);
  expect(togglePin([dmPin], botPin, [dm])).toEqual([]);
});

it("removes every legacy duplicate while keeping unrelated pins and other Hosts", () => {
  const otherHost = { ...dmPin, serverId: "host-b" };
  const groupPin = { ...dmPin, id: "group" };
  const group = { ...dm, id: "group", kind: "group" as const };
  const secondDm = { ...dm, id: "dm-second" };
  const duplicate = { ...dmPin, id: secondDm.id };
  expect(
    togglePin([dmPin, botPin, duplicate, otherHost, groupPin], botPin, [dm, group, secondDm]),
  ).toEqual([otherHost, groupPin]);
  expect(togglePin([dmPin, botPin], dmPin, [dm])).toEqual([]);
});

it("keeps persisted aliases intact until toggled and writes only stable identity fields", () => {
  useResourcePinsStore.setState({ scopes: { owner: [dmPin, botPin] } });
  useResourcePinsStore.getState().toggle("owner", dmPin, [dm]);
  expect(useResourcePinsStore.getState().scopes.owner).toEqual([]);
  const menu = { ...botPin, anchor: { x: 1, y: 2 }, title: "Private bot name" };
  useResourcePinsStore.getState().toggle("owner", menu, [dm]);
  expect(useResourcePinsStore.getState().scopes.owner).toEqual([botPin]);
});
