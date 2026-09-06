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
  signedIn: null,
  signIn: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  acceptInvitation: vi.fn(async () => {}),
  completeAppSetup: vi.fn(async () => {}),
}));
const navigation = vi.hoisted(() => ({
  params: {} as { channelConnectionId?: string },
  setParams: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: navigation.setParams }),
  useLocalSearchParams: () => navigation.params,
}));
vi.mock("../account-provider", () => ({ useHubAccount: () => hub }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("./channel-settings", () => ({ ChannelSettings: () => null }));
vi.mock("./automation-settings", () => ({ AutomationSettings: () => null }));
vi.mock("./access-settings", () => ({ AccessSettings: () => null }));
vi.mock("./api-key-settings", () => ({ ApiKeySettings: () => null }));
vi.mock("./provider-application-settings", () => ({
  ProviderApplicationSettings: () => (
    <section aria-label="Provider applications">Slack Connected · 1 Connection</section>
  ),
}));
vi.mock("./channel-identity-settings", () => ({
  ChannelIdentitySettings: () => null,
  ChannelIdentitySelfLinkSettings: () => (
    <div data-testid="identity-settings">{navigation.params.channelConnectionId}</div>
  ),
}));
vi.mock("../host-onboarding-section", () => ({ HubHostOnboardingSection: () => null }));
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
vi.mock("@/screens/settings/settings-section", () => ({
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
});
afterEach(cleanup);
function enter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function view() {
  return <HubSettingsContent section="account" />;
}

const account = { id: "member", name: "Member", email: "member@example.test" };

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
      expect(navigation.setParams).toHaveBeenCalledWith({ channelConnectionId: undefined });
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
    expect(screen.getByText(/Full organization access/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
    expect(screen.queryByTestId("identity-settings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Your Channel identities" }));
    expect(screen.getByTestId("identity-settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Account" }));
    expect(screen.getByRole("button", { name: "Your Channel identities" })).toBeTruthy();
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
    expect(hub.signIn).toHaveBeenCalledWith({ email: account.email, password: "member-password" });
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
      (screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled,
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
