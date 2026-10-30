// @vitest-environment jsdom
import React, { useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  loadHubProfiles,
  saveHubProfile,
  saveDiscoveredHub,
  updateHubProfile,
  selectHubProfile,
  removeHubProfile,
} from "@/device-access/hub-profiles";
import { HubAccountProvider, useHubAccount } from "@/clisbot/hub/account-provider";
import { HubHostSynchronization } from "@/clisbot/hub/host-synchronization";
import { useHostInventory } from "@/clisbot/hub/host-inventory";

import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { useMessageSender } from "@/clisbot/session-storage/message-sender";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

interface FakeHost {
  serverId: string;
  management?: { kind: "hub"; hubOrigin: string; organizationId: string; daemonId: string };
}

const state = vi.hoisted(() => ({
  registry: {
    profiles: [
      { hubId: "personal", publicKey: "personal-key", label: "Personal" },
      { hubId: "company", publicKey: "company-key", label: "Company" },
    ],
    activeId: "personal" as string | null,
  },
  pendingHub: null as string | null,
  accountSignedIn: true,
  /** The OAuth company Hub's daemon list: what it serves, whether it answers 401, reads so far. */
  companyDaemonIds: ["company-daemon"],
  companyListRefused: false,
  companyListReads: 0,
  accountListeners: new Set<() => void>(),
  hosts: [] as FakeHost[],
  localServerIds: [] as string[],
  listeners: new Set<() => void>(),
  register: vi.fn(),
  remove: vi.fn(),
  closed: vi.fn(),
}));

/** Each Hub signs in its own account and lists one Host. */
const hubHosts: Record<string, string> = {
  personal: "laptop",
  company: "build-03",
  "company-daemon-2": "build-04",
};

vi.mock("expo-linking", () => ({ useURL: () => null }));
vi.mock("expo-router", () => ({ useRouter: () => ({ setParams: vi.fn() }) }));
vi.mock("@/clisbot/hub/config", () => ({ getHubConfiguration: () => null }));
vi.mock("@/clisbot/hub/transport/create", () => ({
  createHubTransport: () => ({
    signInKind: "system-browser",
    subscribeSessionChange(listener: () => void) {
      state.accountListeners.add(listener);
      return () => {
        state.accountListeners.delete(listener);
      };
    },
    async request(path: string) {
      if (path === "/api/auth/clisbot/state")
        return Response.json(
          state.accountSignedIn
            ? active("company")
            : { status: "signedOut", registration: "invite_only" },
        );
      if (path.endsWith("/daemons")) {
        state.companyListReads += 1;
        if (state.companyListRefused)
          return Response.json({ error: "unauthorized" }, { status: 401 });
        return Response.json({
          daemons: state.companyDaemonIds.map((id) => daemon("company", id)),
        });
      }
      return new Response(null, { status: 404 });
    },
  }),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () =>
      JSON.stringify({
        ...state.registry,
        profiles: state.registry.profiles.map((p) => ({
          ...p,
          origin: `https://${p.hubId}.example.test`,
        })),
      }),
    setItem: async () => undefined,
  },
}));
vi.mock("@/device-access/hub-transport", () => ({
  PairedHubTransport: class {
    readonly signInKind = "password";
    constructor(private profile: { hubId: string }) {}
    async request(path: string) {
      const hubId = this.profile.hubId;
      if (state.pendingHub === hubId) return new Promise<Response>(() => undefined);
      if (path.endsWith("/capabilities"))
        return Response.json({
          hubId,
          paired: true,
          loginRequired: true,
          accountAuthentication: "signedIn",
          canManageDevices: false,
          canConfigureLogin: false,
        });
      if (path === "/api/auth/clisbot/state") return Response.json(active(hubId));
      if (path.endsWith("/daemons")) return Response.json({ daemons: [daemon(hubId)] });
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    close() {
      state.closed(this.profile.hubId);
    }
  },
}));
vi.mock("@/runtime/host-session-access", () => ({
  registerHostAccessTicketResolver: (serverId: string) => {
    state.register(serverId);
    return () => undefined;
  },
}));
vi.mock("@/runtime/host-runtime", () => {
  const notify = () => {
    for (const listener of state.listeners) listener();
  };
  const store = {
    getHosts: () => state.hosts,
    async upsertManagedConnectionFromOffer(input: {
      offer: { serverId: string };
      management: NonNullable<FakeHost["management"]>;
    }) {
      const { kind, hubOrigin, organizationId, daemonId } = input.management;
      const host = {
        serverId: input.offer.serverId,
        management: { kind, hubOrigin, organizationId, daemonId },
      };
      state.hosts = [...state.hosts.filter((entry) => entry.serverId !== host.serverId), host];
      notify();
      return host;
    },
    async removeManagedHost(management: NonNullable<FakeHost["management"]>) {
      state.remove(management.hubOrigin);
      state.hosts = state.hosts.filter(
        (host) =>
          host.management?.hubOrigin !== management.hubOrigin ||
          host.management.daemonId !== management.daemonId,
      );
      notify();
      return true;
    },
    adoptHostConnection: async () => undefined,
    whenHostRegistryLoaded: async () => undefined,
    markColdStartPhase: () => undefined,
  };
  return {
    getHostRuntimeStore: () => store,
    useHostRuntimeConnectedServerIds: () => state.localServerIds,
    useHosts: () =>
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => state.hosts,
      ),
  };
});

function active(hubId: string) {
  return {
    status: "active",
    account: { id: `${hubId}-account`, name: hubId, email: `${hubId}@example.test` },
    memberships: [],
    organization: { id: `${hubId}-org`, name: hubId, slug: hubId },
    membership: { id: `${hubId}-membership`, role: "member" },
    capabilities: { view: true, manageMembers: false, manageOwners: false, manageResources: false },
    isInstanceOperator: false,
    team: { members: [] },
    canCreateOrganization: false,
  };
}

function daemon(hubId: string, id = `${hubId}-daemon`) {
  const serverId = hubHosts[id] ?? hubHosts[hubId];
  return {
    id,
    slug: serverId,
    status: "active",
    presence: "online",
    connectedAt: null,
    lastSeenAt: "2026-10-10T00:00:00Z",
    canManage: false,
    managedAccessMode: "external",
    connectionOffer: {
      v: 2,
      serverId,
      daemonPublicKeyB64: `${hubId}-key`,
      relay: { endpoint: "relay.example.test", useTls: true },
    },
  };
}

function SenderProbe() {
  const own = useMessageSender(
    {
      kind: "user",
      id: "company-account",
      hubOrigin: "hub://company",
      memberId: "company-membership",
      displayName: "Company user",
    },
    true,
  );
  const other = useMessageSender(
    {
      kind: "user",
      id: "company-account",
      hubOrigin: "hub://unknown",
      memberId: "company-membership",
      displayName: "Other user",
    },
    true,
  );
  return <div data-testid="sender">{JSON.stringify({ own: own.isOwn, other: other.isOwn })}</div>;
}

function Probe() {
  const hub = useHubAccount();
  const inventory = useHostInventory();
  const hosts = inventory.hosts.map((host) => host.serverId).sort();
  return (
    <div data-testid="probe">
      {JSON.stringify({ selected: hub.origin, hosts, status: inventory.status })}
    </div>
  );
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  state.pendingHub = null;
  state.accountSignedIn = true;
  state.companyDaemonIds = ["company-daemon"];
  state.companyListRefused = false;
  state.companyListReads = 0;
  await loadHubProfiles();
  await removeHubProfile("https://company.test");
  for (const profile of state.registry.profiles) {
    await saveHubProfile(
      { ...profile, origin: `https://${profile.hubId}.example.test` },
      profile.label,
    );
  }
  await selectHubProfile("personal");
});

test("a company OAuth Hub and a paired personal Hub keep their Hosts through selection and remount", async () => {
  await removeHubProfile("company");
  await saveDiscoveredHub({
    authentication: "oauth",
    hubId: "https://company.test",
    origin: "https://company.test",
    label: "Company",
    entry: "account",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <HubHostSynchronization />
        <Probe />
      </HubAccountProvider>
    </QueryClientProvider>
  );
  let view = render(tree());
  const probe = () => JSON.parse(view.getByTestId("probe").textContent ?? "{}");
  await waitFor(() =>
    expect(probe()).toMatchObject({
      selected: "https://company.test",
      hosts: ["build-03", "laptop"],
    }),
  );
  await act(() => selectHubProfile("personal"));
  await waitFor(() =>
    expect(probe()).toMatchObject({ selected: "hub://personal", hosts: ["build-03", "laptop"] }),
  );
  expect(state.hosts.map((host) => host.management?.hubOrigin).sort()).toEqual([
    "https://company.test",
    "hub://personal",
  ]);
  view.unmount();
  view = render(tree());
  await waitFor(() => expect(probe().hosts).toEqual(["build-03", "laptop"]));
  // A sign-out notification from another tab updates the account and removes only its Hosts.
  act(() => {
    state.accountSignedIn = false;
    for (const listener of state.accountListeners) listener();
  });
  await waitFor(() => expect(probe().hosts).toEqual(["laptop"]));
  act(() => {
    state.accountSignedIn = true;
    for (const listener of state.accountListeners) listener();
  });
  await waitFor(() => expect(probe().hosts).toEqual(["build-03", "laptop"]));
  await act(() => removeHubProfile("https://company.test"));
  await waitFor(() => expect(probe().hosts).toEqual(["laptop"]));
});

test("Hosts a refused ticket removed read the list once and come back as soon as the account signs in again", async () => {
  await removeHubProfile("company");
  await saveDiscoveredHub({
    authentication: "oauth",
    hubId: "https://company.test",
    origin: "https://company.test",
    label: "Company",
    entry: "account",
  });
  state.companyDaemonIds = ["company-daemon", "company-daemon-2"];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <HubHostSynchronization />
      </HubAccountProvider>
    </QueryClientProvider>,
  );
  const companyHosts = () =>
    state.hosts
      .filter((host) => host.management?.hubOrigin === "https://company.test")
      .map((host) => host.serverId)
      .sort();
  await waitFor(() => expect(companyHosts()).toEqual(["build-03", "build-04"]));

  // The Hub sign-in expired: both tickets are refused, both Hosts are removed together.
  state.companyListRefused = true;
  const readsBefore = state.companyListReads;
  await act(async () => {
    const store = getHostRuntimeStore();
    for (const daemonId of state.companyDaemonIds)
      await store.removeManagedHost({
        kind: "hub",
        hubOrigin: "https://company.test",
        organizationId: "company-org",
        daemonId,
      });
  });
  await waitFor(() => expect(state.companyListReads).toBe(readsBefore + 1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  });
  expect(state.companyListReads).toBe(readsBefore + 1);
  expect(companyHosts()).toEqual([]);

  // Signing in again as the same account reads the list at once, without waiting for the poll.
  state.companyListRefused = false;
  act(() => {
    for (const listener of state.accountListeners) listener();
  });
  await waitFor(() => expect(companyHosts()).toEqual(["build-03", "build-04"]), {
    timeout: 3_000,
  });
  expect(state.companyListReads).toBe(readsBefore + 2);
});

afterEach(async () => {
  cleanup();
  // Unmounting the bindings removes no Host (host-synchronization.tsx): let queued registry
  // writes settle, then start the next test from an empty registry.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(state.accountListeners.size).toBe(0);
  state.hosts = [];
  state.register.mockClear();
  state.remove.mockClear();
  state.closed.mockClear();
});

test("Hosts of every saved Hub stay listed and admitted while the selected Hub changes", async () => {
  vi.stubGlobal("React", React);
  await loadHubProfiles();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <HubHostSynchronization />
        <Probe />
        <SenderProbe />
      </HubAccountProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  const probe = () => JSON.parse(view.getByTestId("probe").textContent ?? "{}");

  await waitFor(() =>
    expect(probe()).toEqual({
      selected: "hub://personal",
      hosts: ["build-03", "laptop"],
      status: "ready",
    }),
  );
  expect(state.hosts.map((host) => host.management?.hubOrigin).sort()).toEqual([
    "hub://company",
    "hub://personal",
  ]);
  expect(JSON.parse(view.getByTestId("sender").textContent!)).toEqual({ own: true, other: false });
  expect(state.register).toHaveBeenCalledWith("laptop");
  expect(state.register).toHaveBeenCalledWith("build-03");

  await act(() => selectHubProfile("company"));
  await waitFor(() => expect(probe().selected).toBe("hub://company"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(probe().hosts).toEqual(["build-03", "laptop"]);
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.closed).not.toHaveBeenCalled();

  await act(() => updateHubProfile("company", { label: "Renamed company" }));
  expect(state.closed).not.toHaveBeenCalled();
  await act(() => updateHubProfile("company", { origin: "https://new-company.example.test" }));
  await waitFor(() => expect(state.closed).toHaveBeenCalledWith("company"));
  expect(state.closed).not.toHaveBeenCalledWith("personal");
  state.closed.mockClear();

  // Forgetting a Hub removes only the Hosts it manages.
  await act(() => removeHubProfile("company"));
  await waitFor(() => expect(probe().hosts).toEqual(["laptop"]));
  expect(state.remove).toHaveBeenCalledWith("hub://company");
  expect(state.remove).not.toHaveBeenCalledWith("hub://personal");
  expect(state.closed).toHaveBeenCalledWith("company");
});

test("a pending Hub does not block startup through another Hub's ready Host", async () => {
  state.pendingHub = "company";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <HubAccountProvider>
        <HubHostSynchronization />
        <Probe />
      </HubAccountProvider>
    </QueryClientProvider>,
  );
  const probe = () => JSON.parse(view.getByTestId("probe").textContent!);
  await waitFor(() => expect(probe().hosts).toEqual(["laptop"]));
  expect(probe().status).toBe("ready");
  const result = resolveStartupRoute({
    route: { kind: "index", pathname: "/" },
    startupBlocker: { kind: "none" },
    hostRegistryStatus: probe().status,
    hosts: [{ serverId: "laptop" }],
    anyOnlineHostServerId: "laptop",
    workspaceSelection: null,
    workspaceSelectionStatus: "missing",
    isWorkspaceSelectionLoaded: true,
    hasGivenUpWaitingForHost: true,
  });
  expect(result.kind).toBe("redirect");
  await act(() => selectHubProfile("company"));
  expect(probe().status).toBe("ready");
});
