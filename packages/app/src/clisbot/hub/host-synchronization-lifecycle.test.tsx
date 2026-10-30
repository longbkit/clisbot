// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HubHostSynchronization } from "./host-synchronization";

const adapters = vi.hoisted(() => ({
  slug: "sandbox",
  register: vi.fn(() => vi.fn()),
  adopt: vi.fn(async () => undefined),
  upsert: vi.fn(async () => ({ serverId: "server" })),
  remove: vi.fn(async () => true),
  listError: null as { status: number } | null,
  refetch: vi.fn(async (_options?: { cancelRefetch?: boolean }) => undefined),
  hosts: [
    {
      serverId: "server",
      management: {
        kind: "hub" as const,
        hubOrigin: "https://hub.example.test",
        organizationId: "org",
        daemonId: "daemon",
      },
    },
  ],
}));
// The cold-start list read (`prefetchRememberedHubDaemons`) needs a client; the account here has
// already answered, so it never reads.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const client = new actual.QueryClient();
  return { ...actual, useQueryClient: () => client };
});
vi.mock("@/data/query", () => ({
  useFetchQuery: () => ({
    data: {
      daemons: [
        {
          id: "daemon",
          slug: adapters.slug,
          managedAccessMode: "external",
          connectionOffer: {
            v: 2,
            serverId: "server",
            daemonPublicKeyB64: "key",
            relay: { endpoint: "relay.example.test", useTls: true },
          },
        },
      ],
    },
    error: adapters.listError,
    refetch: adapters.refetch,
  }),
}));
const SIGNED_IN = {
  status: "active",
  account: { id: "owner" },
  organization: { id: "org" },
};
const account = vi.hoisted(() => ({
  enabled: true,
  loading: false,
  origin: "https://hub.example.test",
  state: null as { status: string } | null,
  signedIn: null as { account: { id: string }; organization: { id: string } } | null,
}));
const savedAccounts = vi.hoisted(() => ({ list: null as unknown[] | null }));
vi.mock("./account-provider", () => ({
  useHubAccount: () => account,
  useHubAccounts: () => savedAccounts.list ?? [account],
  HubAccountScope: ({ children }: { children: unknown }) => children,
}));
function signIn(organizationId = "org") {
  account.state = SIGNED_IN;
  account.signedIn = { ...SIGNED_IN, organization: { id: organizationId } };
}
signIn();
vi.mock("@/runtime/host-session-access", () => ({
  registerHostAccessTicketResolver: adapters.register,
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => adapters.hosts,
    upsertManagedConnectionFromOffer: adapters.upsert,
    adoptHostConnection: adapters.adopt,
    removeManagedHost: adapters.remove,
    whenHostRegistryLoaded: async () => undefined,
    markColdStartPhase: () => undefined,
  }),
  useHosts: () => adapters.hosts,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  signIn();
  account.loading = false;
  savedAccounts.list = null;
  adapters.remove.mockClear();
  adapters.slug = "sandbox";
  adapters.listError = null;
  adapters.refetch.mockReset();
  adapters.refetch.mockImplementation(async () => undefined);
  adapters.hosts = [
    {
      serverId: "server",
      management: {
        kind: "hub" as const,
        hubOrigin: "https://hub.example.test",
        organizationId: "org",
        daemonId: "daemon",
      },
    },
  ];
});
it("syncs a renamed daemon without replacing its ticket resolver or reconnecting", async () => {
  vi.stubGlobal("React", React);
  adapters.adopt.mockClear();
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.adopt).toHaveBeenCalledTimes(1));
  expect(adapters.register).toHaveBeenCalledTimes(1);
  adapters.slug = "build-studio";
  view.rerender(<HubHostSynchronization />);
  await waitFor(() =>
    expect(adapters.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: "build-studio",
        management: expect.objectContaining({ daemonSlug: "build-studio" }),
      }),
    ),
  );
  expect(adapters.adopt).toHaveBeenCalledTimes(1);
  expect(adapters.register).toHaveBeenCalledTimes(1);
});

it("evicts a Hub-managed Host whose daemon is no longer projected", async () => {
  vi.stubGlobal("React", React);
  adapters.remove.mockClear();
  adapters.hosts = [
    {
      serverId: "server",
      management: {
        kind: "hub",
        hubOrigin: "https://hub.example.test",
        organizationId: "org",
        daemonId: "daemon",
      },
    },
    {
      serverId: "old-server",
      management: {
        kind: "hub",
        hubOrigin: "https://hub.example.test",
        organizationId: "org",
        daemonId: "old-daemon",
      },
    },
  ];
  render(<HubHostSynchronization />);
  await waitFor(() =>
    expect(adapters.remove).toHaveBeenCalledWith(
      expect.objectContaining({ daemonId: "old-daemon" }),
      expect.any(String),
    ),
  );
  expect(adapters.remove).not.toHaveBeenCalledWith(
    expect.objectContaining({ daemonId: "daemon" }),
    expect.any(String),
  );
});

it("adopts a saved Host when Hub management is attached to it", async () => {
  vi.stubGlobal("React", React);
  adapters.adopt.mockClear();
  adapters.hosts = [{ serverId: "server" }] as typeof adapters.hosts;
  render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  await waitFor(() => expect(adapters.adopt).toHaveBeenCalledWith("server"));
  expect(adapters.register).toHaveBeenCalled();
});

it("adds a Host back when it leaves the registry while the Hub still lists its daemon", async () => {
  vi.stubGlobal("React", React);
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  const upserts = adapters.upsert.mock.calls.length;

  // A revocation removed the Host; the binding is still mounted.
  adapters.hosts = [];
  view.rerender(<HubHostSynchronization />);

  await waitFor(() => expect(adapters.upsert.mock.calls.length).toBeGreaterThan(upserts), {
    timeout: 3_000,
  });
  expect(adapters.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ offer: expect.objectContaining({ serverId: "server" }) }),
  );
});

it("waits for the Hub to accept the account again before adding a refused Host back", async () => {
  vi.stubGlobal("React", React);
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  const upserts = adapters.upsert.mock.calls.length;

  // The sign-in expired: the ticket was refused and the Host removed; the list read answers 401.
  adapters.hosts = [];
  view.rerender(<HubHostSynchronization />);
  expect(adapters.refetch).toHaveBeenCalledTimes(1);
  // Joins a read already in flight instead of cancelling it.
  expect(adapters.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  adapters.listError = { status: 401 };
  view.rerender(<HubHostSynchronization />);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(adapters.upsert.mock.calls.length).toBe(upserts);

  // Signed in again: the list loads and the Host comes back.
  adapters.listError = null;
  view.rerender(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert.mock.calls.length).toBeGreaterThan(upserts), {
    timeout: 3_000,
  });
});

it("keeps adding a Host back while the Hub is only unreachable", async () => {
  vi.stubGlobal("React", React);
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  const upserts = adapters.upsert.mock.calls.length;
  adapters.listError = { status: 503 };
  adapters.hosts = [];
  view.rerender(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert.mock.calls.length).toBeGreaterThan(upserts), {
    timeout: 3_000,
  });
});

it("waits for the list read a removal started before adding the Host back", async () => {
  vi.stubGlobal("React", React);
  let answerList: () => void = () => undefined;
  adapters.refetch.mockImplementation(
    () => new Promise<undefined>((resolve) => (answerList = () => resolve(undefined))),
  );
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  const upserts = adapters.upsert.mock.calls.length;

  adapters.hosts = [];
  view.rerender(<HubHostSynchronization />);
  expect(adapters.refetch).toHaveBeenCalledTimes(1);
  // Past the base wait, the read has not answered: the Host stays out.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(adapters.upsert.mock.calls.length).toBe(upserts);

  answerList();
  await waitFor(() => expect(adapters.upsert.mock.calls.length).toBeGreaterThan(upserts), {
    timeout: 3_000,
  });
  expect(adapters.refetch).toHaveBeenCalledTimes(1);
});

it("keeps every managed Host when the bindings unmount and mount again", async () => {
  vi.stubGlobal("React", React);
  const first = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());

  // The tree under the Hub scope remounts: a layout rebuilt itself, or Android recreated the
  // activity's React surface. Nothing about the Hub's answer changed.
  first.unmount();
  render(<HubHostSynchronization />);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(adapters.remove).not.toHaveBeenCalled();
});

it("keeps every managed Host while the account is read again", async () => {
  vi.stubGlobal("React", React);
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());

  // A read with no answer yet: no signed-in account and no state.
  account.signedIn = null;
  account.state = null;
  account.loading = true;
  view.rerender(<HubHostSynchronization />);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(adapters.remove).not.toHaveBeenCalled();
});

it("removes this Hub's Hosts once the Hub answers that the account is signed out", async () => {
  vi.stubGlobal("React", React);
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());

  account.signedIn = null;
  account.state = { status: "signedOut" };
  view.rerender(<HubHostSynchronization />);

  await waitFor(() =>
    expect(adapters.remove).toHaveBeenCalledWith(
      expect.objectContaining({ daemonId: "daemon" }),
      expect.any(String),
    ),
  );
});

it("removes only the forgotten Hub's Hosts when a saved Hub is forgotten", async () => {
  vi.stubGlobal("React", React);
  adapters.hosts = [
    ...adapters.hosts,
    {
      serverId: "other-hub-server",
      management: {
        kind: "hub",
        hubOrigin: "https://other-hub.example.test",
        organizationId: "org",
        daemonId: "daemon",
      },
    },
  ];
  const otherHub = { ...account, origin: "https://other-hub.example.test" };
  savedAccounts.list = [account, otherHub];
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  expect(adapters.remove).not.toHaveBeenCalled();

  savedAccounts.list = [account];
  view.rerender(<HubHostSynchronization />);

  await waitFor(() => expect(adapters.remove).toHaveBeenCalledTimes(1));
  expect(adapters.remove).toHaveBeenCalledWith(
    expect.objectContaining({ hubOrigin: "https://other-hub.example.test" }),
    expect.any(String),
  );
});

it("removes a Host this Hub manages under an organization the account left", async () => {
  vi.stubGlobal("React", React);
  adapters.hosts = [
    ...adapters.hosts,
    {
      serverId: "other-org-server",
      management: {
        kind: "hub",
        hubOrigin: "https://hub.example.test",
        organizationId: "previous-org",
        daemonId: "daemon",
      },
    },
  ];
  render(<HubHostSynchronization />);
  await waitFor(() =>
    expect(adapters.remove).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "previous-org" }),
      expect.any(String),
    ),
  );
  expect(adapters.remove).not.toHaveBeenCalledWith(
    expect.objectContaining({ organizationId: "org" }),
    expect.any(String),
  );
});
