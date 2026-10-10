import { describe, expect, it, vi } from "vitest";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("./account-provider", () => ({ useHubAccount: () => ({}), useHubAccounts: () => [] }));

const { isAccountHost } = await import("./host-inventory");

const management = (managedAccessMode: "off" | "external", hubOrigin = "hub://old") => ({
  kind: "hub" as const,
  hubOrigin,
  organizationId: "org-old",
  daemonId: "daemon-1",
  managedAccessMode,
});
const unavailableHub = { origin: "hub://old", organizationId: null, daemons: undefined };
const listing = (origin: string, organizationId: string, serverId: string) => ({
  origin,
  organizationId,
  daemons: [{ id: "daemon-1", connectionOffer: { serverId } }],
});

describe("isAccountHost", () => {
  it("hides a managed-access-off Host whose Hub is not saved on this device", () => {
    const other = { origin: "hub://new", organizationId: null, daemons: undefined };
    expect(isAccountHost({ serverId: "srv", management: management("off") }, [other])).toBe(false);
  });

  it("keeps a Host with managed access off when its Hub is unavailable", () => {
    expect(
      isAccountHost({ serverId: "srv", management: management("off") }, [unavailableHub]),
    ).toBe(true);
  });

  it("hides an external Host until this account's Hub lists it", () => {
    const host = { serverId: "srv", management: management("external") };
    expect(isAccountHost(host, [unavailableHub])).toBe(false);
    expect(isAccountHost(host, [listing("hub://old", "org-old", "srv")])).toBe(true);
  });

  it("always keeps a Host no Hub manages", () => {
    expect(isAccountHost({ serverId: "srv", management: undefined }, [])).toBe(true);
  });

  it("judges each Host by the Hub that manages it, not by the first or selected Hub", () => {
    const personal = { serverId: "laptop", management: management("external", "hub://personal") };
    const company = { serverId: "build-03", management: management("external", "hub://company") };
    const listings = [
      listing("hub://personal", "org-old", "laptop"),
      listing("hub://company", "org-old", "build-03"),
    ];
    expect(isAccountHost(personal, listings)).toBe(true);
    expect(isAccountHost(company, listings)).toBe(true);
    // Another Hub listing the same daemon id does not admit a Host it does not manage.
    expect(isAccountHost(company, [listing("hub://personal", "org-old", "build-03")])).toBe(false);
  });
});
