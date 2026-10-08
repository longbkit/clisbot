// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { HubProfile } from "./hub-profiles";
import { HubConnectionSettings, HubOverviewSettings, HubLoginPolicySettings } from "./hub-settings";
import { HubPicker } from "./hub-picker";
import { PairedDeviceList } from "./device-list";
import { isHubSwitchLocked } from "./hub-edit-lock";

// The assertions read the English copy.
beforeEach(() => i18n.changeLanguage("en"));

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  push: vi.fn(),
  setParams: vi.fn(),
  profiles: [] as HubProfile[],
  activeId: null as string | null,
  hosts: [] as { serverId: string; label: string }[],
  connected: [] as string[],
  getHubStatus: vi.fn(),
  startLocalHub: vi.fn(),
  features: { hubDiscovery: true, localHubStart: false },
  request: vi.fn(),
  close: vi.fn(),
  select: vi.fn(),
  pair: vi.fn(),
  saveDiscovered: vi.fn(),
  account: {
    signedIn: null as Record<string, unknown> | null,
    refresh: vi.fn(async () => {}),
    loading: false,
    error: null,
    connection: null as Record<string, unknown> | null,
  },
}));
vi.mock("@/contexts/toast-api-context", () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: state.push, setParams: state.setParams }),
  useLocalSearchParams: () => state.params,
}));
vi.mock("./hub-profiles", () => ({
  useHubProfiles: () => ({
    profiles: state.profiles,
    activeId: state.activeId,
  }),
  selectHubProfile: state.select,
  saveDiscoveredHub: state.saveDiscovered,
  removeHubProfile: vi.fn(),
}));
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccount: () => state.account,
}));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => null }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.hosts,
  useHostRuntimeConnectedServerIds: () => state.connected,
  useHostRuntimeClient: () => null,
  useHostRuntimeSnapshot: () => ({
    client: {
      getLastServerInfoMessage: () => ({ features: state.features }),
      startLocalHub: state.startLocalHub,
    },
  }),
  getHostRuntimeStore: () => ({
    getSnapshot: () => ({
      client: {
        getHubStatus: state.getHubStatus,
        getLastServerInfoMessage: () => ({ features: state.features }),
        startLocalHub: state.startLocalHub,
      },
    }),
  }),
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({
  useLocalDaemonServerId: () => null,
}));
vi.mock("./credentials", () => ({ readDeviceCredential: async () => null }));
vi.mock("./hub-transport", () => ({
  PairedHubTransport: class {
    request = state.request;
    close() {
      state.close();
    }
  },
  pairHub: state.pair,
}));
vi.mock("./hub-help", () => ({ WhatIsHub: () => null }));
// Destination resources are unrelated to these device-admission tests.
vi.mock("@/clisbot/hub/settings/hub-overview-destinations", () => ({
  HubOverviewDestinations: () => null,
}));
// Reads organization resources through React Query; covered by its own test.
vi.mock("@/clisbot/hub/settings/hub-overview-destinations", () => ({
  HubOverviewDestinations: () => null,
}));
// Row actions sit in a dropdown; render its items inline so the test presses them directly.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/hosts/host-picker", () => ({
  HostPicker: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({ open }: { open: boolean }) => (open ? <div role="listbox">Hub options</div> : null),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    loading,
    variant,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
    loading?: boolean;
    variant?: string;
  }) => (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading}
      data-variant={variant}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ children, label, hint }: { children: ReactNode; label: string; hint?: string }) => (
    <div>
      <span>{label}</span>
      {children}
      {hint ? <span>{hint}</span> : null}
    </div>
  ),
  FormTextInput: function FormTextInput({
    initialValue,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    initialValue: string;
    onChangeText(value: string): void;
    accessibilityLabel: string;
    editable?: boolean;
  }) {
    const onChange = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return (
      <input
        aria-label={accessibilityLabel}
        defaultValue={initialValue}
        onChange={onChange}
        disabled={editable === false}
      />
    );
  },
}));
beforeEach(() => {
  state.params = {};
  state.account.signedIn = null;
  state.profiles = [];
  state.activeId = null;
  state.hosts = [];
  state.connected = [];
  state.account.connection = null;
  state.features = { hubDiscovery: true, localHubStart: false };
  vi.resetAllMocks();
  state.getHubStatus.mockResolvedValue({ status: { hubOrigin: null } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a checked empty Hub list offers the two v11 choices without requiring account login", async () => {
  render(<HubConnectionSettings />);
  await waitFor(() =>
    expect(
      screen.getByText("No Hubs are connected. Add one when you need these features."),
    ).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Start a Hub" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect existing Hub" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("failed Host discovery preserves saved Hubs and does not promote the empty setup flow", async () => {
  state.profiles = [
    {
      hubId: "saved",
      publicKey: "key",
      label: "Personal Hub",
      origin: "https://home.example.test",
    },
  ];
  state.activeId = "saved";
  state.hosts = [{ serverId: "host", label: "My computer" }];
  state.connected = ["host"];
  state.getHubStatus.mockRejectedValue(new Error("private connection trace"));
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByText("Some Hosts could not be checked")).toBeTruthy());
  expect(screen.getByText("Personal Hub")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry discovery" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start a Hub" })).toBeNull();
  expect(screen.queryByText("private connection trace")).toBeNull();
});

test("an unreachable selected Hub says where it ran and offers a new Hub instead of Open Hub", async () => {
  state.profiles = [
    { hubId: "old", publicKey: "key", label: "Personal Hub", origin: "http://127.0.0.1:6880" },
  ];
  state.activeId = "old";
  state.hosts = [{ serverId: "host", label: "My computer" }];
  state.connected = ["host"];
  Object.assign(state.account, { state: null, error: "Hub is not connected" });
  try {
    render(<HubConnectionSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start a new Hub on My computer" })).toBeTruthy(),
    );
    expect(
      screen.getByText("A new Hub starts empty; channels from this one are not moved."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Hub" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove from this device" })).toBeTruthy();
  } finally {
    Object.assign(state.account, { state: undefined, error: null });
  }
});

test("a reachable selected Hub keeps the saved-Hub row", async () => {
  selectPersonalHub();
  state.hosts = [{ serverId: "host", label: "My computer" }];
  state.connected = ["host"];
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Hub" })).toBeTruthy());
  expect(screen.queryByTestId("unavailable-hub-card")).toBeNull();
});

test("a saved Hub names the Host it runs on with that Host's ID", async () => {
  selectPersonalHub();
  state.hosts = [{ serverId: "srv_host", label: "My computer" }];
  state.connected = ["srv_host"];
  state.getHubStatus.mockResolvedValue({
    status: {
      hubOrigin: "https://home.example.test",
      hubConnection: { hubId: "saved", publicKey: "key", origin: "https://home.example.test" },
    },
  });
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByText("My computer · srv_host")).toBeTruthy());
});

test("a stopped Hub on a connected Host is started again, not joined", async () => {
  state.hosts = [{ serverId: "srv_host", label: "My computer" }];
  state.connected = ["srv_host"];
  // After the Hub stops, its Host still names its loopback address but is not connected.
  state.getHubStatus.mockResolvedValue({
    status: {
      state: "reconnecting",
      hubOrigin: "http://127.0.0.1:6870",
      lastError: "connect ECONNREFUSED 127.0.0.1:6870",
    },
  });
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByText("Hub on My computer")).toBeTruthy());
  expect(
    screen.getByText("This Hub is stopped. Starting it again keeps its channels and automations."),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start Hub" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
});

test("a closed Hub popup still renders its borderless selector trigger", () => {
  state.profiles = [
    {
      hubId: "saved",
      publicKey: "key",
      label: "Personal Hub",
      origin: "https://home.example.test",
    },
  ];
  state.activeId = "saved";
  render(<HubPicker />);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch Hub" }));
  expect(screen.getByRole("listbox")).toBeTruthy();
});

test("a revoked personal Hub credential asks for approved pairing instead of calling it a network outage", async () => {
  state.profiles = [
    {
      hubId: "saved",
      publicKey: "key",
      label: "Personal Hub",
      origin: "https://home.example.test",
      entry: "pairing",
    },
  ];
  state.activeId = "saved";
  state.request.mockResolvedValue(new Response("{}", { status: 401 }));
  render(<HubOverviewSettings />);
  await waitFor(() => expect(screen.getByText("This device needs to pair again")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Pair again" })).toBeTruthy();
  expect(screen.queryByText("Hub is unavailable")).toBeNull();
});

test("device Rename locks Hub selection through failed save and unlocks on explicit Cancel", async () => {
  const request = vi.fn().mockResolvedValue({
    devices: [{ id: "device-one", label: "Phone", revokedAt: null, lastSeenAt: null }],
  });
  render(<PairedDeviceList request={request} lockHubSwitch />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy());
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(isHubSwitchLocked()).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Device label" }), {
    target: { value: "My phone" },
  });
  request.mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(screen.getByRole("button", { name: "Save label" }));
  await waitFor(() => expect(screen.getByText("Save failed")).toBeTruthy());
  expect(isHubSwitchLocked()).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
  expect(isHubSwitchLocked()).toBe(false);
  expect(screen.queryByRole("textbox")).toBeNull();
});

test.each([
  {
    entry: "owner-setup",
    setupStatus: "owner-required",
    title: "Owner setup is not complete",
    action: "Scan approved setup QR",
  },
  {
    entry: "owner-setup",
    setupStatus: "blocked",
    title: "Hub setup needs operator recovery",
    action: null,
  },
  {
    entry: "pairing",
    setupStatus: "ready",
    title: "Pairing is required for this Hub",
    action: "Scan pairing QR",
  },
])(
  "pasted URL entry $setupStatus/$entry explains the required operator step without granting access",
  async ({ entry, setupStatus, title, action }) => {
    const fetchIdentity = vi.fn(async (_url: URL, _input: RequestInit) =>
      Response.json({
        hubId: "target-hub",
        publicKey: "public-key",
        entry,
        setupStatus,
      }),
    );
    vi.stubGlobal("fetch", fetchIdentity);
    render(<HubConnectionSettings />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect existing Hub" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect existing Hub" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Hub URL or pairing link" }), {
      target: { value: "https://target.example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Hub" }));
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    if (action) expect(screen.getByRole("button", { name: action })).toBeTruthy();
    else expect(screen.queryByRole("button", { name: "Scan approved setup QR" })).toBeNull();
    expect(state.pair).not.toHaveBeenCalled();
    expect(state.saveDiscovered).not.toHaveBeenCalled();
    expect(fetchIdentity.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
    });
  },
);

test("manual Hub entry keeps unrelated Host discovery diagnostics on the listing", async () => {
  state.params = { hubIntent: "connect" };
  state.hosts = [{ serverId: "host", label: "My Host" }];
  state.connected = ["host"];
  state.getHubStatus.mockRejectedValue(new Error("Host is unavailable"));
  render(<HubConnectionSettings />);
  expect(screen.queryByText("Checking your Hosts")).toBeNull();
  await waitFor(() => expect(state.getHubStatus).toHaveBeenCalled());
  expect(screen.queryByText("Some Hosts could not be checked")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByText("Some Hosts could not be checked")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Retry discovery" })).toBeTruthy();
});

test("Hub connection groups Cancel with the primary action, locks pending input, and recovers inline without saving failed access", async () => {
  let rejectRequest!: (error: Error) => void;
  const fetchIdentity = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    )
    .mockResolvedValueOnce(
      Response.json({
        hubId: "target-hub",
        publicKey: "public-key",
        entry: "account",
        setupStatus: "ready",
      }),
    );
  vi.stubGlobal("fetch", fetchIdentity);
  state.params = { hubIntent: "connect" };
  render(<HubConnectionSettings />);
  const form = screen.getByText("Connect existing Hub").parentElement!;
  const connect = screen.getByRole("button", { name: "Connect Hub" }) as HTMLButtonElement;
  const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
  expect(connect.disabled).toBe(true);
  expect(connect.dataset.variant).toBe("default");
  expect(cancel.dataset.variant).toBe("outline");
  expect(connect.parentElement).toBe(cancel.parentElement);
  const url = screen.getByRole("textbox", { name: "Hub URL or pairing link" }) as HTMLInputElement;
  fireEvent.change(url, { target: { value: "https://target.example.test" } });
  expect(connect.disabled).toBe(false);
  fireEvent.click(connect);
  expect(screen.getByRole("button", { name: "Connecting..." }).getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(cancel.disabled).toBe(true);
  expect(url.disabled).toBe(true);
  expect((screen.getByRole("textbox", { name: "Device label" }) as HTMLInputElement).disabled).toBe(
    true,
  );
  await act(async () => rejectRequest(new TypeError("Failed to fetch")));
  const error = screen.getByText(/Could not reach this Hub\. Check the address/);
  expect(form.contains(error)).toBe(true);
  expect(form.contains(screen.getByText("Could not connect to Hub"))).toBe(true);
  expect(screen.queryByText("Failed to fetch")).toBeNull();
  expect(cancel.disabled).toBe(false);
  expect(url.disabled).toBe(false);
  expect(state.saveDiscovered).not.toHaveBeenCalled();
  expect(state.pair).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect Hub" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/settings/hub/account"));
  expect(state.saveDiscovered).toHaveBeenCalledOnce();
});

test("editing a Hub address clears the previous target's owner setup notice", async () => {
  state.params = { hubIntent: "connect" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        hubId: "target-hub",
        publicKey: "public-key",
        entry: "owner-setup",
        setupStatus: "owner-required",
      }),
    ),
  );
  render(<HubConnectionSettings />);
  const url = screen.getByRole("textbox", { name: "Hub URL or pairing link" });
  fireEvent.change(url, { target: { value: "https://target.example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Hub" }));
  await waitFor(() => expect(screen.getByText("Owner setup is not complete")).toBeTruthy());
  fireEvent.change(url, { target: { value: "https://other.example.test" } });
  expect(screen.queryByText("Owner setup is not complete")).toBeNull();
  expect(state.pair).not.toHaveBeenCalled();
  expect(state.saveDiscovered).not.toHaveBeenCalled();
});

test("account capability refresh keeps the same policy transport alive until its scope unmounts", async () => {
  state.profiles = [
    {
      hubId: "saved",
      publicKey: "key",
      label: "Personal Hub",
      origin: "https://home.example.test",
    },
  ];
  state.activeId = "saved";
  state.request.mockImplementation(async () =>
    Response.json({
      hubId: "saved",
      paired: true,
      loginRequired: false,
      accountAuthentication: "personal",
      canManageDevices: true,
      canConfigureLogin: true,
    }),
  );
  const view = render(<HubLoginPolicySettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Require account sign-in" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Require account sign-in" }));
  expect(screen.getByRole("textbox", { name: "Owner email" })).toBeTruthy();
  expect(screen.getByText(/Everyone will need to sign in after enabling/)).toBeTruthy();
  expect(state.close).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Owner email" }), {
    target: { value: "owner@example.test" },
  });
  state.account.connection = { loginRequired: false };
  view.rerender(<HubLoginPolicySettings />);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect((screen.getByRole("textbox", { name: "Owner email" }) as HTMLInputElement).value).toBe(
    "owner@example.test",
  );
  expect(isHubSwitchLocked()).toBe(true);
  expect(state.close).not.toHaveBeenCalled();
  view.unmount();
  expect(state.close).toHaveBeenCalledOnce();
});

test("unsupported Host owner operations are explained before starting and do not send a request", async () => {
  state.hosts = [{ serverId: "host", label: "My Host" }];
  state.connected = ["host"];
  const view = render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start a Hub" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Start a Hub" }));
  const start = screen.getByRole("button", {
    name: "Start Hub and connect this device",
  }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(screen.getByText("This connection cannot start a Hub")).toBeTruthy();
  expect(screen.getByText(/Hub account access alone does not allow/)).toBeTruthy();
  fireEvent.click(start);
  expect(state.startLocalHub).not.toHaveBeenCalled();
  state.features = { hubDiscovery: true, localHubStart: true };
  view.rerender(<HubConnectionSettings />);
  expect(start.disabled).toBe(false);
  expect(screen.queryByText("This connection cannot start a Hub")).toBeNull();
});

function selectPersonalHub() {
  state.profiles = [
    {
      hubId: "saved",
      publicKey: "key",
      label: "Personal Hub",
      origin: "https://home.example.test",
    },
  ];
  state.activeId = "saved";
}
const personalCapabilities = {
  hubId: "saved",
  paired: true,
  loginRequired: false,
  accountAuthentication: "personal",
  canManageDevices: true,
  canConfigureLogin: true,
  ownerLoginConfigured: false,
};
function prepareHubStart() {
  state.hosts = [{ serverId: "host", label: "My Host" }];
  state.connected = ["host"];
  state.features.localHubStart = true;
  const offer = {
    v: 4,
    hub: {
      hubId: "saved",
      publicKey: "key",
      origin: "https://home.example.test",
      pairing: { backendId: "saved", token: "t".repeat(43), expiresAt: Date.now() + 300000 },
    },
  };
  state.startLocalHub.mockResolvedValue({
    url: `https://home.example.test/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`,
    transport: "relay",
    networkGuidance: "Tailscale Serve could not expose this Host: port taken.",
  });
}
async function openOwnerSignIn() {
  render(<HubLoginPolicySettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Require account sign-in" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Require account sign-in" }));
}

test("Overview confirms readiness only after authenticated capabilities and offers the next channel step", async () => {
  selectPersonalHub();
  state.params = { startedHub: "saved" };
  let respond!: (value: Response) => void;
  state.request.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  render(<HubOverviewSettings />);
  expect(screen.queryByText("Hub started successfully")).toBeNull();
  await act(async () => respond(Response.json(personalCapabilities)));
  expect(screen.getByText("Hub started successfully")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Set up a channel" }));
  expect(state.push).toHaveBeenCalledWith("/settings/hub/channels");
  expect(screen.getByText("Not required")).toBeTruthy();
  expect(screen.getByText("Access through device pairing")).toBeTruthy();
  expect(screen.queryByText("Mode")).toBeNull();
  expect(screen.queryByText("Hub ID")).toBeNull();
  fireEvent.click(screen.getByText("Account sign-in"));
  expect(state.push).toHaveBeenCalledWith("/settings/hub/sign-in");
});

test("a Hub start that cannot pair shows the error and never navigates to a success screen", async () => {
  prepareHubStart();
  state.pair.mockRejectedValue(new Error("Pairing failed"));
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start a Hub" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Start a Hub" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Hub and connect this device" }));
  await waitFor(() => expect(screen.getByText("Pairing failed")).toBeTruthy());
  expect(state.push).not.toHaveBeenCalled();
  expect(state.setParams).not.toHaveBeenCalledWith({ transport: "relay" });
});

test("successful Hub start carries the paired Hub identity to its ready screen", async () => {
  prepareHubStart();
  state.pair.mockResolvedValue(undefined);
  render(<HubConnectionSettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start a Hub" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Start a Hub" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Hub and connect this device" }));
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith({
      pathname: "/settings/hub/[hubSection]",
      params: {
        hubSection: "overview",
        startedHub: "saved",
        transport: "relay",
        relayReason: "Tailscale Serve could not expose this Host: port taken.",
      },
    }),
  );
});

test("a Hub started on relay says why, right under the start result", async () => {
  selectPersonalHub();
  state.params = { startedHub: "saved", transport: "relay", relayReason: "Port 8443 is taken." };
  state.request.mockImplementation(async () => Response.json(personalCapabilities));
  render(<HubOverviewSettings />);
  const relay = await screen.findByText("Hub is running on encrypted relay");
  const started = screen.getByText("Hub started successfully");
  expect(screen.getByText(/Port 8443 is taken\./)).toBeTruthy();
  expect(started.compareDocumentPosition(relay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    relay.compareDocumentPosition(screen.getByText("Connection")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("owner sign-in setup has visible labels, validates before sending, and keeps the Hub fixed while editing", async () => {
  selectPersonalHub();
  state.request.mockImplementation(async () => Response.json(personalCapabilities));
  await openOwnerSignIn();
  expect(isHubSwitchLocked()).toBe(true);
  expect(screen.getByText("Owner email")).toBeTruthy();
  expect(screen.getByText("Owner password")).toBeTruthy();
  const enable = screen.getByRole("button", {
    name: "Enable account sign-in",
  }) as HTMLButtonElement;
  expect(enable.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Owner email" }), {
    target: { value: "invalid" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Owner password" }), {
    target: { value: "long-enough-password" },
  });
  expect(enable.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Owner email" }), {
    target: { value: "owner@example.test" },
  });
  expect(enable.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(isHubSwitchLocked()).toBe(false));
  expect(state.request.mock.calls.every((call) => call[0].endsWith("/capabilities"))).toBe(true);
});

test("an existing owner sign-in is reused without requesting a new email or password", async () => {
  selectPersonalHub();
  state.request.mockImplementation(async (path: string) =>
    path.endsWith("/capabilities")
      ? Response.json({ ...personalCapabilities, ownerLoginConfigured: true })
      : new Response("{}", { status: 403 }),
  );
  await openOwnerSignIn();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enable account sign-in" }));
  await waitFor(() => expect(screen.getByText("Account sign-in was not changed")).toBeTruthy());
  expect(state.request.mock.calls.some((call) => call[0].endsWith("/owner-login"))).toBe(false);
  expect(isHubSwitchLocked()).toBe(true);
});

test("partial owner setup is reused on retry when enabling the policy fails", async () => {
  selectPersonalHub();
  state.request.mockImplementation(async (path: string) =>
    path.endsWith("/capabilities")
      ? Response.json(personalCapabilities)
      : new Response("{}", { status: path.endsWith("/owner-login") ? 200 : 503 }),
  );
  await openOwnerSignIn();
  fireEvent.change(screen.getByRole("textbox", { name: "Owner email" }), {
    target: { value: "owner@example.test" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Owner password" }), {
    target: { value: "long-enough-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enable account sign-in" }));
  await waitFor(() => expect(screen.getByText("Account sign-in was not changed")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Enable account sign-in" }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.filter((call) => call[0].endsWith("/login-policy")),
    ).toHaveLength(2),
  );
  expect(state.request.mock.calls.filter((call) => call[0].endsWith("/owner-login"))).toHaveLength(
    1,
  );
});

test("a revoked personal Hub asks for pairing recovery on the policy screen", async () => {
  selectPersonalHub();
  state.request.mockResolvedValue(new Response("{}", { status: 401 }));
  render(<HubLoginPolicySettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Pair again" })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Sign in to this Hub" })).toBeNull();
});

test("required account sign-in is explained before exposing operator settings", async () => {
  selectPersonalHub();
  state.request.mockResolvedValue(
    Response.json({
      ...personalCapabilities,
      loginRequired: true,
      accountAuthentication: "required",
      canManageDevices: false,
      canConfigureLogin: false,
    }),
  );
  render(<HubLoginPolicySettings />);
  await waitFor(() => expect(screen.getByText("Account sign-in is required")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Sign in to this Hub" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Require account sign-in" })).toBeNull();
});

test("read-only Hub access does not expose a login policy mutation", async () => {
  selectPersonalHub();
  state.request.mockResolvedValue(
    Response.json({ ...personalCapabilities, canConfigureLogin: false }),
  );
  render(<HubLoginPolicySettings />);
  await waitFor(() =>
    expect(screen.getByText("Only the Hub operator can change account sign-in")).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "Require account sign-in" })).toBeNull();
});

test("changing the selected Hub cannot retain the previous owner's policy form or capabilities", async () => {
  selectPersonalHub();
  state.request.mockResolvedValue(Response.json(personalCapabilities));
  const view = render(<HubLoginPolicySettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Require account sign-in" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Require account sign-in" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Owner email" }), {
    target: { value: "owner@example.test" },
  });
  state.profiles = [
    {
      hubId: "company",
      publicKey: "company-key",
      label: "Company Hub",
      origin: "https://company.example.test",
    },
  ];
  state.activeId = "company";
  state.request.mockImplementation(() => new Promise(() => {}));
  view.rerender(<HubLoginPolicySettings />);
  expect(screen.queryByRole("textbox", { name: "Owner email" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Require account sign-in" })).toBeNull();
  expect(state.close).toHaveBeenCalledOnce();
});

test("turning off required account sign-in explains owner access before any mutation", async () => {
  selectPersonalHub();
  state.account.signedIn = { account: { id: "owner" } };
  state.request.mockResolvedValue(
    Response.json({
      ...personalCapabilities,
      loginRequired: true,
      accountAuthentication: "signedIn",
      ownerLoginConfigured: true,
    }),
  );
  render(<HubLoginPolicySettings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Turn off account sign-in" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn off account sign-in" }));
  expect(screen.getByText("Paired devices will have personal owner access")).toBeTruthy();
  expect(state.request.mock.calls.every((call) => call[0].endsWith("/capabilities"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(isHubSwitchLocked()).toBe(false));
});

test("a committed login policy is not reported as unchanged if the subsequent account refresh fails", async () => {
  selectPersonalHub();
  let enabled = false;
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/login-policy")) {
      enabled = true;
      return Response.json({ loginRequired: true });
    }
    return Response.json({
      ...personalCapabilities,
      ownerLoginConfigured: true,
      loginRequired: enabled,
      accountAuthentication: enabled ? "required" : "personal",
      canConfigureLogin: !enabled,
    });
  });
  state.account.refresh.mockRejectedValueOnce(new Error("Account refresh failed"));
  await openOwnerSignIn();
  fireEvent.click(screen.getByRole("button", { name: "Enable account sign-in" }));
  await waitFor(() => expect(screen.getByText("Account sign-in is required")).toBeTruthy());
  expect(screen.queryByText("Account sign-in was not changed")).toBeNull();
  expect(state.request.mock.calls.some((call) => call[0].endsWith("/owner-login"))).toBe(false);
});

test("a started account Hub still directs the device to sign in before configuring channels", async () => {
  selectPersonalHub();
  state.params = { startedHub: "saved" };
  state.request.mockResolvedValue(
    Response.json({
      ...personalCapabilities,
      loginRequired: true,
      accountAuthentication: "required",
      canManageDevices: false,
      canConfigureLogin: false,
    }),
  );
  render(<HubOverviewSettings />);
  await waitFor(() => expect(screen.getByText("Hub started successfully")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Set up a channel" })).toBeNull();
  expect(screen.getByText("Sign-in required")).toBeTruthy();
  expect(screen.getByText("Not signed in")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign in to this Hub" }));
  expect(state.push).toHaveBeenCalledWith("/settings/hub/account");
});
