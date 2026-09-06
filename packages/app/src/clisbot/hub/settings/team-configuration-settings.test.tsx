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
  inviteMember: vi.fn(async () => {}),
  api: () => ({ post: fixtures.post }),
  signIn: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
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
  post: vi.fn(async () => ({})),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: fixtures.push }) }));
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
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("./channel-settings", () => ({
  ChannelSettings: () => null,
  ChannelConnectionForm: ({
    pending,
    allowSlackSocket,
    save,
  }: {
    pending: boolean;
    allowSlackSocket: boolean;
    save(body: unknown): void;
  }) => {
    const submit = React.useCallback(
      () =>
        save({
          provider: "telegram",
          accountId: "support",
          credentials: { botToken: "secret-token" },
        }),
      [save],
    );
    return (
      <button type="button" disabled={pending} onClick={submit}>
        {allowSlackSocket ? "Slack enabled" : "Save Telegram"}
      </button>
    );
  },
}));
vi.mock("./automation-settings", () => ({ AutomationSettings: () => null }));
vi.mock("./access-settings", () => ({ AccessSettings: () => null }));
vi.mock("./api-key-settings", () => ({ ApiKeySettings: () => null }));
vi.mock("./provider-application-settings", () => ({ ProviderApplicationSettings: () => null }));
vi.mock("./channel-identity-settings", () => ({
  ChannelIdentitySettings: () => null,
  ChannelIdentitySelfLinkSettings: () => null,
}));
vi.mock("../host-onboarding-section", () => ({ HubHostOnboardingSection: () => null }));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: vi.fn() }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange(value: string): void;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <label>
        {label}
        <select value={value} onChange={change}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  },
}));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
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
vi.mock("@/screens/settings/settings-section", () => ({
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

const capabilities = { manageMembers: true, manageResources: true };
const account = { id: "owner", name: "Owner", email: "owner@example.test" };
const member = {
  id: "membership-1",
  userId: "user-1",
  name: "Alice",
  email: "alice@example.test",
  role: "member",
};
function query(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn(async () => ({})) };
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  hub.signedIn = { account, organization: { id: "organization" }, capabilities };
  hub.state = { status: "active", account, capabilities, team: { invitations: [] } };
  fixtures.queries = {
    members: query({ members: [member] }),
    teams: query({ teams: [{ id: "team-1", name: "Support", userIds: [member.userId] }] }),
    "channel-identities": query({ identities: [] }),
    "access-assignments": query({
      assignments: [
        {
          id: "grant-1",
          subjectKind: "team",
          subjectId: "team-1",
          resourceKind: "channel",
          resourceId: "channel-1",
          privileges: ["channel.read", "channel.reply"],
          constraints: {},
        },
      ],
    }),
    "access-catalog": query({
      resources: [{ kind: "channel", id: "channel-1", name: "Customer chat" }],
      accessLevels: {},
    }),
    connections: query({ connections: [], providerApplications: [] }),
    daemons: query({ daemons: [] }),
  };
});
afterEach(cleanup);

describe("Team invitation review and access navigation", () => {
  it("starts a fresh invitation draft when the signed-in account changes", () => {
    const ui = render(<HubSettingsContent section="team" />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "private-draft@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "team-1" } });
    hub.signedIn = {
      account: { ...account, id: "other-owner" },
      organization: { id: "organization" },
      capabilities,
    };
    ui.rerender(<HubSettingsContent section="team" />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Team") as HTMLSelectElement).value).toBe("");
    expect(
      (screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("shows the selected Team resources and privileges before inviting", async () => {
    render(<HubSettingsContent section="team" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "team-1" } });
    expect(screen.getByText("Customer chat")).toBeTruthy();
    expect(screen.getByText("channel read, channel reply")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(hub.inviteMember).toHaveBeenCalledWith({
        email: "new@example.test",
        role: "member",
        teamId: "team-1",
      }),
    );
  });
  it("blocks invitation until failed Team access can be reviewed and offers retry", () => {
    const access = fixtures.queries["access-assignments"]!;
    access.data = undefined;
    access.isError = true;
    access.error = new Error("Access unavailable");
    render(<HubSettingsContent section="team" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "team-1" } });
    const submit = screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(hub.inviteMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(access.refetch).toHaveBeenCalledOnce();
    expect(fixtures.queries["access-catalog"]!.refetch).toHaveBeenCalledOnce();
  });
  it.each([
    { label: "Members", kind: "member", id: "membership-1" },
    { label: "Teams", kind: "team", id: "team-1" },
  ])("preserves $kind context when managing access", ({ label, kind, id }) => {
    render(<HubSettingsContent section="team" />);
    const section = screen.getByRole("heading", { name: label }).closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage access" }));
    expect(fixtures.push).toHaveBeenCalledWith({
      pathname: "/settings/hub/[hubSection]",
      params: { hubSection: "access", subjectKind: kind, subjectId: id },
    });
  });
});

describe("Configuration Telegram account entry", () => {
  it("uses the shared Telegram form, retains failed drafts, and closes after saved", async () => {
    fixtures.post.mockRejectedValueOnce(new Error("Token invalid"));
    render(<HubSettingsContent section="configuration" />);
    fireEvent.click(screen.getByRole("button", { name: "Add Telegram account" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Telegram" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Token invalid"));
    expect(screen.getByRole("button", { name: "Save Telegram" })).toBeTruthy();
    fixtures.post.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Save Telegram" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save Telegram" })).toBeNull());
    expect(fixtures.post).toHaveBeenLastCalledWith(
      "connections",
      { provider: "telegram", accountId: "support", credentials: { botToken: "secret-token" } },
      expect.anything(),
    );
    expect(fixtures.queries.connections!.refetch).toHaveBeenCalledOnce();
    const hosts = screen.getByRole("heading", { name: "Managed Hosts" }).closest("section")!;
    fireEvent.click(within(hosts).getByRole("button", { name: "Refresh" }));
    expect(fixtures.queries.daemons!.refetch).toHaveBeenCalledOnce();
  });
});
