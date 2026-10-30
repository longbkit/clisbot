import { describe, expect, it } from "vitest";
import { HubDaemonSchema } from "./contracts";
import type { CachedHubDaemonList } from "./hub-daemon-list-cache";
import { managedHostBindingList } from "./managed-host-binding";

const ORIGIN = "https://hub.example.test";

function daemon(id: string) {
  return HubDaemonSchema.parse({
    id,
    slug: id,
    status: "active",
    presence: "connected",
    connectedAt: null,
    lastSeenAt: "2026-10-30T00:00:00.000Z",
    canManage: false,
    managedAccessMode: "external",
    connectionOffer: {
      v: 2,
      serverId: `srv_${id}`,
      daemonPublicKeyB64: `key-${id}`,
      relay: { endpoint: "relay.example.test:443" },
    },
  });
}

const remembered: CachedHubDaemonList = {
  origin: ORIGIN,
  accountId: "account-1",
  organizationId: "org-1",
  daemons: [daemon("a"), daemon("b")],
  syncedAt: "2026-10-30T00:00:00.000Z",
};

const signedIn = { account: { id: "account-1" }, organization: { id: "org-1" } };

describe("the list a Hub account binds its Hosts from", () => {
  it("binds the remembered list before the account has answered", () => {
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: null, signedIn: null },
        live: undefined,
        remembered,
      }),
    ).toEqual({
      source: "remembered",
      accountId: "account-1",
      organizationId: "org-1",
      daemons: remembered.daemons,
    });
  });

  it("keeps the remembered list for the same account while the list read is pending", () => {
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: signedIn, signedIn },
        live: undefined,
        remembered,
      })?.source,
    ).toBe("remembered");
  });

  it("binds the live list once it is read", () => {
    const live = { daemons: [daemon("a")] };
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: signedIn, signedIn },
        live,
        remembered,
      }),
    ).toEqual({
      source: "live",
      accountId: "account-1",
      organizationId: "org-1",
      daemons: live.daemons,
    });
  });

  it("binds nothing once the Hub answers signed out or another account", () => {
    const other = { account: { id: "account-2" }, organization: { id: "org-1" } };
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: { status: "signedOut" }, signedIn: null },
        live: undefined,
        remembered,
      }),
    ).toBeNull();
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: other, signedIn: other },
        live: undefined,
        remembered,
      }),
    ).toBeNull();
  });

  it("binds nothing without a remembered or live list", () => {
    expect(
      managedHostBindingList({
        account: { enabled: true, origin: ORIGIN, state: null, signedIn: null },
        live: undefined,
        remembered: undefined,
      }),
    ).toBeNull();
  });
});
