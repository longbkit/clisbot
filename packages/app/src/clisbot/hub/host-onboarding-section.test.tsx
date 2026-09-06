// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubHostOnboardingSection } from "./host-onboarding-section";
import { HubHostSynchronization } from "./host-synchronization";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  canManageResources: true,
  role: "owner",
  copy: vi.fn(),
  openAddProject: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  restart: vi.fn(),
  hosts: [],
  statuses: new Map(),
}));
vi.mock("./account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    signedIn: {
      account: { id: "owner" },
      organization: { id: "org" },
      capabilities: { manageResources: adapters.canManageResources },
      membership: { role: adapters.role },
    },
    api: () => ({ get: adapters.get, put: adapters.put }),
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => adapters.hosts,
  useHostRuntimeConnectionStatuses: () => adapters.statuses,
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
vi.mock("./settings/rename-host-dialog", () => ({
  RenameHostDialog: ({
    name,
    onSave,
    onClose,
  }: {
    name: string;
    onSave(name: string): Promise<void>;
    onClose(): void;
  }) => (
    <div role="dialog" aria-label="Rename Host">
      <span>Current shared name: {name}</span>
      <button
        onClick={() => {
          void onSave("renamed-workstation").then(onClose);
        }}
      >
        Save shared name
      </button>
      <button onClick={onClose}>Cancel rename</button>
    </div>
  ),
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
  adapters.canManageResources = true;
  adapters.role = "owner";
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
      <HubHostOnboardingSection />
    </QueryClientProvider>,
  );
}

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
          <HubHostOnboardingSection />
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
    expect(screen.getByText("paseo hub login https://hub.example.test").textContent).toBe(
      "paseo hub login https://hub.example.test",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await screen.findByRole("button", { name: "Copied" });
    await waitFor(() => expect(screen.queryByText("Clipboard unavailable")).toBeNull());
    expect(adapters.copy).toHaveBeenCalledTimes(2);
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
        <HubHostOnboardingSection />
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

describe("Account Hosts shared rename", () => {
  it.each(["owner", "admin"])(
    "offers %s shared rename in Account Hosts and refreshes its name",
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
