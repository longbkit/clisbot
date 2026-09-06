// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubSettingsContent } from "./screen";
import { HubSettingsDetailScrollProvider } from "./detail-scroll";
import { ChannelIdentitySelfLinkSettings } from "./channel-identity-settings";

const fixture = vi.hoisted(() => ({
  connectionId: "slack-connection",
  scroll: vi.fn(),
  setParams: vi.fn(),
  status: "active" as "active" | "appSetupRequired" | "signedOut" | "passwordChangeRequired",
  completeAppSetup: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: fixture.setParams }),
  useLocalSearchParams: () => ({ channelConnectionId: fixture.connectionId }),
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => {
    const state = {
      status: fixture.status,
      account: { id: "owner", name: "Owner", email: "owner@example.test" },
      organization: { id: "org", name: "Organization" },
      membership: { id: "membership", role: "owner" },
      isInstanceOperator: true,
    };
    return {
      enabled: true,
      loading: false,
      error: null,
      signOut: vi.fn(),
      origin: "https://hub.test",
      signedIn: ["active", "appSetupRequired"].includes(state.status) ? state : null,
      state,
      completeAppSetup: fixture.completeAppSetup,
      api: () => ({ get: fixture.get, post: fixture.post }),
    };
  },
}));
vi.mock("./channel-settings", () => ({ ChannelSettings: () => null }));
vi.mock("./automation-settings", () => ({ AutomationSettings: () => null }));
vi.mock("./access-settings", () => ({ AccessSettings: () => null }));
vi.mock("./api-key-settings", () => ({ ApiKeySettings: () => null }));
vi.mock("./provider-application-settings", () => ({ ProviderApplicationSettings: () => null }));
vi.mock("../host-onboarding-section", () => ({ HubHostOnboardingSection: () => null }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: fixture.copy }));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormTextInput: () => null,
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
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string | null;
    onChange(value: string): void;
    options: { id: string; value: string; label: string }[];
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <select aria-label={label} value={value ?? ""} onChange={change}>
        <option value="">Choose</option>
        {options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
const connections = [
  { id: "slack-connection", provider: "slack", name: "Support workspace", canLinkIdentity: true },
  { id: "telegram-connection", provider: "telegram", name: "Support bot", canLinkIdentity: true },
];
const challenge = { command: "/link TEST-CODE", expiresAt: "2026-09-06T00:00:00Z" };
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  fixture.connectionId = "slack-connection";
  fixture.status = "active";
  fixture.setParams.mockImplementation((params: { channelConnectionId?: string }) => {
    fixture.connectionId = params.channelConnectionId ?? "";
  });
  fixture.get.mockImplementation(async (resource: string) =>
    resource === "connections" ? { connections, providerApplications: [] } : { identities: [] },
  );
  fixture.post.mockResolvedValue(challenge);
  fixture.copy.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
function view() {
  return (
    <QueryClientProvider client={client}>
      <ChannelIdentitySelfLinkSettings />
    </QueryClientProvider>
  );
}

describe("Channel identity recovery", () => {
  it.each(["signedOut", "passwordChangeRequired"] as const)(
    "does not read Channel identity resources before %s is resolved",
    (status) => {
      fixture.status = status;
      render(
        <QueryClientProvider client={client}>
          <HubSettingsContent section="account" />
        </QueryClientProvider>,
      );
      expect(screen.queryByRole("button", { name: "Create link code" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Back to Account" })).toBeNull();
      expect(fixture.get).not.toHaveBeenCalled();
      expect(fixture.post).not.toHaveBeenCalled();
    },
  );
  it.each(["", "slack-connection"])(
    "opens the actual Account identity flow during legacy setup (Connection %s)",
    async (connectionId) => {
      fixture.status = "appSetupRequired";
      fixture.connectionId = connectionId;
      const accountView = () => (
        <QueryClientProvider client={client}>
          <HubSettingsDetailScrollProvider onNavigate={fixture.scroll}>
            <HubSettingsContent section="account" />
          </HubSettingsDetailScrollProvider>
        </QueryClientProvider>
      );
      const ui = render(accountView());
      if (!connectionId) {
        expect(fixture.get).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Your Channel identities" }));
      }
      await screen.findByRole("option", { name: "Slack · Support workspace" });
      const select = screen.getByLabelText("Connection") as HTMLSelectElement;
      if (connectionId) expect(select.value).toBe("slack-connection");
      else fireEvent.change(select, { target: { value: "slack-connection" } });
      expect(
        (screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement).disabled,
      ).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
      await screen.findByRole("button", { name: "Copy link command" });
      expect(fixture.post).toHaveBeenCalledWith(
        "channel-identities/challenges",
        { connectionId: "slack-connection" },
        expect.anything(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Back to Account" }));
      ui.rerender(accountView());
      expect(screen.getByRole("button", { name: "Your Channel identities" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Create link code" })).toBeNull();
      expect(fixture.scroll).toHaveBeenCalled();
      expect(fixture.completeAppSetup).not.toHaveBeenCalled();
    },
  );
  it.each(["active", "appSetupRequired"] as const)(
    "prefills Slack and offers proof in %s without completing setup",
    async (status) => {
      fixture.status = status;
      render(view());
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
        "slack-connection",
      );
      expect(fixture.post).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
      expect(
        await screen.findByText(/In Slack, mention the bot, then paste this command/),
      ).toBeTruthy();
      expect(fixture.post).toHaveBeenCalledWith(
        "channel-identities/challenges",
        { connectionId: "slack-connection" },
        expect.anything(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy link command" }));
      await screen.findByRole("button", { name: "Copied link command" });
      expect(fixture.copy).toHaveBeenCalledExactlyOnceWith("/link TEST-CODE");
      expect(fixture.post).toHaveBeenCalledOnce();
      expect(fixture.completeAppSetup).not.toHaveBeenCalled();
    },
  );
  it("does not fall back to another Connection when the requested one cannot be used", async () => {
    fixture.connectionId = "missing";
    render(view());
    await screen.findByText(/The requested Connection is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
    expect(fixture.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Connection"), {
      target: { value: "telegram-connection" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
    expect(
      await screen.findByText(
        /Send this command from your own Telegram account to the selected bot/,
      ),
    ).toBeTruthy();
    expect(fixture.post).toHaveBeenCalledWith(
      "channel-identities/challenges",
      { connectionId: "telegram-connection" },
      expect.anything(),
    );
  });
  it("drops an old Connection's delayed code when the recovery route changes", async () => {
    let resolve!: (value: unknown) => void;
    fixture.post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const ui = render(view());
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
    fixture.connectionId = "telegram-connection";
    ui.rerender(view());
    await act(async () => resolve(challenge));
    expect(screen.queryByText(/TEST-CODE/)).toBeNull();
    expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe(
      "telegram-connection",
    );
  });
  it("clears the one-use command after polling observes the verified identity", async () => {
    render(view());
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
    await screen.findByRole("button", { name: "Copy link command" });
    fixture.get.mockImplementation(async (resource: string) =>
      resource === "connections"
        ? { connections, providerApplications: [] }
        : {
            identities: [
              {
                id: "linked",
                memberId: "membership",
                connectionId: "slack-connection",
                displayName: "Owner in Slack",
                externalSubjectId: "UOWNER",
              },
            ],
          },
    );
    await screen.findByText("Owner in Slack", {}, { timeout: 5000 });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Copy link command" })).toBeNull(),
    );
    expect(screen.queryByText(/TEST-CODE/)).toBeNull();
    expect(fixture.post).toHaveBeenCalledOnce();
  });

  it("keeps the command visible if copying fails so verification can continue", async () => {
    fixture.copy.mockRejectedValue(new Error("Clipboard unavailable"));
    render(view());
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create link code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy link command" }));
    expect(await screen.findByText("Clipboard unavailable")).toBeTruthy();
    expect(screen.getByText(/TEST-CODE/)).toBeTruthy();
  });
});
