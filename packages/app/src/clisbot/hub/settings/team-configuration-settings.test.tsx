// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubSettingsContent } from "./screen";

const hub = vi.hoisted(() => ({
  enabled: true,
  loading: false,
  origin: "https://hub.example.test",
  signInKind: "password",
  state: { status: "signedOut", registration: "open" } as Record<string, unknown>,
  error: null,
  signedIn: null as Record<string, unknown> | null,
  inviteMember: vi.fn(async (_input: { email: string }) => {}),
  cancelInvitation: vi.fn(async () => {}),
  changeMemberRole: vi.fn(async (_input: { memberId: string; role: string }) => {}),
  removeMember: vi.fn(async (_memberId: string) => {}),
  api: () => ({ post: fixtures.post, delete: fixtures.delete }),
  signIn: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
  registrationToken: null,
  signInWithGoogle: undefined,
  signOut: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  acceptInvitation: vi.fn(async () => {}),
}));
const fixtures = vi.hoisted(() => ({
  queries: {} as Record<
    string,
    {
      data?: unknown;
      isPending: boolean;
      isError: boolean;
      error: Error | null;
      refetch: ReturnType<typeof vi.fn>;
    }
  >,
  push: vi.fn(),
  post: vi.fn(async (_path: string, _body?: unknown) => ({})),
  delete: vi.fn(async (_path: string) => {}),
  notAdded: vi.fn(),
}));
const route = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  listeners: new Set<() => void>(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: fixtures.push,
    setParams: (params: Record<string, string | undefined>) => {
      route.params = { ...route.params, ...params };
      for (const listener of route.listeners) listener();
    },
  }),
  useLocalSearchParams: () =>
    React.useSyncExternalStore(
      (listener: () => void) => {
        route.listeners.add(listener);
        return () => route.listeners.delete(listener);
      },
      () => route.params,
    ),
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: ({ queryKey }: { queryKey: string[] }) => fixtures.queries[queryKey.at(-1)!],
}));
vi.mock("./managed-host-row", () => ({ ManagedHostRow: () => null }));
vi.mock("./connection-result", () => ({ HubConnectionResultNotice: () => null }));
vi.mock("./connection-continuation", () => ({ HubConnectionContinuationNotice: () => null }));
vi.mock("../use-connection-continuation", () => ({
  useHubConnectionContinuation: () => ({ open: vi.fn(), dismiss: vi.fn(), pending: false }),
}));
vi.mock("../account-provider", () => ({ useHubAccount: () => hub }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  // v0.8.0 moved SettingsSection under components/, which pulls in withUnistyles.
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("./channel-settings", () => ({ ChannelSettings: () => null }));
vi.mock("./channel-catalog-queries", () => ({
  useChannelCatalog: () => ({ entries: [], availability: "available", message: null }),
}));
vi.mock("./channel-connection-add", () => ({
  AddChannelConnection: ({
    allowProviderApplications,
    disabled,
    create,
  }: {
    allowProviderApplications: boolean;
    disabled?: boolean;
    create(body: Record<string, unknown>): Promise<void>;
  }) => {
    const [error, setError] = React.useState<string | null>(null);
    const submit = React.useCallback(() => {
      setError(null);
      void create({
        provider: "telegram",
        accountId: "support",
        credentials: { botToken: "secret-token" },
      }).catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "The request failed."),
      );
    }, [create]);
    return (
      <div>
        {error === null ? null : <div role="alert">{error}</div>}
        <button type="button" disabled={disabled} onClick={submit}>
          {allowProviderApplications ? "Slack enabled" : "Save Telegram"}
        </button>
      </div>
    );
  },
}));
vi.mock("./automation-settings", () => ({ AutomationSettings: () => null }));
vi.mock("./access-settings", () => ({ AccessSettings: () => null }));
vi.mock("./api-key-settings", () => ({ ApiKeySettings: () => null }));
vi.mock("./provider-application-settings", () => ({ ProviderApplicationSettings: () => null }));
vi.mock("./channel-identity-self-link", () => ({
  ChannelIdentitySelfLinkSettings: () => null,
}));
vi.mock("../host-onboarding-section", () => ({ HubHostOnboardingSection: () => null }));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: vi.fn() }));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    value,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onValueChange(value: string): void;
  }) => (
    <div role="tablist">
      {options.map((option) => (
        <StubTab key={option.value} option={option} value={value} select={onValueChange} />
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/search-field", () => ({
  SearchField: ({
    placeholder,
    onChangeText,
  }: {
    placeholder: string;
    onChangeText(value: string): void;
  }) => <StubSearch placeholder={placeholder} onChangeText={onChangeText} />,
}));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: ({
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: { value: string; label: string }[];
    value: readonly string[];
    onChange(value: string[]): void;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {options.map((option) => (
        <StubCheckbox
          key={option.value}
          label={label}
          option={option}
          value={value}
          onChange={onChange}
        />
      ))}
    </fieldset>
  ),
}));

function StubTab({
  option,
  value,
  select,
}: {
  option: { value: string; label: string };
  value: string;
  select(value: string): void;
}) {
  const click = React.useCallback(() => select(option.value), [option.value, select]);
  return (
    <button type="button" role="tab" aria-selected={option.value === value} onClick={click}>
      {option.label}
    </button>
  );
}

function StubSearch({
  placeholder,
  onChangeText,
}: {
  placeholder: string;
  onChangeText(value: string): void;
}) {
  const change = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
    [onChangeText],
  );
  return <input aria-label={placeholder} onChange={change} />;
}

function StubCheckbox({
  label,
  option,
  value,
  onChange,
}: {
  label: string;
  option: { value: string; label: string };
  value: readonly string[];
  onChange(value: string[]): void;
}) {
  const checked = value.includes(option.value);
  const toggle = React.useCallback(
    () => onChange(checked ? value.filter((id) => id !== option.value) : [...value, option.value]),
    [checked, onChange, option.value, value],
  );
  return (
    <label>
      <input
        type="checkbox"
        aria-label={`${label}: ${option.label}`}
        checked={checked}
        onChange={toggle}
      />
      {option.label}
    </label>
  );
}

vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    options,
    onChange,
    disabled,
    hint,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange(value: string): void;
    disabled?: boolean;
    hint?: string;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <div>
        <label>
          {label}
          <select value={value} disabled={disabled} onChange={change}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {hint === undefined ? null : <p>{hint}</p>}
      </div>
    );
  },
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <span>{accessibilityLabel}</span>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect(): void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    header,
    visible,
    children,
    footer,
  }: {
    header: { title: string };
    visible: boolean;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    visible ? (
      <div role="dialog" aria-label={header.title}>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/components/rename-modal", () => ({
  AdaptiveRenameModal: ({
    title,
    submitLabel,
    onSubmit,
    onClose,
  }: {
    title: string;
    submitLabel: string;
    onSubmit(value: string): Promise<void>;
    onClose(): void;
  }) => (
    <StubRenameModal
      title={title}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  ),
}));

function StubRenameModal({
  title,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  onSubmit(value: string): Promise<void>;
  onClose(): void;
}) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const change = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    [],
  );
  const submit = React.useCallback(() => {
    void onSubmit(value)
      .then(onClose)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "failed"));
  }, [onClose, onSubmit, value]);
  return (
    <div role="dialog" aria-label={title}>
      <input aria-label="Team name" value={value} onChange={change} />
      {error === null ? null : <div role="alert">{error}</div>}
      <button type="button" onClick={submit}>
        {submitLabel}
      </button>
    </div>
  );
}
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ label, error, children }: { label: string; error?: string; children: ReactNode }) => (
    <div>
      <label>
        {label}
        {children}
      </label>
      {error === undefined ? null : <p>{error}</p>}
    </div>
  ),
  FormTextInput: ({
    initialValue,
    onChangeText,
    editable,
    secureTextEntry,
  }: {
    initialValue: string;
    onChangeText(value: string): void;
    editable?: boolean;
    secureTextEntry?: boolean;
  }) => {
    const onChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return (
      <input
        defaultValue={initialValue}
        disabled={editable === false}
        type={secureTextEntry ? "password" : "text"}
        onChange={onChange}
      />
    );
  },
}));
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({
    title,
    children,
    trailing,
  }: {
    title: string;
    children: ReactNode;
    trailing?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {trailing}
      {children}
    </section>
  ),
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: ReactNode;
  }) => (
    <div role="alert">
      {title}
      {description}
      {children}
    </div>
  ),
}));
vi.mock("./back-link", () => ({
  BackLink: ({ to, onPress }: { to: string; onPress(): void }) => (
    <button type="button" onClick={onPress}>
      {`Back to ${to}`}
    </button>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    disabled,
  }: {
    onPress(): void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

const capabilities = { manageMembers: true, manageOwners: true, manageResources: true };
const account = { id: "owner", name: "Owner", email: "owner@example.test" };
const member = {
  id: "membership-1",
  userId: "user-1",
  name: "Alice",
  email: "alice@example.test",
  role: "member",
};
const bao = {
  id: "membership-2",
  userId: "user-2",
  name: "Nguyễn Bảo",
  email: "bao@example.test",
  role: "admin",
};
const teamGrant = {
  id: "grant-1",
  subjectKind: "team",
  subjectId: "team-1",
  resourceKind: "channel_account",
  resourceId: "channel-1",
  privileges: ["channel.read", "channel.reply"],
  constraints: {},
};
function query(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn(async () => ({})) };
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  route.params = {};
  hub.signedIn = { account, organization: { id: "organization" }, capabilities };
  hub.state = { status: "active", account, capabilities, team: { invitations: [] } };
  fixtures.queries = {
    members: query({ members: [member] }),
    teams: query({
      teams: [
        { id: "team-1", name: "Support", userIds: [member.userId] },
        { id: "team-2", name: "Sales", userIds: [] },
      ],
    }),
    "channel-identities": query({ identities: [] }),
    "access-assignments?include=team": query({ assignments: [teamGrant] }),
    // The viewer's own grants: which Teams they are Team Admin of.
    "access-assignments/effective?include=team": query({ owner: false, grants: [] }),
    "access-catalog?include=team": query({
      resources: [{ kind: "channel_account", id: "channel-1", name: "Customer chat" }],
      accessLevels: {},
    }),
    connections: query({ connections: [], providerApplications: [] }),
    daemons: query({ daemons: [] }),
  };
});
afterEach(cleanup);

function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

function chooseTeam(name: string) {
  fireEvent.click(screen.getByLabelText(`Teams: ${name}`));
}

function openInvite() {
  fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
  return screen.getByRole("dialog", { name: "Invite people" });
}

function typePeople(text: string) {
  fireEvent.change(screen.getByLabelText("People"), { target: { value: text } });
}

function openMember(name: string) {
  const row = screen.getByText(name).parentElement!.parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: "View" }));
}

function openTeam(name: string) {
  route.params = { view: "teams" };
  render(<HubSettingsContent section="team" />);
  const row = screen.getByText(name).parentElement!.parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: "View" }));
}

describe("People tabs", () => {
  it("opens on Members with filter chips and a search across name, email, and Team", () => {
    fixtures.queries.members = query({ members: [member, bao] });
    render(<HubSettingsContent section="team" />);
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Admins (1)" })).toBeTruthy();
    expect(screen.getAllByText("No chat bots yet")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search name, email, or Team"), {
      target: { value: "nguyen" },
    });
    expect(screen.getByText("1 of 2 Members")).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search name, email, or Team"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "No Team (1)" }));
    expect(screen.getByText("Nguyễn Bảo")).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
  });
  it("keeps the chosen tab in the route and offers Invitations only to Member managers", () => {
    render(<HubSettingsContent section="team" />);
    openTab("Teams");
    expect(route.params).toEqual({ view: "teams" });
    expect(screen.getByRole("button", { name: "New Team" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Invitations" })).toBeTruthy();
  });
  it("shows where each Member is recognized when they chat", () => {
    fixtures.queries.connections = query({
      connections: [
        {
          id: "c1",
          provider: "slack",
          providerApplicationId: null,
          name: "slack-c1",
          externalName: "VeXeRe",
          status: "active",
          identityRealm: "slack:T1",
          identityRealmScope: "tenant",
          consumers: [{ resourceKind: "channel_account", resourceId: "slack/dai", name: "dai" }],
        },
      ],
      providerApplications: [],
    });
    fixtures.queries.members = query({ members: [member, bao] });
    fixtures.queries["channel-identities"] = query({
      identities: [
        {
          id: "i1",
          memberId: member.id,
          identityRealm: "slack:T1",
          connectionId: "c1",
          externalSubjectId: "U1",
          displayName: null,
        },
      ],
    });
    render(<HubSettingsContent section="team" />);
    expect(screen.getByText("✓ Slack · VeXeRe")).toBeTruthy();
    expect(screen.getByText("Slack · VeXeRe · not linked")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "No chat account (1)" }));
    expect(screen.getByText("Nguyễn Bảo")).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
  });
});

describe("Invite people", () => {
  it("starts a fresh draft each time the modal opens", () => {
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("private-draft@example.test");
    chooseTeam("Support");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openInvite();
    expect((screen.getByLabelText("People") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Teams: Support") as HTMLInputElement).checked).toBe(false);
  });
  it("sends one invitation that joins every chosen Team, after previewing their access", async () => {
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("new@example.test");
    chooseTeam("Support");
    chooseTeam("Sales");
    expect(screen.getByText("1 invitation will be sent")).toBeTruthy();
    expect(screen.getByText(/1 Connection/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(hub.inviteMember).toHaveBeenCalledWith({
        email: "new@example.test",
        role: "member",
        teamIds: ["team-1", "team-2"],
      }),
    );
    await waitFor(() => expect(screen.getByText("Sent 1 invitation.")).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("recognizes Members by name or email, adds them now, and invites only new emails", async () => {
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("Alice, new@example.test");
    chooseTeam("Support");
    chooseTeam("Sales");
    expect(
      screen.getByText("1 Member joins Support, Sales now · 1 invitation will be sent"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 and invite 1" }));
    await waitFor(() => expect(hub.inviteMember).toHaveBeenCalledOnce());
    // Alice is already in Support, so only Sales is added.
    expect(fixtures.post).toHaveBeenCalledTimes(1);
    expect(fixtures.post).toHaveBeenCalledWith(
      "teams/team-2/members",
      { userId: "user-1" },
      expect.anything(),
    );
  });
  it("keeps refused addresses in the field for retry", async () => {
    hub.inviteMember.mockImplementation(async (input: { email: string }) => {
      if (input.email === "taken@example.test") {
        throw new Error("Hub account request failed (409).");
      }
    });
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("One@example.test, taken@example.test one@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invitations" }));
    await waitFor(() =>
      expect(
        screen.getByText("1 of 2 done. taken@example.test: already a Member, or no free seat"),
      ).toBeTruthy(),
    );
    expect(hub.inviteMember).toHaveBeenCalledWith({ email: "one@example.test", role: "member" });
    expect(screen.getByRole("dialog", { name: "Invite people" })).toBeTruthy();
    hub.inviteMember.mockImplementation(async () => {});
  });
  it("names an entry that is neither a Member nor an email", () => {
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("Nobody, bad@");
    expect(screen.getByText("Not an email: bad@ · Not a Member: Nobody")).toBeTruthy();
  });
  it("blocks until failed Team access can be reviewed and offers retry", () => {
    const access = fixtures.queries["access-assignments?include=team"]!;
    access.data = undefined;
    access.isError = true;
    access.error = new Error("Access unavailable");
    render(<HubSettingsContent section="team" />);
    openInvite();
    typePeople("new@example.test");
    chooseTeam("Support");
    const submit = screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(hub.inviteMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(access.refetch).toHaveBeenCalledOnce();
  });
  it("opens with the Team chosen from its detail, and with the Member from a No Team row", () => {
    fixtures.queries.members = query({ members: [member, bao] });
    const ui = render(<HubSettingsContent section="team" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to a Team" }));
    expect((screen.getByLabelText("People") as HTMLInputElement).value).toBe("bao@example.test");
    ui.unmount();
    openTeam("Sales");
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    expect((screen.getByLabelText("Teams: Sales") as HTMLInputElement).checked).toBe(true);
  });
});

describe("Member roles", () => {
  it("asks before making someone an Owner, then changes the role", async () => {
    const { confirmDialog } = await import("@/utils/confirm-dialog");
    vi.mocked(confirmDialog).mockResolvedValue(true);
    render(<HubSettingsContent section="team" />);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "owner" } });
    await waitFor(() =>
      expect(hub.changeMemberRole).toHaveBeenCalledWith({
        memberId: "membership-1",
        role: "owner",
      }),
    );
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Make Alice an Owner?", confirmLabel: "Make Owner" }),
    );
  });
  it("changes to Admin without asking, and shows the Hub's refusal", async () => {
    const { confirmDialog } = await import("@/utils/confirm-dialog");
    hub.changeMemberRole.mockRejectedValueOnce(new Error("Hub account request failed (403)."));
    render(<HubSettingsContent section="team" />);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    await waitFor(() => expect(hub.changeMemberRole).toHaveBeenCalledOnce());
    expect(confirmDialog).not.toHaveBeenCalled();
    openMember("Alice");
    await waitFor(() =>
      expect(screen.getByText("Only an Owner changes an Owner's role.")).toBeTruthy(),
    );
  });
  it("locks an Owner's role for an Admin, and the last Owner for everyone", () => {
    const owner = { ...bao, role: "owner" };
    fixtures.queries.members = query({ members: [member, owner] });
    hub.signedIn = {
      account,
      organization: { id: "organization" },
      capabilities: { ...capabilities, manageOwners: false },
    };
    const ui = render(<HubSettingsContent section="team" />);
    const [aliceRole, ownerRole] = screen.getAllByLabelText("Role") as HTMLSelectElement[];
    expect(aliceRole!.disabled).toBe(false);
    expect(within(aliceRole!).queryByRole("option", { name: "Owner" })).toBeNull();
    expect(ownerRole!.disabled).toBe(true);
    expect(screen.getByText("Only an Owner changes an Owner's role.")).toBeTruthy();
    ui.unmount();
    hub.signedIn = { account, organization: { id: "organization" }, capabilities };
    render(<HubSettingsContent section="team" />);
    expect(screen.getByText("The last Owner cannot step down.")).toBeTruthy();
  });
});

describe("Member detail", () => {
  it("stays on the Member when removing fails, and shows why", async () => {
    const { confirmDialog } = await import("@/utils/confirm-dialog");
    vi.mocked(confirmDialog).mockResolvedValue(true);
    hub.removeMember.mockRejectedValueOnce(new Error("Owner cannot be removed."));
    render(<HubSettingsContent section="team" />);
    openMember("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Remove Member" }));
    await waitFor(() => expect(screen.getByText("Owner cannot be removed.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Back to People" })).toBeTruthy();
  });
  it("groups access by resource kind with its source, and keeps raw privileges behind Details", () => {
    fixtures.queries["access-assignments?include=team"] = query({
      assignments: [
        teamGrant,
        {
          id: "grant-2",
          subjectKind: "member",
          subjectId: member.id,
          resourceKind: "daemon",
          resourceId: "host-1",
          privileges: ["daemon.connect", "project.use"],
          constraints: {},
          createdByUserId: member.userId,
        },
      ],
    });
    fixtures.queries["access-catalog?include=team"] = query({
      resources: [
        { kind: "channel_account", id: "channel-1", name: "Customer chat" },
        { kind: "daemon", id: "host-1", name: "sandbox" },
      ],
      accessLevels: { daemon: { office_worker: ["daemon.connect", "project.use"] } },
    });
    render(<HubSettingsContent section="team" />);
    openMember("Alice");
    const access = screen.getByRole("heading", { name: "Access" }).closest("section")!;
    expect(within(access).getByText("Hosts").nextSibling?.textContent).toContain("sandbox");
    expect(within(access).getByText("Office worker · Direct · by Alice")).toBeTruthy();
    expect(
      within(access).getByText("Every Project on this Host, including Projects added later"),
    ).toBeTruthy();
    expect(within(access).getByText("2 privileges · Via Support · by Hub")).toBeTruthy();
    expect(within(access).queryByText("channel read, channel reply")).toBeNull();
    const chatRow = within(access).getByText("Customer chat").parentElement!.parentElement!;
    fireEvent.click(within(chatRow).getByRole("button", { name: "Details" }));
    expect(within(access).getByText("channel read, channel reply")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chat accounts" })).toBeTruthy();
  });
});

describe("Teams", () => {
  it("creates a Team from the New Team dialog", async () => {
    route.params = { view: "teams" };
    render(<HubSettingsContent section="team" />);
    fireEvent.click(screen.getByRole("button", { name: "New Team" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Team" }));
    await waitFor(() =>
      expect(fixtures.post).toHaveBeenCalledWith("teams", { name: "Ops" }, expect.anything()),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Team" })).toBeNull());
  });
  it("lists each Team with its people and a one-line access summary", () => {
    route.params = { view: "teams" };
    render(<HubSettingsContent section="team" />);
    expect(screen.getByText("1 Connection")).toBeTruthy();
    expect(screen.getByText("No access")).toBeTruthy();
  });
  it("shows a Member who manages no one only the Access tab, for their own access", () => {
    hub.signedIn = {
      account,
      organization: { id: "organization" },
      capabilities: { manageMembers: false, manageOwners: false, manageResources: false },
    };
    route.params = { view: "teams" };
    render(<HubSettingsContent section="team" />);
    expect(screen.getByRole("tab", { name: "Access" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Teams" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Invitations" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite people" })).toBeNull();
    expect(screen.queryByLabelText("Role")).toBeNull();
  });
});

describe("Invitations", () => {
  const invitation = {
    id: "invitation-1",
    email: "pending@example.test",
    role: "admin",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    link: "https://hub.example.test/?invitation=invitation-1",
    teams: [{ id: "team-1", name: "Support" }],
  };
  it("resends a pending invitation with its Teams and filters by expiry", async () => {
    hub.signedIn = {
      account,
      organization: { id: "organization" },
      capabilities,
      team: { invitations: [invitation] },
    };
    route.params = { view: "invitations" };
    render(<HubSettingsContent section="team" />);
    expect(screen.getByText("Admin · Support")).toBeTruthy();
    expect(screen.getByText(/Expiring soon · 59 min/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Expiring soon (1)" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Expired/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() =>
      expect(hub.inviteMember).toHaveBeenCalledWith({
        email: "pending@example.test",
        role: "admin",
        teamId: "team-1",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel invitation" }));
    await waitFor(() => expect(hub.cancelInvitation).toHaveBeenCalledWith("invitation-1"));
  });
});

describe("Team access navigation", () => {
  it("preserves the Member context when managing access", () => {
    render(<HubSettingsContent section="team" />);
    openMember("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Manage access" }));
    // Access is People's own tab: it opens there with this Member chosen.
    expect(route.params).toMatchObject({
      view: "access",
      subjectKind: "member",
      subjectId: "membership-1",
    });
  });
  it("preserves the Team context when managing access", () => {
    openTeam("Support");
    openTab("Access");
    fireEvent.click(screen.getByRole("button", { name: "Manage access" }));
    expect(route.params).toMatchObject({
      view: "access",
      subjectKind: "team",
      subjectId: "team-1",
    });
  });
});

describe("Team detail Members", () => {
  it("adds people to the Team through Invite people and keeps refusals for retry", async () => {
    fixtures.post.mockImplementation(async (path: string) => {
      if (path === "teams/team-2/members") throw new Error("Member unavailable.");
      return {};
    });
    openTeam("Sales");
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    typePeople("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Add to Teams" }));
    // The modal and the Team behind it share one mutation error.
    await waitFor(() =>
      expect(
        screen.getAllByText("0 of 1 done. alice@example.test: Member unavailable.").length,
      ).toBeGreaterThan(0),
    );
    expect(fixtures.post).toHaveBeenCalledWith(
      "teams/team-2/members",
      { userId: "user-1" },
      expect.anything(),
    );
    fixtures.post.mockImplementation(async () => ({}));
  });
  it("removes a Member from the Team, not from the organization", async () => {
    openTeam("Support");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(fixtures.delete).toHaveBeenCalledWith("teams/team-1/members/user-1"),
    );
    expect(hub.removeMember).not.toHaveBeenCalled();
  });
  it("appoints a Team Admin as an access assignment on the Team", async () => {
    openTeam("Support");
    fireEvent.change(screen.getByLabelText("Team role"), { target: { value: "admin" } });
    await waitFor(() =>
      expect(fixtures.post).toHaveBeenCalledWith(
        "access-assignments",
        {
          subjectKind: "member",
          subjectId: "membership-1",
          resourceKind: "team",
          resourceId: "team-1",
          privileges: ["hub.access.manage"],
          constraints: {},
        },
        expect.anything(),
      ),
    );
  });
  it("disables Team Admin when the Hub does not know the Team resource yet", async () => {
    const { HubApiError } = await import("../api-client");
    fixtures.post.mockRejectedValueOnce(new HubApiError(404, "not_found", "Not found (404)."));
    openTeam("Support");
    fireEvent.change(screen.getByLabelText("Team role"), { target: { value: "admin" } });
    await waitFor(() => expect(screen.getByText("Team Admin needs a newer Hub.")).toBeTruthy());
    expect((screen.getByLabelText("Team role") as HTMLSelectElement).disabled).toBe(true);
  });
  it("renames and deletes the Team from its Settings tab", async () => {
    const { confirmDialog } = await import("@/utils/confirm-dialog");
    vi.mocked(confirmDialog).mockResolvedValue(true);
    openTeam("Support");
    openTab("Settings");
    fireEvent.click(screen.getByRole("button", { name: "Delete Team" }));
    await waitFor(() => expect(fixtures.delete).toHaveBeenCalledWith("teams/team-1"));
  });
});

describe("Integrations and Hosts", () => {
  it("lists connected apps, not the Channel bots Routes use, and locks Disconnect while in use", () => {
    fixtures.queries.connections = query({
      connections: [
        {
          id: "bot",
          provider: "slack",
          providerApplicationId: null,
          name: "support-bot",
          externalName: "VeXeRe",
          status: "connected",
          consumers: [
            { resourceKind: "channel_account", resourceId: "slack/support", name: "support" },
          ],
        },
        {
          id: "gh",
          provider: "github",
          providerApplicationId: "app",
          name: "acme",
          externalName: "acme-org",
          status: "connected",
          consumers: [{ resourceKind: "automation", resourceId: "triage", name: "triage" }],
        },
      ],
      providerApplications: [],
    });
    render(<HubSettingsContent section="integrations" />);
    expect(screen.getByText("Github · acme")).toBeTruthy();
    expect(screen.getByText("Used by triage")).toBeTruthy();
    // The Channel bot a Route uses is a Connection under Channels, not an integration.
    expect(screen.queryByText("Slack · support-bot")).toBeNull();
  });

  it("lists enrolled Hosts on their own page", () => {
    render(<HubSettingsContent section="hosts" />);
    expect(screen.getByText("No Host is enrolled in this organization yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(fixtures.queries.daemons!.refetch).toHaveBeenCalledOnce();
  });
});
