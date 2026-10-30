import { describe, expect, it, vi } from "vitest";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("./account-provider", () => ({ useHubAccount: () => ({}), useHubAccounts: () => [] }));

const {
  isAccountHost,
  hubListPollIntervalMs,
  inventoryHosts,
  prefetchRememberedHubDaemons,
  readHubDaemons,
} = await import("./host-inventory");
const { cachedListForAccount } = await import("./hub-daemon-list-cache");
const { hubResourceQueryKey } = await import("./query-keys");
const { QueryClient } = await import("@tanstack/react-query");

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

  it("keeps an externally managed Host with a verified local session while Hub is unavailable", () => {
    const host = { serverId: "srv", management: management("external") };
    expect(isAccountHost(host, [unavailableHub], true)).toBe(true);
    expect(isAccountHost(host, [unavailableHub], false)).toBe(false);
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

describe("hubListPollIntervalMs", () => {
  it("polls every minute while the Hub answers and backs off to at most five after failures", () => {
    const top = () => 0.999_999;
    expect(hubListPollIntervalMs(0, top)).toBe(60_000);
    expect([1, 2, 3, 4, 5, 9].map((failures) => hubListPollIntervalMs(failures, top))).toEqual([
      60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
    expect(hubListPollIntervalMs(3, () => 0)).toBe(120_000);
  });
});

describe("inventoryHosts: which registered Hosts the picker (and so Home and Work) lists", () => {
  const external = (hubOrigin = "https://hub.example") => ({
    serverId: "srv-managed",
    management: { ...management("external", hubOrigin), organizationId: "org-1" },
  });
  const direct = { serverId: "srv-own", management: undefined };
  const remembered = {
    origin: "https://hub.example",
    accountId: "acc-1",
    organizationId: "org-1",
    syncedAt: "2026-10-27T00:00:00Z",
    daemons: [{ id: "daemon-1", connectionOffer: { serverId: "srv-managed" } }] as never,
  };
  const account = (state: unknown, signedIn: unknown) => ({
    origin: "https://hub.example",
    state,
    signedIn: signedIn as never,
  });

  it("keeps a Host the Hub listed last time while the Hub is temporarily unreachable", () => {
    // The Hub's answer could not be read: no state, no live list; the remembered one stands.
    const unreachable = account(null, null);
    const shown = inventoryHosts({
      accounts: [unreachable],
      lists: [undefined],
      remembered: [cachedListForAccount(remembered, unreachable)],
      registeredHosts: [direct, external()],
      localServerIds: [],
    });
    expect(shown.map((host) => host.serverId)).toEqual(["srv-own", "srv-managed"]);
  });

  it("hides an external Host once the Hub answered that this device is signed out", () => {
    const signedOut = account({ status: "signedOut" }, null);
    const shown = inventoryHosts({
      accounts: [signedOut],
      lists: [undefined],
      remembered: [cachedListForAccount(remembered, signedOut)],
      registeredHosts: [direct, external()],
      localServerIds: [],
    });
    expect(shown.map((host) => host.serverId)).toEqual(["srv-own"]);
  });

  it("starts this run's list read with the remembered ids, which the account's own list query joins", async () => {
    const queryClient = new QueryClient();
    const list = { daemons: [] };
    const organizations: (string | undefined)[] = [];
    let release!: () => void;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = (organizationId?: string) => {
      organizations.push(organizationId);
      return {
        get: async () => {
          await answered;
          return list;
        },
      };
    };
    const hub = (state: unknown, signedIn: unknown) =>
      ({ ...account(state, signedIn), enabled: true, api }) as never;
    // The account read is still pending: no state yet.
    expect(prefetchRememberedHubDaemons(queryClient, hub(null, null), remembered)).toBe(true);
    expect(prefetchRememberedHubDaemons(queryClient, hub(null, null), remembered)).toBe(false);
    // The account answers as the account the list was remembered for.
    const signedIn = { account: { id: "acc-1" }, organization: { id: "org-1" } };
    const live = queryClient.fetchQuery({
      queryKey: hubResourceQueryKey(
        { origin: "https://hub.example", organizationId: "org-1", accountId: "acc-1" },
        "daemons",
      ),
      queryFn: () => readHubDaemons(hub(signedIn, signedIn)),
    });
    release();
    expect(await live).toBe(list);
    expect(organizations).toEqual(["org-1"]);
  });

  it("does not start a list read once the account answered", () => {
    const queryClient = new QueryClient();
    const api = vi.fn();
    const signedIn = { account: { id: "acc-1" }, organization: { id: "org-1" } };
    const hub = { ...account(signedIn, signedIn), enabled: true, api } as never;
    expect(prefetchRememberedHubDaemons(queryClient, hub, remembered)).toBe(false);
    expect(prefetchRememberedHubDaemons(queryClient, hub, undefined)).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it("lists every registered Host when no Hub account is saved", () => {
    const registered = [direct, external()];
    expect(
      inventoryHosts({
        accounts: [],
        lists: [],
        remembered: [],
        registeredHosts: registered,
        localServerIds: [],
      }),
    ).toBe(registered);
  });
});
