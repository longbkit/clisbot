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
