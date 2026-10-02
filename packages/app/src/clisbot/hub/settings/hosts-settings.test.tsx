// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostsSettings } from "./hosts-settings";
import { HubHostSynchronization } from "../host-synchronization";
import { useHostInventory } from "../host-inventory";
import type { HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "@/hosts/appearance";
import { HostSettingsAccess } from "./host-settings-access";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  confirm: vi.fn(),
  canManageResources: true,
  role: "owner",
  accountId: "owner",
  hubEnabled: true,
  signedIn: true,
  accountError: null as string | null,
  refresh: vi.fn(),
  copy: vi.fn(),
  openAddProject: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  restart: vi.fn(),
  hosts: [] as HostProfile[],
  statuses: new Map(),
  statusListeners: new Set<() => void>(),
  subscribeStatuses: (listener: () => void) => {
    adapters.statusListeners.add(listener);
    return () => {
      adapters.statusListeners.delete(listener);
    };
  },
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: adapters.hubEnabled,
    origin: "https://hub.example.test",
    state: null,
    error: adapters.accountError,
    refresh: adapters.refresh,
    signedIn: adapters.signedIn
      ? {
          account: { id: adapters.accountId },
          organization: { id: "org" },
          capabilities: { manageResources: adapters.canManageResources },
          membership: { role: adapters.role },
        }
      : null,
    api: () => ({ get: adapters.get, put: adapters.put, delete: adapters.delete }),
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => adapters.hosts,
  useHostRuntimeConnectionStatuses: () =>
    React.useSyncExternalStore(adapters.subscribeStatuses, () => adapters.statuses),
  getHostRuntimeStore: () => ({
    getHosts: () => adapters.hosts,
    upsertManagedConnectionFromOffer: adapters.upsert,
    removeManagedHost: adapters.remove,
    restartHostConnection: adapters.restart,
  }),
}));
vi.mock("@/hooks/use-open-add-project", () => ({
  useOpenAddProject: () => adapters.openAddProject,
}));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: adapters.copy }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: adapters.confirm }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The row's … menu renders its items inline, so a test presses Disconnect directly.
vi.mock("./team/row-actions-menu", () => ({
  RowActionsMenu: (props: {
    actions: readonly { label: string; onSelect(): void; disabled?: boolean }[];
  }) => (
    <>
      {props.actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </>
  ),
}));
vi.mock("./rename-host-dialog", () => ({
  RenameHostDialog: ({
    name,
    onSave,
    onClose,
  }: {
    name: string;
    onSave(name: string): Promise<void>;
    onClose(): void;
  }) => {
    // eslint-disable-next-line react-perf/jsx-no-new-function-as-prop -- test double inside vi.mock
    const save = () => void onSave("renamed-workstation").then(onClose);
    return (
      <div role="dialog" aria-label="Rename Host">
        <span>Current shared name: {name}</span>
        <button type="button" onClick={save}>
          Save shared name
        </button>
        <button type="button" onClick={onClose}>
          Cancel rename
        </button>
      </div>
    );
  },
}));

const registeredDaemon = {
  id: "daemon-1",
  slug: "Workstation",
  status: "active",
  presence: "connected",
  connectedAt: null,
  lastSeenAt: "2026-09-05T00:00:00.000Z",
  canManage: true,
  connectionOffer: null,
  managedAccessMode: "off",
};
const emptyHosts = { daemons: [] };
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("React", React);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  adapters.get.mockReset();
  adapters.put.mockReset();
  adapters.delete.mockReset();
  adapters.confirm.mockReset();
  adapters.canManageResources = true;
  adapters.role = "owner";
  adapters.accountId = "owner";
  adapters.hubEnabled = true;
  adapters.signedIn = true;
  adapters.accountError = null;
  adapters.refresh.mockReset().mockResolvedValue(undefined);
  adapters.hosts = [];
  adapters.statuses = new Map();
  adapters.statusListeners.clear();
  adapters.copy.mockReset();
  adapters.upsert.mockReset();
  adapters.remove.mockReset().mockResolvedValue(undefined);
  adapters.restart.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function renderSection() {
  return render(
    <QueryClientProvider client={queryClient}>
      <HostsSettings />
    </QueryClientProvider>,
  );
}

function HostChoices() {
  const { hosts, status } = useHostInventory();
  return (
    <select aria-label="Host choices" data-status={status}>
      {hosts.map((host) => (
        <option key={host.serverId}>{host.label}</option>
      ))}
    </select>
  );
}

function savedHost(
  serverId: string,
  label: string,
  management?: HostProfile["management"],
): HostProfile {
  return {
    serverId,
    label,
    management,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [{ id: "direct", type: "directTcp", endpoint: "localhost:6869" }],
    preferredConnectionId: "direct",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const managedHost = savedHost("server-1", "Hub Host", {
  kind: "hub",
  hubOrigin: "https://hub.example.test",
  organizationId: "org",
  daemonId: "daemon-1",
  managedAccessMode: "external",
});
const connectableDaemon = {
  ...registeredDaemon,
  slug: "Hub Host",
  connectionOffer: {
    v: 2,
    serverId: "server-1",
    daemonPublicKeyB64: "key",
    relay: { endpoint: "relay.example.test", useTls: true },
  },
};

function InventoryViews() {
  return (
    <QueryClientProvider client={queryClient}>
      <HostChoices />
      <HostsSettings />
    </QueryClientProvider>
  );
}

it("keeps app settings available while the Host inventory is loading", () => {
  adapters.get.mockImplementation(() => new Promise(() => {}));
  render(
    <QueryClientProvider client={queryClient}>
      <HostSettingsAccess serverId={null}>
        <div>General settings</div>
      </HostSettingsAccess>
    </QueryClientProvider>,
  );
  expect(screen.getByText("General settings")).toBeDefined();
  expect(screen.queryByText("Loading Hosts...")).toBeNull();
});

it("does not mount settings behind an inaccessible Host URL while access loads or after denial", async () => {
  adapters.hosts = [managedHost];
  let finish!: (value: typeof emptyHosts) => void;
  adapters.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const Detail = vi.fn(() => <div>Host settings</div>);
  render(
    <QueryClientProvider client={queryClient}>
      <HostSettingsAccess serverId="server-1">
        <Detail />
      </HostSettingsAccess>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Loading Hosts...")).toBeDefined();
  expect(Detail).not.toHaveBeenCalled();
  await act(async () => finish(emptyHosts));
  await screen.findByText(
    "This Host is not available to your current account. Choose another Host.",
  );
  expect(Detail).not.toHaveBeenCalled();
});

it("retries a failed Host access check before mounting its settings", async () => {
  adapters.hosts = [managedHost];
  adapters.get
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ daemons: [connectableDaemon] });
  const Detail = vi.fn(() => <div>Host settings</div>);
  render(
    <QueryClientProvider client={queryClient}>
      <HostSettingsAccess serverId="server-1">
        <Detail />
      </HostSettingsAccess>
    </QueryClientProvider>,
  );
  await screen.findByText("Hosts unavailable. Try loading your Hosts again.");
  expect(Detail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByText("Host settings");
});

it("uses the same inventory for Host choices and the Hosts tab for a member without grants", async () => {
  adapters.canManageResources = false;
  adapters.role = "member";
  adapters.hosts = [
    savedHost("manual", "Personal Host"),
    savedHost("saved", "Old Hub Host", {
      kind: "hub",
      hubOrigin: "https://hub.example.test",
      organizationId: "org",
      daemonId: "denied",
      managedAccessMode: "external",
    }),
  ];
  adapters.get.mockResolvedValue(emptyHosts);
  render(
    <QueryClientProvider client={queryClient}>
      <HostChoices />
      <HostsSettings />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(adapters.get).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByText("Personal Host")).toHaveLength(2));
  expect(screen.queryByText("Old Hub Host")).toBeNull();
  expect(screen.queryByText("No Hosts available")).toBeNull();
});

it("shows an allowed Hub Host using a direct connection once on each surface", async () => {
  adapters.hosts = [managedHost, savedHost("manual", "Personal Host")];
  adapters.get.mockResolvedValue({ daemons: [connectableDaemon] });
  render(<InventoryViews />);
  await waitFor(() => expect(screen.getAllByText("Hub Host")).toHaveLength(2));
  expect(screen.getAllByText("Personal Host")).toHaveLength(2);
  expect(screen.getAllByRole("option")).toHaveLength(2);
});

it("hides the previous account's Host immediately while a new Member's access loads", async () => {
  adapters.hosts = [managedHost, savedHost("manual", "Personal Host")];
  adapters.get.mockResolvedValue({ daemons: [connectableDaemon] });
  const view = render(<InventoryViews />);
  await waitFor(() => expect(screen.getAllByText("Hub Host")).toHaveLength(2));
  let finish!: (value: typeof emptyHosts) => void;
  adapters.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  adapters.accountId = "new-member";
  adapters.role = "member";
  adapters.canManageResources = false;
  view.rerender(<InventoryViews />);
  expect(screen.getByLabelText("Host choices").getAttribute("data-status")).toBe("loading");
  expect(screen.queryByText("Hub Host")).toBeNull();
  expect(screen.getAllByText("Personal Host")).toHaveLength(2);
  await act(async () => finish(emptyHosts));
  await waitFor(() =>
    expect(screen.getByLabelText("Host choices").getAttribute("data-status")).toBe("ready"),
  );
  expect(screen.queryByText("Hub Host")).toBeNull();
  expect(screen.getAllByText("Personal Host")).toHaveLength(2);
});

it("keeps direct Hosts usable when the Hub inventory request fails", async () => {
  adapters.hosts = [managedHost, savedHost("manual", "Personal Host")];
  adapters.get.mockRejectedValue(new Error("offline"));
  render(<InventoryViews />);
  await screen.findByText("Hosts unavailable");
  expect(screen.getByLabelText("Host choices").getAttribute("data-status")).toBe("error");
  expect(screen.queryByText("Hub Host")).toBeNull();
  expect(screen.getAllByText("Personal Host")).toHaveLength(2);
});

it("preserves the standalone Host chooser when Hub support is disabled", () => {
  adapters.hubEnabled = false;
  adapters.hosts = [managedHost, savedHost("manual", "Personal Host")];
  render(
    <QueryClientProvider client={queryClient}>
      <HostChoices />
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Hub Host",
    "Personal Host",
  ]);
  expect(adapters.get).not.toHaveBeenCalled();
});

it("shows saved Hosts and their connection states without a Hub sign-in", () => {
  adapters.signedIn = false;
  adapters.hosts = [
    savedHost("online", "Same Host"),
    savedHost("offline", "Same Host"),
    managedHost,
  ];
  adapters.statuses = new Map([
    ["online", "online"],
    ["offline", "offline"],
  ]);
  renderSection();
  expect(screen.getAllByText("Same Host")).toHaveLength(2);
  expect(screen.getByText("Host ID: online").textContent).toBe("Host ID: online");
  expect(screen.getByText("Host ID: offline").textContent).toBe("Host ID: offline");
  expect(screen.getByText("Online").textContent).toBe("Online");
  expect(screen.getByText("Offline").textContent).toBe("Offline");
  expect(screen.getByLabelText("1 online out of 2 Hosts").textContent).toBe("1 active / 2 total");
  expect(screen.queryByText("Hub Host")).toBeNull();
  expect(screen.queryByText("Refresh Hosts")).toBeNull();
  expect(screen.queryByText("Add a Host")).toBeNull();
  expect(adapters.get).not.toHaveBeenCalled();
});

it.each([{ manualHosts: [] }, { manualHosts: [savedHost("manual", "Personal Host")] }])(
  "recovers from a failed Hub account lookup while keeping saved Hosts $manualHosts available",
  async ({ manualHosts }) => {
    adapters.signedIn = false;
    adapters.accountError = "Hub account request failed";
    adapters.hosts = [managedHost, ...manualHosts];
    const view = renderSection();
    expect(screen.getByRole("alert").textContent).toContain("Hosts unavailable");
    expect(screen.queryByText("No Hosts yet")).toBeNull();
    expect(screen.queryByText("Hub Host")).toBeNull();
    expect(screen.queryAllByText("Personal Host")).toHaveLength(manualHosts.length);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(adapters.refresh).toHaveBeenCalledOnce();
    expect(adapters.get).not.toHaveBeenCalled();

    adapters.accountError = null;
    adapters.signedIn = true;
    adapters.get.mockResolvedValue({ daemons: [connectableDaemon] });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <HostsSettings />
      </QueryClientProvider>,
    );
    expect((await screen.findByText("Hub Host")).textContent).toBe("Hub Host");
    expect(screen.queryByText("Hosts unavailable")).toBeNull();
    expect(screen.queryAllByText("Personal Host")).toHaveLength(manualHosts.length);
  },
);

it("keeps the Hosts page available with Hub support disabled, including zero Hosts", () => {
  adapters.hubEnabled = false;
  renderSection();
  expect(screen.getByText("No Hosts yet").textContent).toBe("No Hosts yet");
  expect(screen.getByLabelText("0 online out of 0 Hosts").textContent).toBe("0 active / 0 total");
  expect(screen.queryByText("Loading Hosts...")).toBeNull();
  expect(adapters.get).not.toHaveBeenCalled();
});

it("counts each Host once and uses the app connection state for online Hosts", async () => {
  adapters.hosts = [managedHost, savedHost("manual", "Personal Host")];
  adapters.statuses = new Map([
    ["server-1", "offline"],
    ["manual", "online"],
  ]);
  adapters.get.mockResolvedValue({
    daemons: [connectableDaemon, { ...registeredDaemon, id: "waiting", slug: "Waiting Host" }],
  });
  renderSection();
  await screen.findByText("Waiting Host");
  expect(screen.getByLabelText("1 online out of 3 Hosts").textContent).toBe("1 active / 3 total");
  act(() => {
    adapters.statuses = new Map([
      ["server-1", "online"],
      ["manual", "online"],
    ]);
    for (const listener of adapters.statusListeners) listener();
  });
  expect(screen.getByLabelText("2 online out of 3 Hosts").textContent).toBe("2 active / 3 total");
});

describe("Host onboarding query recovery", () => {
  it.each([
    ["offline", "Offline"],
    ["connected", "Waiting for connection"],
    ["future_presence", "Status unavailable"],
  ] as const)(
    "explains a %s Host without connection details without inventing a sidebar Host",
    async (presence, label) => {
      adapters.get.mockResolvedValue({ daemons: [{ ...registeredDaemon, presence }] });
      render(
        <QueryClientProvider client={queryClient}>
          <HubHostSynchronization />
          <HostsSettings />
        </QueryClientProvider>,
      );
      await screen.findByText(label);
      expect(screen.queryByText("Registering")).toBeNull();
      expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add project" })).toBeNull();
      expect(screen.getByRole("button", { name: "Refresh Hosts" })).toBeDefined();
      expect(screen.getByText(/then refresh Hosts\./u)).toBeDefined();
      expect(adapters.upsert).not.toHaveBeenCalled();
    },
  );

  it("offers Reconnect for an offline Host that has connection details", async () => {
    const offer = {
      v: 2,
      serverId: "srv-1",
      daemonPublicKeyB64: "key",
      relay: { endpoint: "relay.example.test", useTls: true },
    };
    adapters.get.mockResolvedValue({ daemons: [{ ...registeredDaemon, connectionOffer: offer }] });
    adapters.hosts = [{ serverId: "srv-1", label: "Workstation" }] as never;
    adapters.statuses = new Map([["srv-1", "offline"]]) as never;
    try {
      renderSection();
      fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
      expect(adapters.restart).toHaveBeenCalledWith("srv-1");
    } finally {
      adapters.hosts = [];
      adapters.statuses = new Map();
    }
  });

  it("waits for a successful response before showing the empty Host guidance", async () => {
    let resolve!: (value: typeof emptyHosts) => void;
    adapters.get.mockReturnValue(
      new Promise<typeof emptyHosts>((resolvePromise) => {
        resolve = resolvePromise;
      }),
    );
    renderSection();
    expect(screen.getByText("Loading Hosts...").textContent).toBe("Loading Hosts...");
    expect(screen.queryByText("No Hosts yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    await act(async () => resolve(emptyHosts));
    await screen.findByText("No Hosts yet");
    expect(screen.queryByText("Loading Hosts...")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Refresh Hosts" })).toHaveLength(1);
  });

  it("keeps the last successful Hosts visible alongside a refresh error and recovers on retry", async () => {
    adapters.get
      .mockResolvedValueOnce({ daemons: [registeredDaemon] })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ daemons: [{ ...registeredDaemon, slug: "Renamed Workstation" }] });
    renderSection();
    await screen.findByText("Workstation");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Hosts" }));
    await screen.findByText("Hosts unavailable");
    expect(screen.getByText("Workstation").textContent).toBe("Workstation");
    expect(screen.queryByText("No Hosts yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Hosts" }));
    await screen.findByText("Renamed Workstation");
    expect(screen.queryByText("Hosts unavailable")).toBeNull();
    expect(adapters.get).toHaveBeenCalledTimes(3);
  });

  it("does not treat an initial request failure as an empty inventory", async () => {
    adapters.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(emptyHosts);
    renderSection();
    await screen.findByText("Hosts unavailable");
    expect(screen.queryByText("No Hosts yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Hosts" }));
    await screen.findByText("No Hosts yet");
    expect(screen.queryByText("Hosts unavailable")).toBeNull();
  });

  it("shows clipboard failure without losing the command and allows another copy attempt", async () => {
    adapters.get.mockResolvedValue(emptyHosts);
    adapters.copy
      .mockRejectedValueOnce(new Error("Clipboard unavailable"))
      .mockResolvedValueOnce(undefined);
    renderSection();
    await screen.findByText("No Hosts yet");
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await screen.findByText("Clipboard unavailable");
    expect(screen.getByText("clisbot hub connect https://hub.example.test").textContent).toBe(
      "clisbot hub connect https://hub.example.test",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await screen.findByRole("button", { name: "Copied" });
    await waitFor(() => expect(screen.queryByText("Clipboard unavailable")).toBeNull());
    expect(adapters.copy).toHaveBeenCalledTimes(2);
    expect(adapters.copy).toHaveBeenLastCalledWith("clisbot hub connect https://hub.example.test");
  });
});

describe("Host binding recovery", () => {
  it("shows synchronization failure and retries the mounted binding without reloading Account", async () => {
    const daemon = {
      ...registeredDaemon,
      connectionOffer: {
        v: 1 as const,
        serverId: "host-1",
        daemonPublicKeyB64: "test-key",
        relay: { endpoint: "relay.example.test", useTls: true },
      },
    };
    adapters.get.mockResolvedValue({ daemons: [daemon] });
    adapters.upsert
      .mockRejectedValueOnce(new Error("Unable to save Host connection"))
      .mockResolvedValueOnce({ serverId: "host-1" });
    render(
      <QueryClientProvider client={queryClient}>
        <HubHostSynchronization />
        <HostsSettings />
      </QueryClientProvider>,
    );
    expect((await screen.findByText("Unable to save Host connection")).textContent).toBe(
      "Unable to save Host connection",
    );
    expect(screen.queryByText("Registering")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(adapters.upsert).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Unable to save Host connection")).toBeNull());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("Hosts shared rename", () => {
  it.each(["owner", "admin"])(
    "offers %s shared rename in Hosts and refreshes its name",
    async (role) => {
      adapters.role = role;
      const renamed = { ...registeredDaemon, slug: "renamed-workstation" };
      adapters.get
        .mockResolvedValueOnce({ daemons: [registeredDaemon] })
        .mockResolvedValue({ daemons: [renamed] });
      adapters.put.mockResolvedValue({ id: registeredDaemon.id, slug: renamed.slug });
      renderSection();
      fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
      expect(screen.getByText("Current shared name: Workstation")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Save shared name" }));
      await screen.findByText("renamed-workstation");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(adapters.put).toHaveBeenCalledWith(
        "daemons/daemon-1",
        { slug: "renamed-workstation" },
        expect.anything(),
      );
    },
  );

  it("does not offer shared rename to a daemon administrator without Hub management", async () => {
    adapters.role = "member";
    adapters.canManageResources = false;
    adapters.get.mockResolvedValue({ daemons: [registeredDaemon] });
    renderSection();
    await screen.findByText("Workstation");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(adapters.put).not.toHaveBeenCalled();
  });
});

describe("Host administration", () => {
  it("disconnects a Host only after confirming, and never twice", async () => {
    adapters.get.mockResolvedValue({ daemons: [registeredDaemon] });
    adapters.confirm.mockResolvedValueOnce(false).mockResolvedValue(true);
    adapters.delete.mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
    expect(adapters.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const done = await screen.findByRole("button", { name: "Disconnected" });
    fireEvent.click(done);
    expect(adapters.delete).toHaveBeenCalledExactlyOnceWith("daemons/daemon-1");
  });

  it("keeps renaming, disconnecting, and adding Hosts to Organization Admins only", async () => {
    adapters.canManageResources = false;
    adapters.get.mockResolvedValue({ daemons: [registeredDaemon] });
    renderSection();
    await screen.findByText("Workstation");
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByText("Add a Host")).toBeNull();
  });

  it("always shows an Organization Admin how to add a Host", async () => {
    adapters.get.mockResolvedValue({ daemons: [registeredDaemon] });
    renderSection();
    await screen.findByText("Add a Host");
    expect(screen.getByText("clisbot hub connect https://hub.example.test")).toBeTruthy();
  });
});

function InventoryRetry() {
  const { retry } = useHostInventory();
  return (
    <button type="button" onClick={retry}>
      Retry inventory
    </button>
  );
}

it("replaces a hung initial inventory request on retry and ignores its late result", async () => {
  adapters.hosts = [managedHost];
  let finishOldRequest!: (value: { daemons: (typeof connectableDaemon)[] }) => void;
  adapters.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOldRequest = resolve;
      }),
  );
  adapters.get.mockResolvedValue(emptyHosts);
  render(
    <QueryClientProvider client={queryClient}>
      <HostChoices />
      <InventoryRetry />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(adapters.get).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Host choices").getAttribute("data-status")).toBe("loading");
  fireEvent.click(screen.getByText("Retry inventory"));
  await waitFor(() =>
    expect(screen.getByLabelText("Host choices").getAttribute("data-status")).toBe("ready"),
  );
  expect(adapters.get).toHaveBeenCalledTimes(2);
  await act(async () => finishOldRequest({ daemons: [connectableDaemon] }));
  expect(screen.queryByText("Hub Host")).toBeNull();
});
