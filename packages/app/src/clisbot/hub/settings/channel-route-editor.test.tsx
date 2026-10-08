// @vitest-environment jsdom
import { AutomationInputDraftContext } from "./automation-input-draft";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubApiError } from "../api-client";
import { CHANNEL_CATALOG_RESPONSE } from "../channel-catalog.fixture";
import { ChannelSettings } from "./channel-settings";
import { HubSettingsDetailScrollProvider } from "./detail-scroll";
import type { RouteBotOption } from "../channel-route-bot";

const adapters = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  scrollToTop: vi.fn(),
  canManage: true,
  accountId: "owner",
  teamMembers: [] as { id: string; name: string; role?: string }[],
  botOptions: [] as RouteBotOption[],
  botListeners: new Set<() => void>(),
}));
/** Bots arriving after the form opened, as the Hosts answer. */
function loadBots(options: RouteBotOption[]) {
  act(() => {
    adapters.botOptions = options;
    for (const listener of adapters.botListeners) listener();
  });
}
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    state: {
      status: "active",
      isInstanceOperator: false,
      team: { members: [] },
    },
    signedIn: {
      account: { id: adapters.accountId },
      organization: { id: "org" },
      membership: { id: "member", role: "owner" },
      capabilities: { manageResources: adapters.canManage },
      team: { members: adapters.teamMembers },
    },
    api: () => ({
      get: adapters.get,
      post: adapters.post,
      put: adapters.put,
      delete: adapters.delete,
    }),
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: adapters.push }) }));
vi.mock("@/components/confirmation-provider", () => ({
  ConfirmationProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirmation: () => adapters.confirm,
}));
vi.mock("./channel-actions-menu", () => ({
  ChannelActionsMenu: function MenuAdapter({
    label,
    disabled,
    actions = [],
    remove,
  }: {
    label: string;
    disabled: boolean;
    actions?: { label: string; onSelect(): void }[];
    remove?: () => void;
  }) {
    const [open, setOpen] = React.useState(false);
    // A Pressable keeps its click from the Route row it sits in, as react-native-web does.
    const toggle = React.useCallback((event?: { stopPropagation(): void }) => {
      event?.stopPropagation();
      setOpen((value) => !value);
    }, []);
    const items = [
      ...actions,
      ...(remove === undefined ? [] : [{ label: "Remove", onSelect: remove }]),
    ];
    return (
      <div>
        <button type="button" aria-label={label} disabled={disabled} onClick={toggle}>
          …
        </button>
        {open
          ? items.map((item) => (
              <MenuItemAdapter key={item.label} item={item} disabled={disabled} close={toggle} />
            ))
          : null}
      </div>
    );
  },
}));
function MenuItemAdapter(props: {
  item: { label: string; onSelect(): void };
  disabled: boolean;
  close(): void;
}) {
  const select = React.useCallback(
    (event: { stopPropagation(): void }) => {
      event.stopPropagation();
      props.close();
      props.item.onSelect();
    },
    [props],
  );
  return (
    <button type="button" disabled={props.disabled} onClick={select}>
      {props.item.label}
    </button>
  );
}
// Adapt native inputs while exercising the actual route form, configuration builders and queries.
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  FormTextInput: function TestInput(props: {
    initialValue: string;
    onChangeText(value: string): void;
    editable?: boolean;
    placeholder?: string;
    multiline?: boolean;
    accessibilityLabel?: string;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        props.onChangeText(event.target.value),
      [props],
    );
    if (props.multiline)
      return (
        <textarea
          defaultValue={props.initialValue}
          onChange={change}
          disabled={props.editable === false}
        />
      );
    return (
      <input
        aria-label={props.accessibilityLabel}
        defaultValue={props.initialValue}
        onChange={change}
        disabled={props.editable === false}
        placeholder={props.placeholder}
      />
    );
  },
}));
// The channel picker renders its options as ComboboxItems; the stub select
// below never opens them.
vi.mock("@/components/ui/combobox", () => ({ Combobox: () => null, ComboboxItem: () => null }));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: function TestSelect(props: {
    label: string;
    value: string | null;
    disabled?: boolean;
    options: { id: string; value: string; label: string }[];
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <select
        aria-label={props.label}
        value={props.value ?? ""}
        disabled={props.disabled}
        onChange={change}
      >
        <option value="">Choose</option>
        {props.options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: function TestSwitch(props: {
    value: boolean;
    disabled?: boolean;
    onValueChange(value: boolean): void;
    accessibilityLabel?: string;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onValueChange(event.target.checked),
      [props],
    );
    return (
      <input
        type="checkbox"
        aria-label={props.accessibilityLabel}
        checked={props.value}
        disabled={props.disabled}
        onChange={change}
      />
    );
  },
}));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: function TestMultiSelectField(props: {
    label: string;
    disabled?: boolean;
    options: { id: string; value: string; label: string; group?: string }[];
    value: "*" | readonly string[] | null;
    onChange(value: "*" | readonly string[]): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) =>
        props.onChange([...event.target.selectedOptions].map((option) => option.value)),
      [props],
    );
    return (
      <select
        multiple
        aria-label={props.label}
        disabled={props.disabled}
        value={props.value === "*" || props.value === null ? [] : [...props.value]}
        onChange={change}
      >
        {props.options.map((option) => (
          <option key={option.id} value={option.value} data-group={option.group}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("./conversation-picker-field", () => ({
  useObservedSenders: () => ({ data: undefined, isLoading: false }),
  SenderSelectionFields: function TestSenders(props: {
    value: string;
    disabled: boolean;
    among?: readonly string[] | null;
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <input
        aria-label="Sender IDs"
        data-among={props.among == null ? "any" : props.among.join(",")}
        value={props.value}
        disabled={props.disabled}
        onChange={change}
      />
    );
  },
  ConversationSelectionFields: function TestConversations(props: {
    value: string;
    disabled: boolean;
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <input
        aria-label="Conversation IDs"
        value={props.value}
        disabled={props.disabled}
        onChange={change}
      />
    );
  },
}));
vi.mock("./daemon-project-field", () => ({
  DaemonProjectField: function ProjectTargetAdapter(props: {
    daemonId: string | null;
    serverId: string | null;
    cwd: string;
    onChange(projectId: string): void;
    onCwdChange(cwd: string): void;
    disabled: boolean;
  }) {
    const select = React.useCallback(() => {
      props.onChange("next-project");
      props.onCwdChange("/next/project-root");
    }, [props]);
    return (
      <div>
        <output aria-label="Selected working directory">{props.cwd}</output>
        <output aria-label="Selected Host runtime">{props.serverId ?? ""}</output>
        <button type="button" disabled={props.disabled || props.daemonId === null} onClick={select}>
          Choose next Project
        </button>
      </div>
    );
  },
}));
vi.mock("./managed-agent-configuration-fields", () => ({
  ManagedAgentConfigurationFields: () => null,
  ManagedAgentFastModeSwitch: () => null,
}));
vi.mock("./managed-workspace-fields", () => ({
  WORK_LOCATION_OPTIONS: [],
  WorktreeTargetFields: () => null,
}));
vi.mock("./channel-route-bot-options", () => ({
  useRouteBotOptions: function BotOptionsAdapter() {
    const [, rerender] = React.useReducer((count: number) => count + 1, 0);
    React.useEffect(() => {
      adapters.botListeners.add(rerender);
      return () => void adapters.botListeners.delete(rerender);
    }, []);
    return { options: adapters.botOptions, loading: false };
  },
}));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: undefined }),
}));
vi.mock("./automation-settings", () => ({
  SingleAgentAutomationForm: function TestAutomation(props: { save(yaml: string): Promise<void> }) {
    const save = React.useCallback(() => void props.save("name: new-support"), [props]);
    return (
      <button type="button" onClick={save}>
        Finish inline Automation
      </button>
    );
  },
}));

const route = {
  audience: [{ who: { roles: ["member"] }, where: { conversations: ["C1"] }, contains: "#help" }],
  workflow: "support",
  binding: { key: "thread" },
  sync: { subagents: { finalAnswers: true } },
  approval: [
    { match: "command.destructive", mode: "require" },
    { match: "*", mode: "auto-deny" },
  ],
};
const account = {
  channel: "slack",
  accountId: "support",
  enabled: true,
  connectionId: "connection",
  routes: [route],
};
const configuration = {
  revision: { id: "revision", version: 1, createdAt: "2026-09-05T00:00:00Z" },
  policy: {},
  resource: {},
  accounts: [account],
};
const data: Record<string, unknown> = {
  "channel-configuration": configuration,
  // The Add-connection form is catalog-driven, so the accounts editor reads the
  // Hub's catalog before it can offer a channel to connect.
  "channel-catalog": CHANNEL_CATALOG_RESPONSE,
  connections: {
    connections: [
      {
        id: "connection",
        provider: "slack",
        name: "Support",
        externalName: null,
        status: "active",
        consumers: [],
      },
    ],
    providerApplications: [],
  },
  automations: {
    automations: [
      { id: "automation", name: "support" },
      { id: "new-automation", name: "new-support" },
    ],
  },
  daemons: { daemons: [] },
  teams: { teams: [] },
  "access-assignments": { assignments: [] },
  "channel-configuration/revisions": { revisions: [] },
  "channel-accounts/status": {
    runtimeAvailable: true,
    accounts: [
      {
        channel: "slack",
        account: "support",
        transport: "started",
        integrity: "ok",
        loadTrace: "ok",
      },
    ],
  },
  "channel-accounts/slack/support/activity": { activity: [] },
  "channel-accounts/slack/support/conversations": {
    conversations: [],
    destinations: [
      {
        id: "C1",
        kind: "channel",
        rootConversationId: "C1",
        threadId: null,
        label: "#support",
        visibility: "public",
        source: "provider",
      },
    ],
  },
};
let queryClient: QueryClient;
beforeEach(() => {
  vi.stubGlobal("React", React);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  adapters.get.mockReset().mockImplementation(async (resource: string) => data[resource]);
  adapters.post.mockReset().mockResolvedValue({ name: "new-support" });
  adapters.delete.mockReset().mockResolvedValue(undefined);
  adapters.put.mockReset().mockResolvedValue(configuration);
  adapters.confirm.mockReset().mockResolvedValue(true);
  adapters.scrollToTop.mockReset();
  adapters.canManage = true;
  adapters.accountId = "owner";
  adapters.teamMembers = [];
  adapters.botOptions = [];
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

/** A test message starts from the Connection's menu and goes where the form points. */
function startTestMessage() {
  fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
  fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview and send" }));
}
/** Add Route on a Connection that has a Route heads the Connection's menu. */
async function addRouteFromMenu(accountId = "support") {
  fireEvent.click(
    await screen.findByRole("button", { name: `Actions for ${accountId}` }, { timeout: 10_000 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Route" }));
}
/** Revision history and Advanced YAML open from the Connections page menu. */
function openPagePanel(name: "Advanced YAML" | "Revision history") {
  fireEvent.click(screen.getByRole("button", { name: "More Connection actions" }));
  fireEvent.click(screen.getByRole("button", { name }));
}
function renderChannels(automationName?: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <HubSettingsDetailScrollProvider onNavigate={adapters.scrollToTop}>
        <ChannelSettings automationName={automationName} />
      </HubSettingsDetailScrollProvider>
    </QueryClientProvider>,
  );
}
function radio(name: string) {
  return screen.getByRole("radio", { name });
}
function saveButton() {
  return screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement;
}
async function openEditor() {
  renderChannels();
  // Every Route is on the Connections page itself: no Connection to open first.
  await screen.findByRole("button", { name: /^Edit Route/ }, { timeout: 10_000 });
  adapters.scrollToTop.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
  await screen.findByText("Edit Route 1");
  expect(adapters.scrollToTop).toHaveBeenCalledTimes(1);
}

describe("Connection focused editing", { timeout: 20_000 }, () => {
  it("retains dirty YAML across local views and resets it for a different principal", async () => {
    const ui = renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    openPagePanel("Advanced YAML");
    const yaml = screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement;
    const draft = `${yaml.value}\n# draft retained locally`;
    fireEvent.change(yaml, { target: { value: draft } });
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Advanced YAML" }));
    openPagePanel("Advanced YAML");
    expect((screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement).value).toBe(draft);
    fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement).value).toBe(draft);
    adapters.accountId = "other-owner";
    ui.rerender(
      <QueryClientProvider client={queryClient}>
        <HubSettingsDetailScrollProvider onNavigate={adapters.scrollToTop}>
          <ChannelSettings />
        </HubSettingsDetailScrollProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /^Edit Route/ });
    openPagePanel("Advanced YAML");
    expect(
      (screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement).value,
    ).not.toContain("draft retained locally");
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it.each([
    { label: "Actions for support", title: "Remove support?" },
    { label: "Actions for Route 1", title: "Remove Route 1?" },
  ])("keeps Remove inside $label and Cancel does not write", async ({ label, title }) => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    adapters.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(await screen.findByText("Remove"));
    await waitFor(() =>
      expect(adapters.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title, destructive: true }),
      ),
    );
    expect(adapters.put).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeTruthy();
  });

  it("shows every Connection and its Routes on one page: destination, Rules, then how it replies", async () => {
    // A Route the form created for itself carries a generated Agent name; the
    // list names it by provider and model instead.
    const agentRoute = {
      audience: route.audience,
      agent: "channel-support",
      environment: "channel-support",
      outbound: { path: "relay" },
      limits: { messagesPerMinute: 5 },
    };
    const page = {
      ...configuration,
      resource: { agents: { "channel-support": { provider: "codex", model: "gpt-5.6-luna" } } },
      accounts: [{ ...account, routes: [agentRoute] }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? page : data[resource],
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    // The header is one line: name, a status badge, and what it can do.
    expect(screen.getByText("Slack · support")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText(/1 route/)).toBeNull();
    expect(screen.queryByText(/First match wins/)).toBeNull();
    // A Connection with a Route adds the next one from its menu, first item.
    expect(screen.queryByRole("button", { name: "Add Route" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    expect(screen.getByRole("button", { name: "Add Route" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    expect(screen.getByRole("button", { name: "Add Connection" })).toBeTruthy();
    // Where messages go, one line per Rule, then how it answers; no "Route 1"
    // for a single Route.
    expect(screen.getByText("Codex gpt-5.6-luna")).toBeTruthy();
    expect(
      await screen.findByText("#support (C1) · Everyone on the Hub · when mentioned · “#help”"),
    ).toBeTruthy();
    expect(screen.getByText("Text forward · Ask for approval · Custom limits")).toBeTruthy();
    expect(screen.queryByText(/channel-support/)).toBeNull();
  });

  it("lists every channel's bot Connection, and no integration Connection", async () => {
    // A Route can use a Connection a sender's identity resolves through: a
    // channel bot's or a Slack workspace's. GitHub has none to offer.
    const routeless = { ...configuration, accounts: [] };
    const connections = {
      connections: [
        {
          id: "zalo-bot",
          provider: "zalo",
          name: "shop",
          externalName: null,
          status: "active",
          identityRealm: "zalo:bot:zalo-bot",
          consumers: [],
        },
        {
          id: "github",
          provider: "github",
          name: "acme",
          externalName: null,
          status: "active",
          identityRealm: null,
          consumers: [],
        },
      ],
      providerApplications: [],
    };
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return routeless;
      if (resource === "connections") return connections;
      return data[resource];
    });
    renderChannels();
    expect(await screen.findByText("Zalo Official Bot · shop")).toBeTruthy();
    expect(screen.queryByText(/acme/)).toBeNull();
  });

  it("keeps a Connection whose Routes were removed on the page, ready for a new Route", async () => {
    // Removing a Connection's Routes offers to keep its credential; the
    // Connection then has no account, and must not disappear from the page.
    const routeless = { ...configuration, accounts: [] };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? routeless : data[resource],
    );
    renderChannels();
    expect(await screen.findByText("Slack · Support")).toBeTruthy();
    expect(screen.getByText("No Routes")).toBeTruthy();
    expect(screen.queryByText(/No Connections yet/)).toBeNull();
    expect(screen.queryByLabelText(/able Support/)).toBeNull();
    // Remove disconnects the credential, after a confirmation.
    adapters.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Support" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(adapters.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Disconnect Support?", destructive: true }),
      ),
    );
    expect(adapters.delete).not.toHaveBeenCalled();
    // Add Route opens the form with that Connection already picked.
    fireEvent.click(screen.getByRole("button", { name: "Add Route" }));
    expect(((await screen.findByLabelText("Connection")) as HTMLSelectElement).value).toBe(
      "connection:connection",
    );
  });

  it("disconnects a Connection with no Routes from its card", async () => {
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? { ...configuration, accounts: [] } : data[resource],
    );
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Support" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(adapters.delete).toHaveBeenCalledWith("connections/connection"));
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("keeps a single Route concise without ordering or Connection settings", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeTruthy();
    // One Route has no order to read: no number, and nothing to move.
    expect(screen.queryByText(/^Route 1 ·/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Route 1" }));
    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();
    expect(screen.queryByText("Connection settings")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Admins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change Bot limits" })).toBeNull();
    expect(screen.queryByText(/Configuration revision/)).toBeNull();
    expect(screen.queryByText("Anyone no Route admits is refused.")).toBeNull();
  });

  it("offers Retry runtime from the Connection menu when the runtime is not up", async () => {
    // The Hub sends "active" for every Channel Connection, so a gate that tested
    // for "connected" never fired. This asserts the action from the real shape.
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource !== "channel-accounts/status") return data[resource];
      return {
        runtimeAvailable: true,
        accounts: [
          {
            channel: "slack",
            account: "support",
            transport: "failed",
            integrity: "failed",
            loadTrace: "failed",
          },
        ],
      };
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    // A Connection that did not load says which revision, and how far it got.
    expect(screen.getByText(/Configuration revision .* Integrity failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    fireEvent.click(await screen.findByText("Retry runtime"));
    await waitFor(() =>
      expect(adapters.post).toHaveBeenCalledWith(
        "channel-accounts/slack/support/retry",
        {},
        expect.anything(),
      ),
    );
  });

  it("needs a chat on a group-chat rule: emptying the chats blocks saving until Every chat is chosen", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
    // Named conversations read as group chats, at the chats picked.
    expect(radio("Chats I pick").getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: "" },
    });
    expect(screen.getByText("Pick a chat, or choose Every chat the bot is in.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(adapters.put).not.toHaveBeenCalled();
    // Every chat is its own, exclusive pick.
    fireEvent.click(radio("Every chat the bot is in"));
    expect(screen.queryByLabelText("Conversation IDs")).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalled());
    const saved = adapters.put.mock.calls[0]![1].accounts[0].routes[0];
    // The text condition stays on the rule it belongs to.
    expect(saved.audience).toEqual([
      { who: { roles: ["member"] }, where: { groups: "all" }, contains: "#help" },
    ]);
    expect(saved.contains).toBeUndefined();
    expect(saved.match).toBeUndefined();
  });

  it("reads a Route open to every group chat and offers the Slack visibility filter", async () => {
    const unrestricted = {
      ...configuration,
      accounts: [
        {
          ...account,
          routes: [
            { ...route, audience: [{ who: { roles: ["member"] }, where: { groups: "all" } }] },
          ],
        },
      ],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? unrestricted : data[resource],
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
    expect(screen.queryByLabelText("Conversation IDs")).toBeNull();
    expect(radio("Every chat the bot is in").getAttribute("aria-checked")).toBe("true");
    // The catalog says Slack reports visibility, so the filter is offered once it loads.
    fireEvent.click(await screen.findByRole("radio", { name: "Every public chat" }));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience).toEqual([
      { who: { roles: ["member"] }, where: { groups: "public" } },
    ]);
  });

  it("adds and removes rules, and Anyone shows its warning instead of a people picker", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
    // A lone rule is the Route's only way in: no box, no title, nothing to fold.
    expect(screen.queryByText("Rule 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Rule 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    // Two rules: each is titled; the first folds to its summary.
    expect(screen.getByText("Rule 1")).toBeTruthy();
    expect(
      screen.getByText("#support (C1) · Everyone on the Hub · when mentioned · “#help”"),
    ).toBeTruthy();
    // The Route already takes group chats, so the new rule is for DMs: Owners,
    // answered without a mention. It saves as it stands.
    const added = screen.getByLabelText("Rule 2");
    expect(
      within(added).getByRole("radio", { name: "Only owners" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect((within(added).getByLabelText("Require a mention") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(within(added).getByRole("radio", { name: "Anyone on Slack" }));
    expect(
      screen.getByText("Anyone in the matching conversations can use this Route"),
    ).toBeTruthy();
    expect(within(added).queryByLabelText("People")).toBeNull();
    // Opening the first rule folds the new one to its summary.
    fireEvent.click(screen.getByRole("button", { name: "Edit Rule 1" }));
    expect(screen.getByText("DMs · Anyone")).toBeTruthy();
    // Remove sits behind the rule's menu, away from Edit.
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Rule 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("DMs · Anyone")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for Rule 1" })).toBeNull();
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("offers a thread choice per place, and writes the DM one only once it is set", async () => {
    await openEditor();
    // Group chats only: one plain switch.
    expect(screen.getByLabelText("Reply in a thread")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    // DMs too: one switch per place, the DM one off as every DM answered before.
    expect((screen.getByLabelText("Reply in a thread in DMs") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByLabelText("Reply in a thread in group chats")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Reply in a thread in DMs"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].reply).toEqual({
      anchor: "default",
      dmAnchor: "thread",
    });
  });

  it("saves a DM rule open to anyone on the channel with its own mention setting", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    const added = screen.getByLabelText("Rule 2");
    fireEvent.click(within(added).getByRole("radio", { name: "Anyone on Slack" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience).toEqual([
      // The rule nobody touched is written back as it was stored.
      { who: { roles: ["member"] }, where: { conversations: ["C1"] }, contains: "#help" },
      { who: { anyone: true }, where: { dm: true }, interaction: { requireMention: false } },
    ]);
  });

  it("keeps each rule's mention and follow-up on that rule", async () => {
    await openEditor();
    // The group-chat rule inherits "when mentioned" from the defaults.
    expect((screen.getByLabelText("Require a mention") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Continue without a mention"));
    const minutes = screen.getByLabelText("For this many minutes after the bot's last reply");
    fireEvent.change(minutes, { target: { value: "15" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const saved = adapters.put.mock.calls[0]![1].accounts[0].routes[0];
    expect(saved.audience).toEqual([
      {
        who: { roles: ["member"] },
        where: { conversations: ["C1"] },
        interaction: { followUp: { mode: "auto", ttlMinutes: 15 } },
        contains: "#help",
      },
    ]);
    // Nothing about mentions is written on the Route itself.
    expect(saved.interaction).toBeUndefined();
  });

  it("picks roles, Teams and Members from one list and saves each to its own list", async () => {
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "teams"
        ? { teams: [{ id: "team-qc", name: "QC", createdAt: "2026-09-01T00:00:00Z" }] }
        : data[resource],
    );
    await openEditor();
    // Everyone on the Hub is a rung of the ladder; naming people is its own choice.
    expect(radio("Everyone on the Hub").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("People")).toBeNull();
    fireEvent.click(radio("Only people I pick"));
    const people = screen.getByLabelText("People") as HTMLSelectElement;
    expect(Array.from(people.options, ({ value }) => value)).toEqual([
      "role:owner",
      "role:admin",
      "role:member",
      "team:team-qc",
    ]);
    expect(people.options[3]!.dataset["group"]).toBe("Teams");
    // A pick starts empty: the rung it left is not a person picked.
    expect(Array.from(people.options).some((option) => option.selected)).toBe(false);
    expect(screen.getByText("Pick at least one person.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    people.options[3]!.selected = true;
    fireEvent.change(people);
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience[0].who).toEqual({
      teams: ["team-qc"],
    });
  });

  it("lists a Guest the bot has not seen under its id and keeps it on save", async () => {
    adapters.teamMembers = [{ id: "m-aitran", name: "aitran" }];
    const guestRoute = {
      ...route,
      audience: [{ who: { identities: ["U0GUEST"] }, where: { dm: true } }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [guestRoute] }] }
        : data[resource],
    );
    await openEditor();
    expect(radio("Only people I pick").getAttribute("aria-checked")).toBe("true");
    const people = screen.getByLabelText("People") as HTMLSelectElement;
    const guest = Array.from(people.options).find(({ value }) => value === "guest:U0GUEST")!;
    expect(guest.dataset["group"]).toBe("From Slack");
    expect(guest.selected).toBe(true);
    const member = Array.from(people.options).find(({ value }) => value === "member:m-aitran")!;
    expect(member.dataset["group"]).toBe("Hub people");
    member.selected = true;
    fireEvent.change(people);
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience).toEqual([
      { who: { members: ["m-aitran"], identities: ["U0GUEST"] }, where: { dm: true } },
    ]);
  });

  it("keeps an older rule that narrowed DMs as it was until Who is chosen again", async () => {
    adapters.teamMembers = [{ id: "m-aitran", name: "aitran" }];
    const narrowed = {
      who: { roles: ["member"] },
      where: { dmMembers: ["m-aitran"] },
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? {
            ...configuration,
            accounts: [{ ...account, routes: [{ ...route, audience: [narrowed] }] }],
          }
        : data[resource],
    );
    await openEditor();
    expect(screen.getByText("Only aitran")).toBeTruthy();
    expect(screen.queryByLabelText("People")).toBeNull();
    // Pressing the choice it already reads as changes nothing.
    fireEvent.click(radio("Only people I pick"));
    expect(screen.getByText("Only aitran")).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience).toEqual([narrowed]);
  });

  it("edits an older narrowed rule from exactly the people it let in", async () => {
    adapters.teamMembers = [{ id: "m-aitran", name: "aitran" }];
    const narrowed = { who: { roles: ["member"] }, where: { dmMembers: ["m-aitran"] } };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? {
            ...configuration,
            accounts: [{ ...account, routes: [{ ...route, audience: [narrowed] }] }],
          }
        : data[resource],
    );
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit these people" }));
    const people = screen.getByLabelText("People") as HTMLSelectElement;
    const picked = Array.from(people.options).filter((option) => option.selected);
    expect(picked.map(({ value }) => value)).toEqual(["member:m-aitran"]);
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    // Never wider than before: aitran alone, in every DM.
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].audience).toEqual([
      { who: { members: ["m-aitran"] }, where: { dm: true } },
    ]);
  });

  it("starts an empty pick after Anyone, so the rule cannot save open by accident", async () => {
    await openEditor();
    fireEvent.click(radio("Anyone in the chat"));
    fireEvent.click(radio("Only people I pick"));
    expect(radio("Only people I pick").getAttribute("aria-checked")).toBe("true");
    const people = screen.getByLabelText("People") as HTMLSelectElement;
    expect(Array.from(people.options).some((option) => option.selected)).toBe(false);
    expect(screen.getByText("Pick at least one person.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("refuses to edit a Route an older Hub keeps a condition on", async () => {
    const legacy = { ...route, contains: "#help", audience: [route.audience[0]] };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [legacy] }] }
        : data[resource],
    );
    await openEditor();
    expect(screen.getByText("Update this Hub to edit this Route")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("asks to save first where no bot runs yet, since a /link would reach nothing", async () => {
    adapters.teamMembers = [{ id: "member", name: "Long", role: "owner" }];
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-identities") return { identities: [] };
      // The Connection has no account yet: its bot starts when the Route is saved.
      if (resource === "channel-configuration") return { ...configuration, accounts: [] };
      return data[resource];
    });
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Add Route" }));
    expect(
      await screen.findByText(/The bot starts on Slack when you save this Route/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link my Slack account" })).toBeNull();
  });

  it("offers the link on the Connection's card once its Rules name an unlinked owner", async () => {
    adapters.teamMembers = [{ id: "member", name: "Long", role: "owner" }];
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-identities" ? { identities: [] } : data[resource],
    );
    renderChannels();
    // The Route lets in Everyone on the Hub, the owner included.
    expect(
      await screen.findByText(
        "The bot can't recognize you on Slack yet, so the Rules that name you do not let you in.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link my Slack account" })).toBeTruthy();
  });

  it("offers the person editing a link in place when a rule names them but the bot cannot recognize them", async () => {
    adapters.teamMembers = [{ id: "member", name: "Long", role: "owner" }];
    let identities: { identities: unknown[] } = { identities: [] };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-identities" ? identities : data[resource],
    );
    // The first code is already expired; Create a new code must show the new one.
    const codes = [
      { command: "/link ZZZZZ-ZZZZZ", expiresAt: new Date(Date.now() - 1_000).toISOString() },
      { command: "/link ABCDE-FGHJK", expiresAt: new Date(Date.now() + 600_000).toISOString() },
    ];
    adapters.post.mockImplementation(async (resource: string) =>
      resource === "channel-identities/challenges" ? codes.shift() : { name: "new-support" },
    );
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    // Only owners names the person editing, who has not linked Slack yet.
    expect(
      await screen.findByText(
        "The bot can't recognize you on Slack yet, so this rule does not let you in.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Long (not linked on Slack)").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Link my Slack account" }));
    expect(await screen.findByText("This code expired.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create a new code" }));
    expect(await screen.findByText("/link ABCDE-FGHJK")).toBeTruthy();
    expect(screen.queryByText("This code expired.")).toBeNull();
    expect(adapters.post).toHaveBeenCalledWith(
      "channel-identities/challenges",
      { connectionId: "connection" },
      expect.anything(),
    );
    // The link lands; the form notices on its next look and drops the prompt.
    identities = {
      identities: [{ id: "identity", memberId: "member", connectionId: "connection" }],
    };
    await waitFor(() => expect(screen.queryByText(/can't recognize you on Slack/)).toBeNull(), {
      timeout: 8_000,
    });
    expect(screen.getAllByText("Long").length).toBeGreaterThan(0);
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("lands the Hub's rule-level refusal on the rule it names", async () => {
    adapters.put.mockRejectedValue(
      new Error(
        "channels/slack/support.yml.routes.0.audience.0.who: an audience rule needs at least one Who part",
      ),
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: /^Edit Route/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    // The whole message stays in the header; the rule's row gets only its part.
    expect(await screen.findByText("an audience rule needs at least one Who part")).toBeTruthy();
    expect(screen.getByText(/routes\.0\.audience\.0\.who/)).toBeTruthy();
  });

  it.each([false, true])(
    "previews exact Hub text and only sends after confirmation=%s",
    async (confirmed) => {
      const preview = {
        channel: "slack",
        accountId: "support",
        conversationId: "C1",
        threadId: null,
        requestedThreadId: null,
        text: "  Exact backend test text — preserved\n\n  Second line with  spaces\n",
        replyToMessageId: null,
        attachments: [],
        revisionId: "revision",
        previewId: "preview-fingerprint",
        label: "#support",
      };
      adapters.get.mockImplementation(async (resource: string) =>
        resource.includes("/test-preview?") ? preview : data[resource],
      );
      adapters.confirm.mockResolvedValue(confirmed);
      renderChannels();
      await screen.findByRole("button", { name: /^Edit Route/ });
      startTestMessage();
      await waitFor(() =>
        expect(adapters.confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Send test message?",
            confirmLabel: "Send test message",
            body: expect.anything(),
          }),
        ),
      );
      const review = render(adapters.confirm.mock.calls[0]![0].body);
      expect(review.getByText("Send to")).toBeTruthy();
      expect(review.getByText("#support (C1)")).toBeTruthy();
      expect(review.getByText("Message to send")).toBeTruthy();
      const message = review.getByTestId("channel-test-message");
      expect(message.textContent).toBe(preview.text);
      const explanation = review.getByText(/No attachments/);
      expect(message.contains(explanation)).toBe(false);
      if (confirmed) {
        await waitFor(() =>
          expect(adapters.post).toHaveBeenCalledWith(
            "channel-accounts/slack/support/test",
            {
              conversationId: "C1",
              expectedText: preview.text,
              expectedRevisionId: "revision",
              expectedPreviewId: "preview-fingerprint",
            },
            expect.anything(),
          ),
        );
        expect(await screen.findByText("Test message sent to #support.")).toBeTruthy();
      } else expect(adapters.post).not.toHaveBeenCalled();
    },
  );

  it("fails closed when an older Hub cannot preview the outgoing test", async () => {
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource.includes("/test-preview?")) throw new HubApiError(404, "not_found", "not found");
      return data[resource];
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    startTestMessage();
    await screen.findByText(/This Hub cannot preview test messages/);
    expect(adapters.confirm).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("renders provider names with canonical IDs and keeps IDs usable when metadata is unavailable", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(await screen.findByText(/#support \(C1\)/)).toBeTruthy();
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource.endsWith("/conversations")) throw new Error("provider metadata unavailable");
      return data[resource];
    });
    adapters.accountId = "other-owner";
    cleanup();
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.getByText(/^C1 · Everyone on the Hub/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeTruthy();
  });

  it("reports a changed preview without success or automatic replay", async () => {
    adapters.get.mockImplementation(async (resource: string) =>
      resource.includes("/test-preview?")
        ? {
            channel: "slack",
            accountId: "support",
            conversationId: "C1",
            threadId: null,
            requestedThreadId: null,
            text: "Canonical test",
            revisionId: "revision",
            previewId: "old-preview",
            replyToMessageId: null,
            attachments: [],
          }
        : data[resource],
    );
    adapters.post.mockRejectedValue(
      new HubApiError(
        409,
        "conflict",
        "The test destination changed. Preview again before sending.",
      ),
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    startTestMessage();
    await screen.findByText(/test destination changed/);
    expect(screen.queryByText(/Test message sent to/)).toBeNull();
    expect(adapters.post).toHaveBeenCalledTimes(1);
    expect(adapters.post).toHaveBeenCalledWith(
      "channel-accounts/slack/support/test",
      expect.objectContaining({ expectedPreviewId: "old-preview" }),
      expect.anything(),
    );
  });

  it("reorders Routes from the Route menu while preserving the other configuration", async () => {
    const otherRoute = {
      ...route,
      audience: [
        { who: { roles: ["member"] }, where: { conversations: ["C2"] }, contains: "#second" },
      ],
    };
    const multiple = {
      ...configuration,
      accounts: [{ ...configuration.accounts[0], routes: [route, otherRoute] }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? multiple : data[resource],
    );
    renderChannels();
    await screen.findAllByRole("button", { name: /^Edit Route/ });
    expect(screen.getByText(/^Route 2 · /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Route 1" }));
    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() =>
      expect(adapters.put).toHaveBeenCalledWith(
        "channel-configuration",
        expect.objectContaining({
          accounts: [{ ...multiple.accounts[0], routes: [otherRoute, route] }],
        }),
        expect.anything(),
      ),
    );
  });

  it("separates activity from configuration and preserves account and activity selection", async () => {
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource.startsWith("channel-activity?"))
        return {
          activity: [
            {
              id: "activity",
              createdAt: "2026-09-05T00:00:00Z",
              channel: "slack",
              accountId: "support",
              routePosition: 0,
              conversationId: "C1",
              threadId: null,
              providerSenderId: "sender",
              outcome: "bound",
              limitDecision: "allowed",
            },
          ],
          nextCursor: null,
        };
      return data[resource];
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeTruthy();
    expect(screen.queryByText("Channel activity")).toBeNull();
    expect(adapters.get.mock.calls.some(([resource]) => resource.includes("activity"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    fireEvent.click(screen.getByRole("button", { name: "View activity" }));
    expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe("slack:support");
    expect(screen.queryByRole("button", { name: /^Edit Route/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Back to Activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeTruthy();
    expect(screen.queryByText("Channel activity")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("button", { name: "Back to Activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Activity" }));
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    expect(adapters.put).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("starts with accounts only and keeps Advanced YAML in the page menu until requested", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    expect(screen.queryByLabelText("Configuration YAML")).toBeNull();
    expect(screen.queryByText("Revision history")).toBeNull();
    openPagePanel("Advanced YAML");
    expect(screen.getByLabelText("Configuration YAML")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide Advanced YAML" }));
    expect(screen.queryByLabelText("Configuration YAML")).toBeNull();
  });

  it("keeps only the active revision on screen and discloses the earlier ones", async () => {
    const revisions = [
      { id: "revision", version: 6, createdAt: "2026-09-16T04:10:48Z" },
      { id: "r5", version: 5, createdAt: "2026-09-15T17:02:11Z" },
      { id: "r4", version: 4, createdAt: "2026-09-15T16:48:25Z" },
    ];
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration/revisions" ? { revisions } : data[resource],
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    expect(screen.queryByText("Revision 6 · Active")).toBeNull();
    openPagePanel("Revision history");
    expect(await screen.findByText("Revision 6 · Active")).toBeTruthy();
    expect(screen.queryByText("Revision 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 earlier" }));
    expect(screen.getByText("Revision 5")).toBeTruthy();
    expect(screen.getByText("Revision 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide earlier" }));
    expect(screen.queryByText("Revision 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Revision 6 · Active")).toBeNull();
  });

  it.each([
    { hosts: 1, expected: "runtime" },
    { hosts: 2, expected: "" },
  ])("picks the only Host for a new Route ($hosts Hosts)", async ({ hosts, expected }) => {
    const daemons = [
      { id: "daemon", slug: "Workstation", connectionOffer: { serverId: "runtime" } },
      { id: "laptop", slug: "Laptop", connectionOffer: { serverId: "laptop-runtime" } },
    ].slice(0, hosts);
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "daemons" ? { daemons } : data[resource],
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    await addRouteFromMenu();
    // The Host's Projects and providers load from the runtime it resolves to.
    expect(screen.getByLabelText("Selected Host runtime").textContent).toBe(expected);
  });

  it("adds a Route from a Connection's card with thread replies enabled by default", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    // The card's Add Route belongs to that Connection, so the form names it
    // instead of offering a picker.
    await addRouteFromMenu();
    expect(screen.queryByLabelText("Connection")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect a new one" })).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByText("Slack · support")).toBeTruthy();
    // A new Route starts with one rule: Owners, in DMs, answered without a
    // mention. It is complete as it stands.
    expect(screen.getByText("Rules")).toBeTruthy();
    expect(radio("Only owners").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Require a mention") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText("Conversation IDs")).toBeNull();
    expect(screen.queryByLabelText("People")).toBeNull();
    expect(screen.queryByText("No senders selected.")).toBeNull();
    // Group chats starts at the chats picked, answered when mentioned.
    fireEvent.click(screen.getByRole("button", { name: "Group chats" }));
    expect(screen.getByLabelText("Conversation IDs")).toBeTruthy();
    expect((screen.getByLabelText("Require a mention") as HTMLInputElement).checked).toBe(true);
    // A group chat in the rule brings the thread settings back.
    fireEvent.change(screen.getByLabelText("Conversation IDs"), { target: { value: "C9" } });
    // A new Route starts an Agent; Automation is still experimental and says so.
    expect(screen.queryByLabelText("Automation")).toBeNull();
    expect(screen.queryByText("Experimental")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run an Automation" }));
    expect(screen.getByLabelText("Automation")).toBeTruthy();
    expect(screen.getByText("Experimental")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start or continue an Agent" }));
    expect(screen.queryByText("Experimental")).toBeNull();
    expect((screen.getByLabelText("Reply in a thread") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Text forward" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Channel tool only" })).toBeTruthy();
    // Hybrid is the default: the answer is relayed as text, so the relay
    // switches stay, and the tool is attached for files and actions.
    expect(screen.getByRole("radio", { name: "Hybrid" })).toBeTruthy();
    expect(
      screen.getByText(
        "The answer as text, plus files, reactions and edits through the Channel tool",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Send final answers")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Channel tool only" }));
    expect(screen.getByText("The Agent controls replies")).toBeTruthy();
    expect(screen.queryByLabelText("Send final answers")).toBeNull();
    // Limits, Incoming messages and Advanced hold nothing yet, so they start folded.
    expect(screen.getAllByText("No limits").length).toBeGreaterThan(0);
    expect(screen.getByText("Fast mode and provider options")).toBeTruthy();
    expect(screen.queryByLabelText("Provider options")).toBeNull();
    expect(screen.getByRole("button", { name: "Activate Route" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Actions for support" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
  });

  it("accepts every permission request and saves how questions are answered", async () => {
    await openEditor();
    // A question is not a permission, so its choice is offered whatever the
    // permission choice is, and switching that choice keeps it.
    fireEvent.click(screen.getByRole("radio", { name: "Pick the recommended answer" }));
    fireEvent.click(screen.getByRole("radio", { name: "Ask authorized members" }));
    fireEvent.click(screen.getByRole("radio", { name: "Accept automatically" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const saved = adapters.put.mock.calls[0]![1].accounts[0].routes[0];
    expect(saved.approval).toEqual([{ match: "*", mode: "auto-allow" }]);
    expect(saved.questions).toBe("recommended");
  });

  it("preserves the new-account draft through Connection creation then closes after Route activation", async () => {
    let current: Record<string, unknown> = configuration;
    let currentConnections = data.connections;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return current;
      if (resource === "connections") return currentConnections;
      if (resource.endsWith("/activity")) return { activity: [] };
      return data[resource];
    });
    adapters.put.mockImplementation(
      async (_resource: string, candidate: Record<string, unknown>) => {
        current = { ...configuration, ...candidate };
        return current;
      },
    );
    adapters.post.mockImplementation(async (resource: string) => {
      if (resource !== "connections") return {};
      const created = {
        id: "new-connection",
        provider: "telegram",
        name: "New bot",
        externalName: null,
        status: "active",
        consumers: [],
      };
      currentConnections = {
        connections: [...(data.connections as { connections: unknown[] }).connections, created],
        providerApplications: [],
      };
      return created;
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    // Add Connection opens the Route form on its connect step; its way out is
    // the form's picker, which offers the Connection that already has Routes.
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    expect(await screen.findByText("Connect Telegram")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use an existing Connection" }));
    expect(screen.getByText("Or")).toBeTruthy();
    expect(
      (screen.getByLabelText("Connection") as HTMLSelectElement).querySelector(
        'option[value="account:slack:support"]',
      ),
    ).toBeTruthy();
    // No Connection picked yet, so there is nothing to name.
    expect(screen.queryByLabelText("Name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run an Automation" }));
    fireEvent.change(screen.getByLabelText("Automation"), {
      target: { value: "support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect a new one" }));
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
    // The Add-connection form is catalog-driven, so it mounts once the Hub's
    // catalog read lands and the first connectable channel is chosen.
    fireEvent.change(await screen.findByRole("textbox", { name: "Connection name" }), {
      target: { value: "new-bot" },
    });
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: "bot-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull(),
    );
    // The new Connection is picked; it was named in the connect step, so its
    // first Route takes that name without asking again.
    expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
      "connection:new-connection",
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect((screen.getByLabelText("Automation") as HTMLSelectElement).value).toBe("support");
    // A new Route starts on the Hub's Owners and Admins in DMs, so it activates as it stands.
    fireEvent.click(screen.getByRole("button", { name: "Activate Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull(),
    );
    expect(screen.getByText("Telegram · new-bot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    // The saved Route closed the form: the new Connection is on the page with its Route.
    expect(screen.getByRole("button", { name: "Actions for new-bot" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Use an existing Connection" }));
    expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("puts a new Connection's first Route on the account the Hub added with it", async () => {
    let current: Record<string, unknown> = configuration;
    let currentConnections = data.connections;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return current;
      if (resource === "connections") return currentConnections;
      return data[resource];
    });
    adapters.put.mockImplementation(
      async (_resource: string, candidate: Record<string, unknown>) => {
        current = { ...configuration, ...candidate };
        return current;
      },
    );
    adapters.post.mockImplementation(async (resource: string) => {
      if (resource !== "connections") return {};
      const created = {
        id: "new-connection",
        provider: "telegram",
        name: "new-bot",
        externalName: null,
        status: "active",
        identityRealm: "telegram:bot:new-connection",
        consumers: [],
      };
      currentConnections = {
        connections: [...(data.connections as { connections: unknown[] }).connections, created],
        providerApplications: [],
      };
      // The Hub adds the running account with the Connection, no Routes yet,
      // and that write moves the configuration to a new revision.
      const accounts = (configuration as { accounts: Record<string, unknown>[] }).accounts;
      current = {
        ...configuration,
        revision: { ...configuration.revision, id: "revision-with-connection", version: 2 },
        accounts: [
          ...accounts,
          {
            channel: "telegram",
            accountId: "new-bot",
            enabled: true,
            connectionId: "new-connection",
            transport: { mode: "polling" },
            routes: [],
          },
        ],
      };
      return created;
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    const connectionName = await screen.findByRole("textbox", { name: "Connection name" });
    // The connect step suggests a name, so a first Connection needs no typing.
    expect((connectionName as HTMLInputElement).value).toMatch(/^telegram(-\d+)?$/u);
    fireEvent.change(connectionName, { target: { value: "new-bot" } });
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "bot-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
        "account:telegram:new-bot",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run an Automation" }));
    fireEvent.change(screen.getByLabelText("Automation"), { target: { value: "support" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate Route" }));
    // The form's own Connection add is not a concurrent edit: the save goes
    // through against the revision that add produced.
    await waitFor(() => expect(adapters.put).toHaveBeenCalledOnce());
    expect(adapters.put.mock.calls[0]![1]).toMatchObject({
      expectedRevisionId: "revision-with-connection",
    });
    const saved = adapters.put.mock.calls[0]![1].accounts as Record<string, unknown>[];
    const newBot = saved.filter((entry) => entry["accountId"] === "new-bot");
    expect(newBot).toHaveLength(1);
    expect((newBot[0]!["routes"] as unknown[]).length).toBe(1);
  });

  it("still stops the save when another change landed with the Connection add", async () => {
    let current: Record<string, unknown> = configuration;
    let currentConnections = data.connections;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return current;
      if (resource === "connections") return currentConnections;
      return data[resource];
    });
    adapters.put.mockImplementation(
      async (_resource: string, candidate: Record<string, unknown>) => {
        current = { ...configuration, ...candidate };
        return current;
      },
    );
    adapters.post.mockImplementation(async (resource: string) => {
      if (resource !== "connections") return {};
      const created = {
        id: "new-connection",
        provider: "telegram",
        name: "new-bot",
        externalName: null,
        status: "active",
        identityRealm: "telegram:bot:new-connection",
        consumers: [],
      };
      currentConnections = {
        connections: [...(data.connections as { connections: unknown[] }).connections, created],
        providerApplications: [],
      };
      // The Hub adds the running account with the Connection, no Routes yet,
      // and that write moves the configuration to a new revision.
      const accounts = (configuration as { accounts: Record<string, unknown>[] }).accounts;
      current = {
        ...configuration,
        revision: { ...configuration.revision, id: "revision-with-connection", version: 2 },
        accounts: [
          // Someone else edited an existing account in the same window.
          { ...accounts[0], enabled: false },
          ...accounts.slice(1),
          {
            channel: "telegram",
            accountId: "new-bot",
            enabled: true,
            connectionId: "new-connection",
            transport: { mode: "polling" },
            routes: [],
          },
        ],
      };
      return created;
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Connection name" }), {
      target: { value: "new-bot" },
    });
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "bot-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
        "account:telegram:new-bot",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run an Automation" }));
    fireEvent.change(screen.getByLabelText("Automation"), { target: { value: "support" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate Route" }));
    expect(await screen.findByText(/Channel configuration changed while editing/)).toBeTruthy();
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("logs a new QR Connection in right after it is named, before its first Route", async () => {
    let currentConnections = data.connections;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "connections") return currentConnections;
      return data[resource];
    });
    adapters.post.mockImplementation(async (resource: string) => {
      if (resource === "channel-accounts/whatsapp/support-wa/qr/start") {
        return {
          status: "pending",
          message: "Scan this QR in WhatsApp → Linked Devices.",
          qrDataUrl: "data:image/png;base64,AAAA",
        };
      }
      if (resource.endsWith("/qr/cancel")) return { cancelled: true, message: "Cancelled" };
      if (resource !== "connections") return {};
      const created = {
        id: "wa-connection",
        provider: "whatsapp",
        name: "support-wa",
        externalName: null,
        status: "active",
        identityRealm: "whatsapp:bot:wa-connection",
        consumers: [],
      };
      currentConnections = {
        connections: [...(data.connections as { connections: unknown[] }).connections, created],
        providerApplications: [],
      };
      return created;
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    // WhatsApp is one of the popular channels offered as a segment.
    fireEvent.click(await screen.findByRole("button", { name: "WhatsApp" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Connection name" }), {
      target: { value: "support-wa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    // The code shows without another click: the scan follows the name.
    expect(await screen.findByText("Scan with WhatsApp")).toBeTruthy();
    expect(screen.getByLabelText("Login QR code")).toBeTruthy();
    expect(screen.getByText(/Linked devices/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
    // Logging in later goes on to the Route, on the new Connection, and
    // cancels the code the Hub was waiting on.
    fireEvent.click(screen.getByRole("button", { name: "Log in later" }));
    await waitFor(() =>
      expect(adapters.post).toHaveBeenCalledWith(
        "channel-accounts/whatsapp/support-wa/qr/cancel",
        expect.anything(),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
        "connection:wa-connection",
      ),
    );
  });

  it("offers every channel this Hub can connect and swaps the credential form", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    expect(await screen.findByText("Connect Telegram")).toBeTruthy();
    // Slack Socket Mode is created from a Provider Application; this Member is
    // not an instance operator, so it is not on offer.
    // A few popular channels are one tap away; every channel is in the searchable list.
    // The first popular channel starts picked.
    const telegramSegment = screen
      .getAllByText("Telegram")
      .map((node) => node.closest("button"))
      .find((button) => button !== null);
    expect(telegramSegment?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "WhatsApp" })).toBeTruthy();
    const all = screen.getByLabelText("All channels") as HTMLSelectElement;
    const offered = [...all.options].map((option) => option.text);
    expect(offered).not.toContain("Slack");
    expect(offered).toContain("Zalo Official Bot");
    expect(offered).toContain("WhatsApp");
    fireEvent.change(all, { target: { value: "feishu" } });
    expect(await screen.findByText("Connect Feishu / Lark")).toBeTruthy();
    expect(screen.getByLabelText("App ID")).toBeTruthy();
    expect(screen.getByLabelText("App secret")).toBeTruthy();
    expect(screen.getByLabelText("Domain")).toBeTruthy();
    // Lark is the default, and each platform says which console it is for.
    expect(screen.getByRole("radio", { name: "Lark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Feishu" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByText(/larksuite\.com/)).toBeTruthy();
    expect(screen.getByText(/feishu\.cn/)).toBeTruthy();
    expect(screen.queryByLabelText("Bot token")).toBeNull();
  });

  it("keeps the authoritative saved revision and closes the editor when refresh fails", async () => {
    await openEditor();
    let saved = false;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration" && saved) throw new Error("Refresh unavailable");
      return data[resource];
    });
    adapters.put.mockImplementation(async () => {
      saved = true;
      return {
        ...configuration,
        revision: { ...configuration.revision, id: "saved-revision" },
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await screen.findByText("Refresh unavailable");
    expect(screen.queryByRole("button", { name: "Save Route" })).toBeNull();
    expect(adapters.put).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData([
        "clisbot",
        "hub",
        "https://hub.example.test",
        "org",
        "account",
        "owner",
        "channel-configuration",
      ]),
    ).toMatchObject({ revision: { id: "saved-revision" } });
  });

  it("waits for required editor sources and retries failed reads before mounting a fresh form", async () => {
    let unavailable = true;
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "automations" && unavailable) throw new Error("Automations unavailable");
      return data[resource];
    });
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    await screen.findByText("Automations unavailable");
    expect(screen.queryByLabelText("Connection")).toBeNull();
    unavailable = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry Channel setup" }));
    expect(await screen.findByText("Connect Telegram")).toBeTruthy();
  });

  it("keeps both navigation exits disabled while a Connection is being verified", async () => {
    let resolve!: (value: unknown) => void;
    adapters.post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Connection name" }), {
      target: { value: "bot" },
    });
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: "token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Back to Connections",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Use an existing Connection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () =>
      resolve({
        id: "created",
        provider: "telegram",
        name: "Bot",
        externalName: null,
        status: "active",
        consumers: [],
      }),
    );
  });

  it("gives Members an Account recovery path without requesting management configuration", async () => {
    adapters.canManage = false;
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "access-assignments/effective?include=team"
        ? { owner: false, grants: [] }
        : data[resource],
    );
    renderChannels();
    expect(await screen.findByRole("button", { name: "Open Account settings" })).toBeTruthy();
    // Only the viewer's own effective access was read: no configuration, no status.
    expect(adapters.get.mock.calls.map(([resource]) => resource)).toEqual([
      "access-assignments/effective?include=team",
    ]);
  });

  it("saves an unchanged Route without dropping any key the form does not show", async () => {
    // Every Route key the schema allows. A save from the form must never lose
    // one: a new schema key would otherwise vanish on the next edit in the app.
    const fullRoute = {
      ...route,
      template: "support-template",
      policy: { defaultRoles: ["member"] },
      workspace: { organize: false },
      access: { dmPolicy: "open" },
      agentControls: { model: "gpt-5" },
      agents: ["triage"],
      models: ["gpt-5"],
      questions: "recommended",
      sync: {
        subagents: { finalAnswers: true },
        toolCalls: { detail: "full", throttleSeconds: 0, whenThrottled: "skip", futureLeaf: 1 },
      },
      audience: [
        {
          ...route.audience[0],
          interaction: { requireMention: true, followUp: { mode: "auto", ttlMinutes: 30 } },
        },
      ],
      interaction: { whenBusy: "queue" },
      context: { unmentioned: "allowed-senders", maxMessages: 8 },
      batching: { pauseSeconds: 2, maxWaitSeconds: 6, maxMessages: 12 },
      reply: { anchor: "default" },
      outbound: { path: "relay", template: "support-reply" },
      limits: { messagesPerMinute: 5 },
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [fullRoute] }] }
        : data[resource],
    );
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0]).toMatchObject(fullRoute);
  });

  it("sets a Rule's own limits, and shows a stranger rule the open-Route defaults", async () => {
    await openEditor();
    // A Member rule on a Route with no limits of its own meets none.
    expect(within(screen.getByLabelText("Rule 1")).getByText("No limits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Limits" }));
    // The bot's own posting rate is not a Rule's: posts belong to no sender.
    expect(screen.queryByText("Bot messages per minute")).toBeNull();
    // One field per limit: typing sets it, empty is the default.
    fireEvent.change(screen.getByLabelText("Messages handled per minute, per person"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    const added = screen.getByLabelText("Rule 2");
    fireEvent.click(within(added).getByRole("radio", { name: "Anyone on Slack" }));
    expect(within(added).getByText("Default limits")).toBeTruthy();
    fireEvent.click(within(added).getByRole("button", { name: "Show Limits" }));
    expect(within(added).getByPlaceholderText("Default 8000")).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const saved = adapters.put.mock.calls[0]![1].accounts[0].routes[0];
    expect(saved.audience[0].limits).toEqual({ messagesPerMinutePerSender: 3 });
    // The stranger rule left every limit at its default: it writes none.
    expect(saved.audience[1].limits).toBeUndefined();
    expect(saved.limits).toBeUndefined();
  });

  it("keeps the Route's totals apart, and an earlier version's Route limits in view", async () => {
    const legacy = { ...route, limits: { maxInputCharacters: 500, messagesPerMinute: 30 } };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [legacy] }] }
        : data[resource],
    );
    await openEditor();
    expect(screen.getByText("Route limits")).toBeTruthy();
    // The Route section opens on its own: it holds values.
    expect(screen.getAllByText("Messages handled per minute").length).toBeGreaterThan(0);
    expect(screen.getByText(/set on the Route by an earlier version/)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].limits).toEqual(legacy.limits);
  });

  it("opens the bot's own limits from the Connection's menu and saves them on the account", async () => {
    renderChannels();
    await screen.findByRole("button", { name: /^Edit Route/ });
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    fireEvent.click(screen.getByRole("button", { name: "Limits" }));
    // The whole bot's fields come first, each conversation's after them.
    fireEvent.change(screen.getAllByLabelText("Bot messages per minute")[0]!, {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].limits).toEqual({
      messagesSentPerMinute: 30,
    });
  });

  it("edits Incoming messages and saves only the leaves the owner set", async () => {
    await openEditor();
    // An inherited Route authors nothing here, so the section starts folded.
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.queryByLabelText("Catch-up limit")).toBeNull();
    fireEvent.click(
      within(screen.getByText("Incoming messages").parentElement!.parentElement!).getByRole(
        "button",
        { name: "Show" },
      ),
    );
    expect((screen.getByLabelText("Catch-up limit") as HTMLInputElement).value).toBe("20");
    fireEvent.click(screen.getByRole("button", { name: "Allowed senders only" }));
    const batch = screen.getByLabelText("Batch message bursts") as HTMLInputElement;
    expect(batch.checked).toBe(false);
    fireEvent.click(batch);
    expect(
      (screen.getByLabelText("Send after no new messages for") as HTMLInputElement).value,
    ).toBe("3");
    fireEvent.change(screen.getByLabelText("Send anyway after"), { target: { value: "3" } });
    expect(screen.getByText("Must be longer than the pause.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Send anyway after"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    fireEvent.click(save);
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const saved = adapters.put.mock.calls[0]![1].accounts[0].routes[0];
    expect(saved.context).toEqual({ unmentioned: "allowed-senders" });
    expect(saved.batching).toEqual({ pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 20 });
    expect(saved.interaction.whenBusy).toBe("queue");
  });

  it("reveals the tool activity options and saves them with the switch", async () => {
    await openEditor();
    // The Route authors no tool activity and its account turns none on.
    const toolActivity = screen.getByLabelText("Show tool activity") as HTMLInputElement;
    expect(toolActivity.checked).toBe(false);
    expect(screen.queryByLabelText("At most one line every")).toBeNull();
    fireEvent.click(toolActivity);
    expect((screen.getByLabelText("At most one line every") as HTMLInputElement).value).toBe("30");
    fireEvent.click(screen.getByRole("radio", { name: "Tool and full command" }));
    // Nothing is throttled at 0, so what to do when throttled no longer applies.
    fireEvent.change(screen.getByLabelText("At most one line every"), { target: { value: "0" } });
    expect(screen.queryByRole("button", { name: "Update the last line" })).toBeNull();
    fireEvent.change(screen.getByLabelText("At most one line every"), { target: { value: "-1" } });
    expect(screen.getByText("Use a whole number of seconds, 0 or more.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("At most one line every"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip it" }));
    fireEvent.click(save);
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].sync.toolCalls).toEqual({
      detail: "full",
      throttleSeconds: 45,
      whenThrottled: "skip",
    });
  });

  it("keeps a Route that authors no Reply method inheriting it", async () => {
    // The account runs `tool`; the Route authors nothing and must keep inheriting.
    const inheritingAccount = { ...account, defaults: { outbound: { path: "tool" } } };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [inheritingAccount] }
        : data[resource],
    );
    await openEditor();
    // The form shows what the Route really runs, not the new-Route default.
    expect(screen.getByText("The Agent controls replies")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].outbound).toBeUndefined();
  });

  it("writes the Reply method once the owner picks one on an inheriting Route", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Text forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].outbound).toEqual({
      path: "relay",
    });
  });

  it("keeps a Route that stored Channel tool only on the tool path the owner chose", async () => {
    const toolRoute = { ...route, outbound: { path: "tool" } };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [toolRoute] }] }
        : data[resource],
    );
    await openEditor();
    expect(screen.getByText("The Agent controls replies")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].outbound).toEqual({
      path: "tool",
    });
  });

  it("keeps a Route that stored Text forward on the relay path the owner chose", async () => {
    const relayRoute = { ...route, outbound: { path: "relay" } };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? { ...configuration, accounts: [{ ...account, routes: [relayRoute] }] }
        : data[resource],
    );
    await openEditor();
    expect(screen.queryByText("The Agent controls replies")).toBeNull();
    expect(screen.getByLabelText("Send final answers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].outbound).toEqual({
      path: "relay",
    });
  });

  // `/promoteroutedefault` layers `agentControls` over the named agent. The form
  // shows the agent the Route really starts, and a save from it writes that
  // agent: the layer, kept, would override whatever the form saved.
  it("opens an Agent Route with its promoted default applied and saves it as the Route's agent", async () => {
    const promoted = {
      provider: "opencode",
      model: "opencode-go/deepseek-v4.1-flash",
      thinkingOptionId: "default",
    };
    const promotedConfiguration = {
      ...configuration,
      accounts: [
        {
          ...account,
          routes: [
            {
              audience: route.audience,
              agent: "support-agent",
              environment: "support-agent",
              agentControls: promoted,
            },
          ],
        },
      ],
      resource: {
        agents: {
          "support-agent": {
            provider: "codex",
            model: "gpt-6-astra",
            mode: "full-access",
          },
        },
        environments: {
          "support-agent": {
            kind: "daemon",
            daemon: "daemon",
            projectId: "project",
            cwd: "/saved/custom",
          },
        },
      },
    };
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return promotedConfiguration;
      if (resource === "daemons")
        return {
          daemons: [
            {
              id: "daemon",
              slug: "Workstation",
              connectionOffer: { serverId: "runtime" },
            },
          ],
        };
      return data[resource];
    });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledOnce());
    const candidate = adapters.put.mock.calls[0]![1];
    const saved = candidate.accounts[0].routes[0];
    expect(saved).not.toHaveProperty("agentControls");
    expect(candidate.resource.agents[saved.agent]).toMatchObject(promoted);
    expect(candidate.resource.agents[saved.agent]).not.toHaveProperty("mode");
  });

  it("preserves an Agent Route directory, clears it on Host change, and saves the selected Project root", async () => {
    const agentConfiguration = {
      ...configuration,
      accounts: [
        {
          ...account,
          routes: [
            {
              audience: route.audience,
              agent: "support-agent",
              environment: "support-env",
            },
          ],
        },
      ],
      resource: {
        agents: { "support-agent": { provider: "codex" } },
        environments: {
          "support-env": {
            kind: "daemon",
            daemon: "daemon",
            projectId: "project",
            cwd: "/saved/custom",
          },
        },
      },
    };
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource === "channel-configuration") return agentConfiguration;
      if (resource === "daemons")
        return {
          daemons: [
            {
              id: "daemon",
              slug: "Workstation",
              connectionOffer: { serverId: "runtime" },
            },
            {
              id: "next-daemon",
              slug: "Other Host",
              connectionOffer: { serverId: "next-runtime" },
            },
          ],
        };
      return data[resource];
    });
    await openEditor();
    expect(screen.getByLabelText("Selected working directory").textContent).toBe("/saved/custom");
    expect(screen.queryByLabelText("Working directory")).toBeNull();
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "next-daemon" },
    });
    expect(screen.getByLabelText("Selected working directory").textContent).toBe("");
    expect(screen.getByLabelText("Selected Host runtime").textContent).toBe("next-runtime");
    expect((screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose next Project" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledOnce());
    const candidate = adapters.put.mock.calls[0]![1];
    const environment = candidate.accounts[0].routes[0].environment;
    expect(candidate.resource.environments[environment]).toMatchObject({
      daemon: "next-daemon",
      projectId: "next-project",
      cwd: "/next/project-root",
    });
  });

  it("opens the seeded Route immediately and Cancel returns to the Connections page without saving", async () => {
    await openEditor();
    expect((screen.getByLabelText("Conversation IDs") as HTMLInputElement).value).toBe("C1");
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("#help");
    expect((screen.getByLabelText("Reply in a thread") as HTMLInputElement).checked).toBe(false);
    // The Connections list and its toolbar are gone; only the way back names it.
    expect(screen.queryByRole("button", { name: "Refresh status" })).toBeNull();
    expect(screen.queryByText("Add Channel behavior")).toBeNull();
    expect(screen.queryByText("Advanced YAML")).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    adapters.scrollToTop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Add Connection" });
    expect(adapters.scrollToTop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^Edit Route/ })).toBeDefined();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("activates the edited Route while preserving binding, custom approvals and sync constraints", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: "C2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]?.slice(0, 2)).toEqual([
      "channel-configuration",
      expect.objectContaining({
        expectedRevisionId: "revision",
        accounts: [
          expect.objectContaining({
            routes: [
              expect.objectContaining({
                audience: [
                  {
                    who: { roles: ["member"] },
                    where: { conversations: ["C2"] },
                    contains: "#help",
                  },
                ],
                binding: route.binding,
                approval: route.approval,
                sync: expect.objectContaining({
                  subagents: route.sync.subagents,
                }),
                workflow: "support",
              }),
            ],
          }),
        ],
      }),
    ]);
    await screen.findByRole("button", { name: "Add Connection" });
  });

  it("preserves the Route draft when creating its Automation inline", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: "C2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish inline Automation" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Automation") as HTMLSelectElement).value).toBe("new-support"),
    );
    expect((screen.getByLabelText("Conversation IDs") as HTMLInputElement).value).toBe("C2");
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("#help");
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("does not activate a delayed confirmation after returning to Channels", async () => {
    let confirm!: (value: boolean) => void;
    adapters.confirm.mockReturnValue(
      new Promise<boolean>((resolve) => {
        confirm = resolve;
      }),
    );
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Connections" }));
    await act(async () => confirm(true));
    // Only the read-only preview ran; nothing was activated.
    for (const [path] of adapters.post.mock.calls)
      expect(path).toBe("channel-configuration/validate");
    expect(adapters.put).not.toHaveBeenCalled();
  });
});

describe("Automation Channel inputs", { timeout: 20_000 }, () => {
  it("edits the canonical Route while preserving direct Agent Routes and custom policy", async () => {
    const directRoute = {
      audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
      agent: "personal",
      environment: "local",
    };
    const mixed = {
      ...configuration,
      accounts: [{ ...account, routes: [directRoute, route] }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? mixed : data[resource],
    );
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    expect(screen.queryByRole("button", { name: "Start or continue an Agent" })).toBeNull();
    expect(screen.getByText("Automation · support")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "#triage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const { audience: _audience, ...routeSettings } = route;
    expect(adapters.put.mock.calls[0]![1]).toMatchObject({
      expectedRevisionId: "revision",
      accounts: [
        {
          routes: [
            directRoute,
            {
              ...routeSettings,
              audience: [
                {
                  who: { roles: ["member"] },
                  where: { conversations: ["C1"] },
                  contains: "#triage",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[1].match).toBeUndefined();
    await screen.findByRole("button", { name: "Edit input and replies" });
  });

  it("keeps a rejected input draft visible and cancels without a second write", async () => {
    adapters.put.mockRejectedValue(new Error("Configuration changed; reload before saving."));
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "#draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await screen.findByText("Configuration changed; reload before saving.");
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("#draft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Edit input and replies" });
    expect(adapters.put).toHaveBeenCalledTimes(1);
  });

  it("refuses to apply an old draft after another surface reorders the shared configuration", async () => {
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "#draft" },
    });
    await act(async () => {
      queryClient.setQueriesData(
        {
          predicate: (query) => query.queryKey.at(-1) === "channel-configuration",
        },
        {
          ...configuration,
          revision: { ...configuration.revision, id: "new-revision" },
          accounts: [
            {
              ...account,
              routes: [
                {
                  audience: [{ who: { roles: ["member"] }, where: { dm: true } }],
                  agent: "personal",
                  environment: "local",
                },
                route,
              ],
            },
          ],
        },
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await screen.findByText(
      "Channel configuration changed while editing. Cancel and reopen this Route before saving.",
    );
    expect(adapters.put).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("#draft");
  });

  it("offers only the draft channel's Connections when an input picks another one", async () => {
    const telegram = {
      id: "telegram-connection",
      provider: "telegram",
      name: "Ops bot",
      externalName: null,
      status: "active",
      consumers: [],
    };
    const slack = { ...telegram, id: "slack-spare", provider: "slack", name: "Spare" };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "connections"
        ? {
            connections: [
              ...(data.connections as { connections: unknown[] }).connections,
              telegram,
              slack,
            ],
            providerApplications: [],
          }
        : data[resource],
    );
    const draftContext = slackInputDraftContext(vi.fn());
    render(
      <QueryClientProvider client={queryClient}>
        <AutomationInputDraftContext.Provider value={draftContext}>
          <ChannelSettings automationName="support" />
        </AutomationInputDraftContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use another Connection" }));
    const picker = (await screen.findByLabelText("Connection")) as HTMLSelectElement;
    expect(Array.from(picker.options, ({ value }) => value).filter(Boolean)).toEqual([
      "account:slack:support",
      "connection:slack-spare",
    ]);
  });

  it("stages an Automation input with the shared editor without publishing a Route", async () => {
    const stage = vi.fn();
    const draftContext = slackInputDraftContext(stage);
    render(
      <QueryClientProvider client={queryClient}>
        <AutomationInputDraftContext.Provider value={draftContext}>
          <ChannelSettings automationName="support" />
        </AutomationInputDraftContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "#draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use input" }));
    await waitFor(() => expect(stage).toHaveBeenCalledTimes(1));
    expect(stage.mock.calls[0]?.[0]).toMatchObject({
      expectedRevisionId: "revision",
      accounts: [
        {
          routes: [
            {
              workflow: "support",
              audience: [
                {
                  who: { roles: ["member"] },
                  where: { conversations: ["C1"] },
                  contains: "#draft",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("adds an input on an existing account without asking for another target", async () => {
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Add input" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add input here" }));
    expect(screen.getByText("Automation · support")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Automation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(adapters.put).not.toHaveBeenCalled();
  });
});

/** An Automation input draft that stages instead of publishing. */
function slackInputDraftContext(stage: DraftContextValue["stage"]): DraftContextValue {
  return { provider: "slack", draft: null, stage, setEditing: vi.fn(), pending: false };
}

type DraftContextValue = NonNullable<React.ContextType<typeof AutomationInputDraftContext>>;

const LUNA_FOLDER = "/home/me/.clisbot/workspaces/luna";
function lunaOption(launchDefaults: RouteBotOption["bot"]["launchDefaults"]): RouteBotOption {
  return {
    key: "server-mac/bot_luna",
    serverId: "server-mac",
    serverName: "Mac mini",
    daemonId: "daemon-mac",
    bot: {
      id: "bot_luna",
      slug: "luna",
      name: "Luna",
      description: "Support assistant",
      projectId: "project-luna",
      workspaceId: "workspace-luna",
      cwd: LUNA_FOLDER,
      kind: "personal",
      launchDefaults,
    },
  };
}
const LUNA_LAUNCH = { provider: "codex", model: "gpt-5.6-luna", modeId: "auto" };

const CONNECT_LUNA = { serverId: "server-mac", botId: "bot_luna" };
function channelsWithRequest(
  connectBot: { serverId: string; botId: string } | null,
  onOpened: () => void,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <HubSettingsDetailScrollProvider onNavigate={adapters.scrollToTop}>
        <ChannelSettings connectBot={connectBot} onConnectBotOpened={onOpened} />
      </HubSettingsDetailScrollProvider>
    </QueryClientProvider>
  );
}
function renderConnectBot(onOpened: () => void) {
  return render(channelsWithRequest(CONNECT_LUNA, onOpened));
}
const LUNA_ENVIRONMENT = {
  kind: "daemon",
  daemon: "daemon-mac",
  projectId: "project-luna",
  cwd: "/home/me/.clisbot/workspaces/luna",
};
/** The Connections page holding one Route that runs Luna. */
function serveBotRoute(botRoute: Record<string, unknown>, agent: Record<string, unknown>) {
  const stored = {
    ...configuration,
    resource: {
      agents: { "channel-support": agent },
      environments: { "channel-support": LUNA_ENVIRONMENT },
    },
    accounts: [{ ...account, routes: [botRoute] }],
  };
  adapters.get.mockImplementation(async (resource: string) =>
    resource === "channel-configuration" ? stored : data[resource],
  );
}
const LUNA_ROUTE = {
  audience: [{ who: { roles: ["owner"] }, where: { dm: true } }],
  agent: "channel-support",
  environment: "channel-support",
  workspace: { organize: false },
};

describe("Start or continue a Bot", { timeout: 20_000 }, () => {
  it("Connect to a channel… opens Add Route on the Bot and saves what the Bot runs", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    const opened = vi.fn();
    renderConnectBot(opened);
    expect(await screen.findByText("Add Route", {}, { timeout: 10_000 })).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Bot") as HTMLSelectElement).value).toBe("server-mac/bot_luna");
    // The Bot decides Host, Project and AI configuration, so the form asks none of them.
    expect(screen.queryByLabelText("Host")).toBeNull();
    expect(screen.queryByText("Fast mode and provider options")).toBeNull();
    expect(screen.getByText("Mac mini")).toBeTruthy();
    expect(screen.getByText(/Runs in Luna's folder/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Connection"), {
      target: { value: "account:slack:support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const candidate = adapters.put.mock.calls[0]![1];
    const saved = candidate.accounts[0].routes[1];
    expect(saved).toMatchObject({
      agent: "channel-support",
      environment: "channel-support",
      workspace: { organize: false },
    });
    expect(candidate.resource.environments["channel-support"]).toEqual({
      kind: "daemon",
      daemon: "daemon-mac",
      projectId: "project-luna",
      cwd: LUNA_FOLDER,
    });
    expect(candidate.resource.agents["channel-support"]).toEqual({
      provider: "codex",
      model: "gpt-5.6-luna",
      mode: "auto",
    });
    expect(adapters.confirm.mock.calls[0]![0].message).toContain("Bot · Luna");
  });

  it("asks for a Bot before saving when the requested one is not on offer", async () => {
    adapters.botOptions = [];
    renderConnectBot(vi.fn());
    expect(await screen.findByText("Add Route", {}, { timeout: 10_000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Connection"), {
      target: { value: "account:slack:support" },
    });
    expect(screen.getByText("Choose a Bot.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Activate Route" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("offers a Bot beside an Agent on Add Route and still starts on an Agent", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    renderChannels();
    await addRouteFromMenu();
    expect(screen.getByRole("button", { name: "Start or continue a Bot" })).toBeTruthy();
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.queryByLabelText("Bot")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start or continue a Bot" }));
    expect(screen.getByLabelText("Bot")).toBeTruthy();
    expect(screen.queryByLabelText("Host")).toBeNull();
  });

  it("does not offer a Bot when no Host the Hub knows runs one", async () => {
    renderChannels();
    await addRouteFromMenu();
    expect(screen.queryByRole("button", { name: "Start or continue a Bot" })).toBeNull();
  });

  it("reopens a Bot's Route on its Bot and saves the Bot's current AI configuration", async () => {
    adapters.botOptions = [lunaOption({ ...LUNA_LAUNCH, model: "gpt-5.7" })];
    const botRoute = {
      audience: [{ who: { roles: ["owner"] }, where: { dm: true } }],
      agent: "channel-support",
      environment: "channel-support",
      workspace: { organize: false },
      questions: "recommended",
    };
    const botConfiguration = {
      ...configuration,
      resource: {
        agents: { "channel-support": { provider: "codex", model: "gpt-5.6-luna", mode: "auto" } },
        environments: {
          "channel-support": {
            kind: "daemon",
            daemon: "daemon-mac",
            projectId: "project-luna",
            cwd: LUNA_FOLDER,
          },
        },
      },
      accounts: [{ ...account, routes: [botRoute] }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? botConfiguration : data[resource],
    );
    await openEditor();
    expect((screen.getByLabelText("Bot") as HTMLSelectElement).value).toBe("server-mac/bot_luna");
    expect(
      screen.getByText("Luna's AI configuration changed since this Route was saved"),
    ).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const candidate = adapters.put.mock.calls[0]![1];
    expect(candidate.accounts[0].routes[0]).toMatchObject({
      agent: "channel-support",
      environment: "channel-support",
      workspace: { organize: false },
      questions: "recommended",
    });
    expect(candidate.resource.agents["channel-support"].model).toBe("gpt-5.7");
  });

  it("keeps an Agent Route on the Bot's folder an Agent when it organizes workspaces", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    const agentRoute = {
      audience: [{ who: { roles: ["owner"] }, where: { dm: true } }],
      agent: "channel-support",
      environment: "channel-support",
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration"
        ? {
            ...configuration,
            resource: {
              agents: { "channel-support": { provider: "claude" } },
              environments: {
                "channel-support": {
                  kind: "daemon",
                  daemon: "daemon-mac",
                  projectId: "project-luna",
                  cwd: LUNA_FOLDER,
                },
              },
            },
            accounts: [{ ...account, routes: [agentRoute] }],
          }
        : data[resource],
    );
    await openEditor();
    expect(screen.queryByLabelText("Bot")).toBeNull();
    expect(screen.getByLabelText("Host")).toBeTruthy();
  });
});

describe("Start or continue a Bot, editing and repeat requests", { timeout: 20_000 }, () => {
  it("switches a stored Route to its Bot once the Bots load", async () => {
    serveBotRoute(LUNA_ROUTE, { provider: "codex", model: "gpt-5.6-luna", mode: "auto" });
    await openEditor();
    expect(screen.getByLabelText("Host")).toBeTruthy();
    loadBots([lunaOption(LUNA_LAUNCH)]);
    expect((screen.getByLabelText("Bot") as HTMLSelectElement).value).toBe("server-mac/bot_luna");
    expect(screen.queryByLabelText("Host")).toBeNull();
    expect(screen.queryByText(/AI configuration changed/)).toBeNull();
  });

  it("keeps the target the user picked before the Bots loaded", async () => {
    serveBotRoute(LUNA_ROUTE, { provider: "codex" });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Run an Automation" }));
    loadBots([lunaOption(LUNA_LAUNCH)]);
    expect(screen.getByLabelText("Automation")).toBeTruthy();
    expect(screen.queryByLabelText("Bot")).toBeNull();
  });

  it("saved as an Agent, a Bot's Route stops keeping sessions in place", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    serveBotRoute(LUNA_ROUTE, { provider: "codex", model: "gpt-5.6-luna", mode: "auto" });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Start or continue an Agent" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const candidate = adapters.put.mock.calls[0]![1];
    expect(candidate.accounts[0].routes[0]).not.toHaveProperty("workspace");
    expect(candidate.resource.environments["channel-support"]).toMatchObject(LUNA_ENVIRONMENT);
  });

  it("says when saving replaces a model chosen in a conversation", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    serveBotRoute(
      { ...LUNA_ROUTE, agentControls: { provider: "claude", model: "opus" } },
      { provider: "codex", model: "gpt-5.6-luna", mode: "auto" },
    );
    await openEditor();
    expect(screen.getByText("This Route runs a model chosen in a conversation")).toBeTruthy();
    // The named agent still matches Luna, so her settings did not change.
    expect(screen.queryByText(/AI configuration changed/)).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0]).not.toHaveProperty(
      "agentControls",
    );
  });

  it("opens the same Bot again after its first request ended", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    const opened = vi.fn();
    const ui = renderConnectBot(opened);
    await screen.findByLabelText("Bot", {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Bot")).toBeNull();
    ui.rerender(channelsWithRequest(null, opened));
    ui.rerender(channelsWithRequest(CONNECT_LUNA, opened));
    expect(await screen.findByLabelText("Bot")).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("asks before replacing a Route being edited", async () => {
    adapters.botOptions = [lunaOption(LUNA_LAUNCH)];
    const opened = vi.fn();
    const ui = render(channelsWithRequest(null, opened));
    fireEvent.click(
      await screen.findByRole("button", { name: /^Edit Route/ }, { timeout: 10_000 }),
    );
    await screen.findByText("Edit Route 1");
    adapters.confirm.mockResolvedValueOnce(false);
    ui.rerender(channelsWithRequest(CONNECT_LUNA, opened));
    await waitFor(() =>
      expect(adapters.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Discard this Route?" }),
      ),
    );
    expect(screen.getByText("Edit Route 1")).toBeTruthy();
    ui.rerender(channelsWithRequest(null, opened));
    ui.rerender(channelsWithRequest(CONNECT_LUNA, opened));
    expect(await screen.findByLabelText("Bot")).toBeTruthy();
    expect(screen.queryByText("Edit Route 1")).toBeNull();
    expect(opened).toHaveBeenCalledTimes(2);
  });
});
