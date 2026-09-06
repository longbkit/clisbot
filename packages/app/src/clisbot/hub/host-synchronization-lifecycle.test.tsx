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
    getHosts: () => [
      {
        serverId: "server",
        management: {
          kind: "hub",
          hubOrigin: "https://hub.example.test",
          organizationId: "org",
          daemonId: "daemon",
        },
      },
    ],
    upsertManagedConnectionFromOffer: adapters.upsert,
    restartHostConnection: adapters.restart,
    removeManagedHost: adapters.remove,
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
