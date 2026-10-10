// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  signIn: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
  registrationToken: null,
  signInWithGoogle: undefined,
  signOut: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  acceptInvitation: vi.fn(async () => {}),
  completeAppSetup: vi.fn(async () => {}),
}));
const navigation = vi.hoisted(() => ({
  params: {} as { channelConnectionId?: string },
  setParams: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: navigation.setParams, push: navigation.push }),
  useLocalSearchParams: () => navigation.params,
}));
vi.mock("../account-provider", () => ({ useHubAccount: () => hub }));
const inventory = vi.hoisted(() => ({
  status: "ready" as "ready" | "loading" | "error",
  hosts: [] as { serverId: string }[],
  daemons: { data: { daemons: [] as { id: string }[] } },
  error: null as string | null,
  retry: vi.fn(),
}));
vi.mock("../host-inventory", () => ({ useHostInventory: () => inventory }));
vi.mock("@/components/add-host-modal", () => ({
  AddHostModal: ({
    visible,
    onClose,
    onSaved,
  }: {
    visible: boolean;
    onClose(): void;
    onSaved(input: { serverId: string }): void;
  }) => {
    const save = React.useCallback(() => onSaved({ serverId: "direct-host" }), [onSaved]);
    return visible ? (
      <section aria-label="Direct connection form">
        <button type="button" onClick={onClose}>
          Cancel direct connection
        </button>
        <button type="button" onClick={save}>
          Save direct connection
        </button>
      </section>
    ) : null;
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  // v0.8.0 moved SettingsSection under components/, which pulls in withUnistyles.
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));
vi.mock("./channel-settings", () => ({ ChannelSettings: () => null }));
vi.mock("./automation-settings", () => ({ AutomationSettings: () => null }));
vi.mock("./access-settings", () => ({ AccessSettings: () => null }));
vi.mock("./api-key-settings", () => ({ ApiKeySettings: () => null }));
vi.mock("./provider-application-settings", () => ({
  ProviderApplicationSettings: () => (
    <section aria-label="Provider applications">Slack Connected · 1 Connection</section>
  ),
}));
vi.mock("./channel-identity-self-link", () => ({
  ChannelIdentitySelfLinkSettings: () => (
    <div data-testid="identity-settings">{navigation.params.channelConnectionId}</div>
  ),
}));
vi.mock("./hosts-settings", () => ({ HostsSettings: () => null }));
// This fixture verifies the existing Account flow. Hub runtime onboarding and
// encrypted device sessions are exercised by their own fixtures and live E2E.
vi.mock("@/device-access/hub-settings", () => ({
  HubConnectionSettings: () => null,
  HubOverviewSettings: () => null,
  HubLoginPolicySettings: () => (
    <div data-testid="hub-login-policy">Hub account sign-in settings</div>
  ),
}));
vi.mock("@/device-access/account-sessions", () => ({
  AccountSessions: () => <div data-testid="account-sessions">{hub.origin}</div>,
}));
vi.mock("@/device-access/hub-help", () => ({ WhatIsHub: () => null }));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    onValueChange(value: string): void;
  }) => (
    <div>
      {options.map(({ value, label }) => (
        <TestSegmentedOption
          key={value}
          value={value}
          label={label}
          onValueChange={onValueChange}
        />
      ))}
    </div>
  ),
}));
function TestSegmentedOption({
  value,
  label,
  onValueChange,
}: {
  value: string;
  label: string;
  onValueChange(value: string): void;
}) {
  const select = React.useCallback(() => onValueChange(value), [onValueChange, value]);
  return (
    <button type="button" onClick={select}>
      {label}
    </button>
  );
}

// People pulls the menu engine and the modal sheet, which this jsdom suite does not stub.
vi.mock("./team/team-settings", () => ({
  TeamSettings: () => <div data-testid="team-settings" />,
}));
// Account's own chat-account list has its browser test; here only its entry to the flow matters.
vi.mock("./channel-identities-section", () => ({
  ChannelIdentitiesSection: ({ onManage }: { onManage(): void }) => (
    <button type="button" onClick={onManage}>
      Manage chat accounts
    </button>
  ),
}));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: vi.fn() }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/components/ui/select-field", () => ({ SelectField: () => null }));
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
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
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

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  navigation.params = {};
  navigation.setParams.mockImplementation((params: { channelConnectionId?: string }) => {
    navigation.params = { ...navigation.params, ...params };
  });
  hub.state = { status: "signedOut", registration: "open" };
  hub.origin = "https://hub.example.test";
  hub.signedIn = null;
  inventory.status = "ready";
  inventory.hosts = [];
  inventory.daemons.data = { daemons: [] };
  inventory.error = null;
});
afterEach(cleanup);
function enter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function view() {
  return <HubSettingsContent section="account" />;
}

const account = { id: "member", name: "Member", email: "member@example.test" };

describe("Account Sessions independent of organization authority", () => {
  it.each(["organizationRequired", "passwordChangeRequired"])(
    "shows own sessions for %s without Hub administration or organization membership",
    (status) => {
      hub.origin = "hub://personal-hub";
      hub.state = {
        status,
        account,
        memberships: [],
        canCreateOrganization: false,
      };
      render(view());
      fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
      expect(screen.getByTestId("account-sessions").textContent).toBe("hub://personal-hub");
    },
  );

  it("keeps session management available while an invitation needs recovery", () => {
    hub.origin = "hub://work-hub";
    hub.state = {
      status: "organizationRequired",
      account,
      invitationUnavailable: true,
    };
    render(view());
    expect(screen.getByRole("alert").textContent).toContain("This invitation is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByTestId("account-sessions").textContent).toBe("hub://work-hub");
  });

  it("resets the selected tab when Hub or account identity changes", () => {
    hub.origin = "hub://first-hub";
    hub.state = {
      status: "organizationRequired",
      account,
      memberships: [],
      canCreateOrganization: false,
    };
    const ui = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    hub.origin = "hub://second-hub";
    ui.rerender(view());
    expect(screen.queryByTestId("account-sessions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByTestId("account-sessions").textContent).toBe("hub://second-hub");
    hub.state = {
      ...hub.state,
      account: { ...account, id: "another-account" },
    };
    ui.rerender(view());
    expect(screen.queryByTestId("account-sessions")).toBeNull();
  });

  it("does not expose Sessions before authentication or change the legacy mount", () => {
    hub.origin = "hub://work-hub";
    render(view());
    expect(screen.queryByRole("button", { name: "Sessions" })).toBeNull();
  });
});

describe("Account entry lifecycle and recovery", () => {
  it.each(["active", "appSetupRequired"])(
    "focuses requested Connection identity from %s and returns to Account",
    (status) => {
      navigation.params = { channelConnectionId: "slack-connection" };
      hub.state = {
        status,
        account,
        organization: { id: "org", name: "Organization" },
        membership: { id: "membership", role: "owner" },
        isInstanceOperator: true,
      };
      const ui = render(view());
      expect(screen.getByTestId("identity-settings").textContent).toBe("slack-connection");
      expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back to Account" }));
      expect(navigation.setParams).toHaveBeenCalledWith({
        channelConnectionId: undefined,
      });
      ui.rerender(view());
      expect(screen.queryByRole("button", { name: "Back to Account" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
      expect(hub.signOut).not.toHaveBeenCalled();
    },
  );

  it("uses ordinary Account during legacy setup without a completion ceremony", () => {
    hub.state = {
      status: "appSetupRequired",
      account,
      organization: { id: "org", name: "Organization" },
      membership: { id: "membership", role: "owner" },
      isInstanceOperator: true,
    };
    render(view());
    expect(screen.getByText(/^Full access to every current and future Host/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
    expect(screen.queryByTestId("identity-settings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage chat accounts" }));
    expect(screen.getByTestId("identity-settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Account" }));
    expect(screen.getByRole("button", { name: "Manage chat accounts" })).toBeTruthy();
    expect(screen.queryByTestId("identity-settings")).toBeNull();
    expect(hub.completeAppSetup).not.toHaveBeenCalled();
  });

  it("preserves the requested Connection when setup state becomes active", () => {
    navigation.params = { channelConnectionId: "slack-connection" };
    hub.state = {
      status: "appSetupRequired",
      account,
      organization: { id: "org", name: "Organization" },
      membership: { id: "membership", role: "owner" },
      isInstanceOperator: true,
    };
    const ui = render(view());
    expect(screen.getByTestId("identity-settings").textContent).toBe("slack-connection");
    hub.state = { ...hub.state, status: "active" };
    ui.rerender(view());
    expect(screen.getByTestId("identity-settings").textContent).toBe("slack-connection");
    expect(navigation.setParams).not.toHaveBeenCalled();
    expect(hub.completeAppSetup).not.toHaveBeenCalled();
  });

  it("signs in where a Hub section was asked for, then shows that section", async () => {
    const ui = render(<HubSettingsContent section="team" />);
    expect(screen.queryByTestId("team-settings")).toBeNull();
    enter("Email", account.email);
    enter("Password", "member-password");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in" })));
    expect(hub.signIn).toHaveBeenCalledWith({
      email: account.email,
      password: "member-password",
    });
    hub.state = {
      status: "active",
      account,
      organization: { id: "org", name: "Organization" },
      membership: { role: "member" },
      isInstanceOperator: false,
    };
    hub.signedIn = hub.state;
    ui.rerender(<HubSettingsContent section="team" />);
    expect(screen.getByTestId("team-settings")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("keeps an identity deep link behind account sign-in", () => {
    navigation.params = { channelConnectionId: "slack-connection" };
    render(view());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(screen.queryByTestId("identity-settings")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to Account" })).toBeNull();
  });

  it("does not reuse invisible credentials after sign-out", async () => {
    const ui = render(view());
    enter("Email", account.email);
    enter("Password", "member-password");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in" })));
    expect(hub.signIn).toHaveBeenCalledWith({
      email: account.email,
      password: "member-password",
    });
    hub.state = {
      status: "active",
      account,
      organization: { id: "org", name: "Organization" },
      membership: { role: "member" },
      isInstanceOperator: false,
    };
    ui.rerender(view());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    hub.state = { status: "signedOut", registration: "open" };
    ui.rerender(view());
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("leads sign-in with Google and keeps the email form one step away", () => {
    const signInWithGoogle = vi.fn(async () => {});
    Object.assign(hub, { signInWithGoogle });
    hub.state = {
      status: "signedOut",
      registration: "open",
      googleSignIn: true,
    };
    try {
      render(view());
      expect(screen.queryByLabelText("Email")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Use email and password instead" }));
      expect(screen.getByLabelText("Email")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
      expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(hub, { signInWithGoogle: undefined });
      hub.state = { status: "signedOut", registration: "open" };
    }
  });

  it("keeps shared fields visible and resets signup-only fields when changing mode", () => {
    render(view());
    enter("Email", account.email);
    enter("Password", "member-password");
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(account.email);
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("member-password");
    enter("Name", "Member");
    enter("Confirm password", "member-password");
    fireEvent.click(screen.getByRole("button", { name: "Already have an account? Sign in" }));
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).value).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "Create account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("offers recovery instead of an empty organization chooser", async () => {
    hub.state = {
      status: "organizationRequired",
      account,
      memberships: [],
      canCreateOrganization: false,
    };
    render(view());
    expect(screen.getByRole("alert").textContent).toContain("No organization available");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    expect(hub.signOut).toHaveBeenCalledTimes(1);
  });

  it("lists each organization with its role and an explicit Open action", async () => {
    const select = vi.fn(async () => {});
    Object.assign(hub, { selectOrganization: select });
    hub.state = {
      status: "organizationRequired",
      account,
      memberships: [
        {
          id: "org-a",
          name: "vexere.com",
          slug: "vexere-com",
          membershipId: "m-a",
          role: "owner",
        },
        {
          id: "org-b",
          name: "Acme",
          slug: "acme",
          membershipId: "m-b",
          role: "member",
        },
      ],
      canCreateOrganization: false,
    };
    render(view());
    expect(screen.getByText("Owner · vexere-com")).toBeTruthy();
    expect(screen.getByText("Member · acme")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]!));
    expect(select).toHaveBeenCalledWith("org-b");
  });

  it("keeps a pending invitation ahead of legacy setup Account capabilities", async () => {
    navigation.params = { channelConnectionId: "slack-connection" };
    hub.state = {
      status: "appSetupRequired",
      account,
      invitation: {
        id: "invite",
        role: "member",
        organization: { id: "invited-org", name: "Invited organization" },
        inviterName: "Owner",
      },
    };
    render(view());
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
    expect(screen.queryByTestId("identity-settings")).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Accept invitation" })),
    );
    expect(hub.acceptInvitation).toHaveBeenCalledWith("invite");
    expect(navigation.setParams).not.toHaveBeenCalled();
    expect(hub.completeAppSetup).not.toHaveBeenCalled();
  });

  it.each(["active", "appSetupRequired"])(
    "does not hide an unavailable invitation in %s",
    async (status) => {
      hub.state = { status, account, invitationUnavailable: true };
      render(view());
      expect(screen.getByRole("alert").textContent).toContain("This invitation is unavailable");
      expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
      expect(hub.refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    },
  );
});

describe("first Host after signing in", () => {
  function signedIn(canManage = true) {
    hub.state = {
      status: "active",
      account,
      organization: { id: "org", name: "Organization" },
      membership: { id: "membership", role: canManage ? "owner" : "member" },
      capabilities: { manageResources: canManage },
    };
    hub.signedIn = hub.state;
  }

  it("shows both choices after sign-in and opens the existing managed Host guide", () => {
    const ui = render(view());
    expect(screen.queryByText("Add your first Host")).toBeNull();
    signedIn();
    ui.rerender(view());
    expect(screen.getByText("Add your first Host")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect directly" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add via Hub" }));
    expect(navigation.push).toHaveBeenCalledWith("/settings/hub/hosts");
  });

  it("opens the direct form, supports cancel, and enters the saved Host", () => {
    signedIn();
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Connect directly" }));
    expect(screen.getByRole("region", { name: "Direct connection form" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel direct connection" }));
    expect(screen.queryByRole("region", { name: "Direct connection form" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect directly" }));
    fireEvent.click(screen.getByRole("button", { name: "Save direct connection" }));
    expect(navigation.push).toHaveBeenCalledWith("/h/direct-host");
  });

  it("does not treat loading or an inventory error as having no Hosts", () => {
    signedIn();
    inventory.status = "loading";
    const ui = render(view());
    expect(screen.getByText("Checking your Hosts…")).toBeTruthy();
    expect(screen.queryByText("Add your first Host")).toBeNull();
    inventory.status = "error";
    inventory.error = "offline";
    ui.rerender(view());
    expect(screen.getByRole("alert").textContent).toContain("Could not load your Hosts");
    expect(screen.queryByText("Add your first Host")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(inventory.retry).toHaveBeenCalledOnce();
    inventory.status = "ready";
    inventory.error = null;
    ui.rerender(view());
    expect(screen.getByText("Add your first Host")).toBeTruthy();
  });

  it.each(["direct", "managed"])("does not offer first setup when a %s Host exists", (kind) => {
    signedIn();
    const ui = render(view());
    if (kind === "direct") inventory.hosts = [{ serverId: "offline-host" }];
    else
      inventory.daemons.data = {
        daemons: [{ id: "registered-without-an-offer" }],
      };
    ui.rerender(view());
    expect(screen.queryByText("Add your first Host")).toBeNull();
  });

  it("offers Members direct access and shared Host guidance without enrollment authority", () => {
    signedIn(false);
    render(view());
    expect(screen.queryByRole("button", { name: "Add via Hub" })).toBeNull();
    expect(screen.getByText(/Ask an owner or admin to add one/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect directly" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View shared Hosts" }));
    expect(navigation.push).toHaveBeenCalledWith("/settings/hub/hosts");
  });
});

it("opens Hub account sign-in configuration without redirecting it to the Account login form", () => {
  render(<HubSettingsContent section="sign-in" />);
  expect(screen.getByTestId("hub-login-policy")).toBeTruthy();
  expect(screen.queryByText("Continue with Google")).toBeNull();
});
