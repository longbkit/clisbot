import { describe, expect, it, vi } from "vitest";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("./account-provider", () => ({ useHubAccount: () => ({}) }));

const { isAccountHost } = await import("./host-inventory");

const management = (managedAccessMode: "off" | "external") => ({
  kind: "hub" as const,
  hubOrigin: "hub://old",
  organizationId: "org-old",
  daemonId: "daemon-1",
  managedAccessMode,
});
const unavailableHub = { origin: "hub://old", organizationId: null, daemons: undefined };

describe("isAccountHost", () => {
  it("hides a managed-access-off Host of another Hub that does not list it", () => {
    const other = { origin: "hub://new", organizationId: null, daemons: undefined };
    expect(isAccountHost({ serverId: "srv", management: management("off") }, other)).toBe(false);
  });

  it("keeps a Host with managed access off when its Hub is unavailable", () => {
    expect(isAccountHost({ serverId: "srv", management: management("off") }, unavailableHub)).toBe(
      true,
    );
  });

  it("hides an external Host until this account's Hub lists it", () => {
    const host = { serverId: "srv", management: management("external") };
    expect(isAccountHost(host, unavailableHub)).toBe(false);
    expect(
      isAccountHost(host, {
        origin: "hub://old",
        organizationId: "org-old",
        daemons: [{ id: "daemon-1", connectionOffer: { serverId: "srv" } }],
      }),
    ).toBe(true);
  });

  it("always keeps a Host no Hub manages", () => {
    expect(isAccountHost({ serverId: "srv", management: undefined }, unavailableHub)).toBe(true);
  });
});
