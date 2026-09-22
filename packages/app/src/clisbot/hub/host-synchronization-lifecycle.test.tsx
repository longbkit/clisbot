// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HubHostSynchronization } from "./host-synchronization";

const adapters = vi.hoisted(() => ({
  slug: "sandbox",
  register: vi.fn(() => vi.fn()),
  restart: vi.fn(async () => undefined),
  upsert: vi.fn(async () => ({ serverId: "server" })),
  remove: vi.fn(async () => true),
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
  }),
}));
vi.mock("./account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    signedIn: { account: { id: "owner" }, organization: { id: "org" } },
  }),
}));
vi.mock("@/runtime/host-session-access", () => ({
  registerHostAccessTicketResolver: adapters.register,
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => adapters.hosts,
    upsertManagedConnectionFromOffer: adapters.upsert,
    restartHostConnection: adapters.restart,
    removeManagedHost: adapters.remove,
  }),
  useHosts: () => adapters.hosts,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  adapters.slug = "sandbox";
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
  const view = render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.restart).toHaveBeenCalledTimes(1));
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
  expect(adapters.restart).toHaveBeenCalledTimes(1);
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

it("reconnects a saved Host when Hub management is attached to it", async () => {
  vi.stubGlobal("React", React);
  adapters.restart.mockClear();
  adapters.hosts = [{ serverId: "server" }] as typeof adapters.hosts;
  render(<HubHostSynchronization />);
  await waitFor(() => expect(adapters.upsert).toHaveBeenCalled());
  await waitFor(() => expect(adapters.restart).toHaveBeenCalledWith("server"));
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
