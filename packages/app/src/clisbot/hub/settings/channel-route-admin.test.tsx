// @vitest-environment jsdom
// The Channels screen for a Member who administers one Connection through a
// `channel.manage` grant and lacks the organization capability
// (docs/features/access/scoped-admins.md): their accounts only, read and saved
// through the per-account endpoints, the Connection and target left alone.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelSettings } from "./channel-settings";
import { HubSettingsDetailScrollProvider } from "./detail-scroll";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    loading: false,
    signedIn: {
      account: { id: "user-qc" },
      organization: { id: "org" },
      membership: { id: "member-qc", role: "member" },
      capabilities: { manageResources: false },
      team: {
        members: [
          {
            id: "member-qc",
            userId: "user-qc",
            name: "QC Lead",
            email: "qc@example.test",
            role: "member",
          },
          {
            id: "member-owner",
            userId: "user-owner",
            name: "Owner",
            email: "o@example.test",
            role: "owner",
          },
        ],
      },
    },
    api: () => ({ get: adapters.get, post: adapters.post, put: adapters.put }),
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: adapters.push }) }));
vi.mock("@/components/confirmation-provider", () => ({
  ConfirmationProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirmation: () => adapters.confirm,
}));
vi.mock("./channel-actions-menu", () => ({
  // Opens on its trigger, so a test reads what each menu offers this viewer.
  ChannelActionsMenu: function MenuAdapter({
    label,
    actions = [],
    remove,
  }: {
    label: string;
    actions?: { label: string; onSelect(): void }[];
    remove?: () => void;
  }) {
    const [open, setOpen] = React.useState(false);
    const toggle = React.useCallback(() => setOpen((value) => !value), []);
    const items = [
      ...actions,
      ...(remove === undefined ? [] : [{ label: "Remove", onSelect: remove }]),
    ];
    return (
      <div>
        <button type="button" aria-label={label} onClick={toggle}>
          …
        </button>
        {open
          ? items.map((item) => (
              <button key={item.label} type="button" onClick={item.onSelect}>
                {item.label}
              </button>
            ))
          : null}
      </div>
    );
  },
}));
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
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onChangeText(event.target.value),
      [props],
    );
    return <input defaultValue={props.initialValue} onChange={change} />;
  },
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: (props: { label: string; options?: { id: string; value: string }[] }) => (
    <select aria-label={props.label}>
      {(props.options ?? []).map((option) => (
        <option key={option.id} value={option.value} />
      ))}
    </select>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: function TestSwitch(props: {
    value: boolean;
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
        onChange={change}
      />
    );
  },
}));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: function TestMultiSelectField(props: {
    label: string;
    disabled?: boolean;
    options: { id: string; value: string; label: string }[];
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
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("./conversation-picker-field", () => ({
  SenderSelectionFields: () => null,
  useObservedSenders: () => ({ data: undefined, isLoading: false }),
  ConversationSelectionFields: function TestConversations(props: {
    value: string;
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value),
      [props],
    );
    return <input aria-label="Conversation IDs" value={props.value} onChange={change} />;
  },
}));
vi.mock("./daemon-project-field", () => ({ DaemonProjectField: () => null }));
vi.mock("./managed-agent-configuration-fields", () => ({
  ManagedAgentConfigurationFields: () => null,
  ManagedAgentFastModeSwitch: () => null,
}));
vi.mock("./managed-workspace-fields", () => ({
  WORK_LOCATION_OPTIONS: [],
  WorktreeTargetFields: () => null,
}));
vi.mock("./automation-settings", () => ({ SingleAgentAutomationForm: () => null }));
vi.mock("./channel-pairing-panel", () => ({ ChannelPairingPanel: () => null }));

const route = {
  audience: [{ who: { teams: ["team-qc"] }, where: { conversations: ["C1"] } }],
  agent: "worker",
  environment: "repo",
};
const account = {
  channel: "slack",
  accountId: "support",
  enabled: true,
  connectionId: "connection",
  transport: { mode: "socket" },
  routes: [route],
};
const data: Record<string, unknown> = {
  "access-assignments/effective?include=team": {
    owner: false,
    grants: [
      {
        assignmentId: "a1",
        resource: {
          kind: "channel_account",
          id: "slack/support",
          name: "Slack · support",
          parent: null,
          available: true,
        },
        privileges: ["channel.manage"],
        constraints: {},
        source: { kind: "team", teamId: "team-qc", teamName: "QC" },
      },
    ],
  },
  "channel-configuration/accounts/slack/support": {
    revision: { id: "revision", version: 3 },
    account,
    effective: {},
    warnings: [],
  },
  "channel-accounts/slack/support/status": {
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
  teams: {
    teams: [{ id: "team-qc", name: "QC", userIds: ["user-qc"], createdAt: "", updatedAt: null }],
  },
  "access-assignments": {
    assignments: [
      {
        id: "a1",
        organizationId: "org",
        subjectKind: "team",
        subjectId: "team-qc",
        resourceKind: "channel_account",
        resourceId: "slack/support",
        privileges: ["channel.manage"],
        constraints: {},
        createdByUserId: "user-owner",
        createdAt: "",
        updatedAt: "",
      },
    ],
  },
  "channel-accounts/slack/support/conversations": { conversations: [], destinations: [] },
};

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  adapters.get.mockReset().mockImplementation(async (resource: string) => {
    if (!(resource in data)) throw new Error(`forbidden: ${resource}`);
    return data[resource];
  });
  adapters.put.mockReset().mockResolvedValue(data["channel-configuration/accounts/slack/support"]);
  adapters.post.mockReset();
  adapters.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

function renderChannels() {
  return render(
    <QueryClientProvider client={queryClient}>
      <HubSettingsDetailScrollProvider onNavigate={vi.fn()}>
        <ChannelSettings />
      </HubSettingsDetailScrollProvider>
    </QueryClientProvider>,
  );
}

describe("Connection Admin", { timeout: 20_000 }, () => {
  it("lists only the administered account through its own endpoints, without token or Connection controls", async () => {
    renderChannels();
    expect(await screen.findByText("Slack · support")).toBeTruthy();
    expect(screen.getByText(/Managed by Organization Admins/)).toBeTruthy();
    // They add Routes to their own Connection, but never connect a new one.
    expect(screen.queryByRole("button", { name: "Add Connection" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Route" }));
    expect(screen.queryByRole("button", { name: "Connect a new one" })).toBeNull();
    expect(screen.queryByLabelText("Connection")).toBeNull();
    expect(screen.getByText("Slack · support")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The page menu has nothing organization-wide; the Connection's has no Remove.
    fireEvent.click(await screen.findByRole("button", { name: "More Connection actions" }));
    expect(screen.queryByText("Advanced YAML")).toBeNull();
    expect(screen.queryByText("Revision history")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More Connection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for support" }));
    expect(screen.getByRole("button", { name: "Send test message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Admins" })).toBeNull();
    const read = adapters.get.mock.calls.map(([resource]) => resource as string);
    expect(read).toContain("channel-configuration/accounts/slack/support");
    expect(read).toContain("channel-accounts/slack/support/status");
    expect(read).not.toContain("channel-configuration");
    expect(read).not.toContain("connections");
    expect(read).not.toContain("channel-accounts/status");
  });

  it("edits a Route's audience and saves the one account file, keeping its Connection and target", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit Route/ }));
    await screen.findByText("Edit Route 1");
    // The target is shown, not edited.
    expect(screen.getByText("Agent · worker")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start or continue an Agent" })).toBeNull();
    // The lone Rule is open: group chats, the Team picked by name.
    expect(
      screen.getByRole("radio", { name: "Only people I pick" }).getAttribute("aria-checked"),
    ).toBe("true");
    // A second way in: DMs, from Owners, answered without a mention.
    fireEvent.click(screen.getByRole("button", { name: "Add another rule" }));
    const added = screen.getByLabelText("Rule 2");
    expect(
      within(added).getByRole("radio", { name: "Only owners" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect((within(added).getByLabelText("Require a mention") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    const [resource, body] = adapters.put.mock.calls[0]!;
    expect(resource).toBe("channel-configuration/accounts/slack/support");
    expect(body).toMatchObject({
      expectedRevisionId: "revision",
      account: {
        connectionId: "connection",
        transport: { mode: "socket" },
        routes: [
          {
            audience: [
              // The untouched Rule is written back as it was stored.
              { who: { teams: ["team-qc"] }, where: { conversations: ["C1"] } },
              {
                who: { roles: ["owner"] },
                where: { dm: true },
                interaction: { requireMention: false },
              },
            ],
            agent: "worker",
            environment: "repo",
          },
        ],
      },
    });
  });
});
