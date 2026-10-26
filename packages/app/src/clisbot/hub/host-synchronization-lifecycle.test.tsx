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
vi.mock("./account-provider", () => {
  const account = {
    enabled: true,
    origin: "https://hub.example.test",
    signedIn: { account: { id: "owner" }, organization: { id: "org" } },
  };
  return {
    useHubAccount: () => account,
    useHubAccounts: () => [account],
    HubAccountScope: ({ children }: { children: unknown }) => children,
  };
});
vi.mock("@/runtime/host-session-access", () => ({
  registerHostAccessTicketResolver: adapters.register,
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => adapters.hosts,
    upsertManagedConnectionFromOffer: adapters.upsert,
    adoptHostConnection: adapters.adopt,
    removeManagedHost: adapters.remove,
  }),
  useHosts: () => adapters.hosts,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
