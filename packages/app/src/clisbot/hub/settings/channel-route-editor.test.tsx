// @vitest-environment jsdom
import { AutomationInputDraftContext } from "./automation-input-draft";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubApiError } from "../api-client";
import { CHANNEL_CATALOG_RESPONSE } from "../channel-catalog.fixture";
import { ChannelSettings } from "./channel-settings";
import { HubSettingsDetailScrollProvider } from "./detail-scroll";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  scrollToTop: vi.fn(),
  canManage: true,
  accountId: "owner",
}));
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
  ChannelActionsMenu: function MenuAdapter({
    label,
    disabled,
    remove,
  }: {
    label: string;
    disabled: boolean;
    remove(): void;
  }) {
    const [open, setOpen] = React.useState(false);
    const toggle = React.useCallback(() => setOpen((value) => !value), []);
    const select = React.useCallback(() => {
      setOpen(false);
      remove();
    }, [remove]);
    return (
      <div>
        <button type="button" aria-label={label} disabled={disabled} onClick={toggle}>
          …
        </button>
        {open ? (
          <button type="button" disabled={disabled} onClick={select}>
            Remove
          </button>
        ) : null}
      </div>
    );
  },
}));
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
        defaultValue={props.initialValue}
        onChange={change}
        disabled={props.editable === false}
        placeholder={props.placeholder}
      />
    );
  },
}));
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
vi.mock("./conversation-picker-field", () => ({
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
}));
vi.mock("./managed-workspace-fields", () => ({
  ManagedWorkspaceFields: () => null,
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
  match: { kind: "channel", ids: ["C1"], contains: "#help" },
  audience: { kind: "members" },
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
        status: "connected",
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
  adapters.put.mockReset().mockResolvedValue(configuration);
  adapters.confirm.mockReset().mockResolvedValue(true);
  adapters.scrollToTop.mockReset();
  adapters.canManage = true;
  adapters.accountId = "owner";
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function renderChannels(automationName?: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <HubSettingsDetailScrollProvider onNavigate={adapters.scrollToTop}>
        <ChannelSettings automationName={automationName} />
      </HubSettingsDetailScrollProvider>
    </QueryClientProvider>,
  );
}
async function openEditor() {
  renderChannels();
  fireEvent.click(await screen.findByText("Manage", {}, { timeout: 10_000 }));
  adapters.scrollToTop.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByText("Edit Route 1");
  expect(adapters.scrollToTop).toHaveBeenCalledTimes(1);
}

describe("Channel Route focused editing", { timeout: 20_000 }, () => {
  it("retains dirty YAML across local views and resets it for a different principal", async () => {
    const ui = renderChannels();
    await screen.findByRole("button", { name: "Manage" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    const yaml = screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement;
    const draft = `${yaml.value}\n# draft retained locally`;
    fireEvent.change(yaml, { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    expect((screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement).value).toBe(draft);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    expect((screen.getByLabelText("Configuration YAML") as HTMLTextAreaElement).value).toBe(draft);
    adapters.accountId = "other-owner";
    ui.rerender(
      <QueryClientProvider client={queryClient}>
        <HubSettingsDetailScrollProvider onNavigate={adapters.scrollToTop}>
          <ChannelSettings />
        </HubSettingsDetailScrollProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Advanced YAML" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
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
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("uses accessible ordering arrows with boundary controls disabled", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Move Route 1 up",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Move Route 1 down",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText("Up")).toBeNull();
    expect(screen.queryByText("Down")).toBeNull();
    expect(screen.queryByText("Connection and access")).toBeNull();
    expect(screen.queryByText(/No Member or Team grants/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Who can use this?" }));
    expect(screen.getByText(/Owners have access automatically/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage access" })).toBeTruthy();
  });

  it("requires an explicit Any choice before broadening an emptied specific Route", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: "" },
    });
    expect((screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(adapters.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Any matching conversation" }));
    expect(screen.queryByLabelText("Conversation IDs")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalled());
    expect(adapters.put.mock.calls[0]![1].accounts[0].routes[0].match.ids).toBeUndefined();
  });

  it("preserves an existing unrestricted Member Route until specific selection is explicit", async () => {
    const unrestricted = {
      ...configuration,
      accounts: [
        {
          ...account,
          routes: [{ ...route, match: { kind: "channel", contains: "#help" } }],
        },
      ],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? unrestricted : data[resource],
    );
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Conversation IDs")).toBeNull();
    expect((screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Selected conversations" }));
    expect((screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(adapters.put).not.toHaveBeenCalled();
  });

  it("clears specific IDs on conversation type change and requires a new selection", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect((screen.getByLabelText("Conversation IDs") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Save Route" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(adapters.put).not.toHaveBeenCalled();
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
      fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
      fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    await screen.findByText(/This Hub cannot preview test messages/);
    expect(adapters.confirm).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("renders provider names with canonical IDs and keeps IDs usable when metadata is unavailable", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    expect(await screen.findByText(/#support \(C1\)/)).toBeTruthy();
    adapters.get.mockImplementation(async (resource: string) => {
      if (resource.endsWith("/conversations")) throw new Error("provider metadata unavailable");
      return data[resource];
    });
    adapters.accountId = "other-owner";
    cleanup();
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    expect(screen.getByText(/channel · C1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    await screen.findByText(/test destination changed/);
    expect(screen.queryByText(/Test message sent to/)).toBeNull();
    expect(adapters.post).toHaveBeenCalledTimes(1);
    expect(adapters.post).toHaveBeenCalledWith(
      "channel-accounts/slack/support/test",
      expect.objectContaining({ expectedPreviewId: "old-preview" }),
      expect.anything(),
    );
  });

  it("reorders Routes using icon actions while preserving the other configuration", async () => {
    const otherRoute = {
      ...route,
      match: { kind: "channel", ids: ["C2"], contains: "#second" },
    };
    const multiple = {
      ...configuration,
      accounts: [{ ...configuration.accounts[0], routes: [route, otherRoute] }],
    };
    adapters.get.mockImplementation(async (resource: string) =>
      resource === "channel-configuration" ? multiple : data[resource],
    );
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Route 1 down" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByText("Channel activity")).toBeNull();
    expect(adapters.get.mock.calls.some(([resource]) => resource.includes("activity"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "View activity" }));
    expect((screen.getByLabelText("Channel account") as HTMLSelectElement).value).toBe(
      "slack:support",
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Back to activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByText("Channel activity")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("button", { name: "Back to activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    expect(adapters.put).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("starts with accounts only and keeps Advanced YAML collapsed until requested", async () => {
    renderChannels();
    await screen.findByRole("button", { name: "Manage" });
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    expect(screen.queryByLabelText("Configuration YAML")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    expect(screen.getByLabelText("Configuration YAML")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide Advanced YAML" }));
    expect(screen.queryByLabelText("Configuration YAML")).toBeNull();
  });

  it("adds a Route within the selected account with thread replies enabled by default", async () => {
    renderChannels();
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Route" }));
    expect(screen.queryByLabelText("Account name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect a provider account" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Channel" }));
    expect((screen.getByLabelText("Reply in a thread") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Text forward" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Channel tool" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate Route" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add Route" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
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
        status: "connected",
        consumers: [],
      };
      currentConnections = {
        connections: [...(data.connections as { connections: unknown[] }).connections, created],
        providerApplications: [],
      };
      return created;
    });
    renderChannels();
    await screen.findByRole("button", { name: "Manage" });
    fireEvent.click(screen.getByRole("button", { name: "Add Channel account" }));
    fireEvent.change(screen.getByLabelText("Connection"), {
      target: { value: "connection" },
    });
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "new-account" },
    });
    fireEvent.change(screen.getByLabelText("Automation"), {
      target: { value: "support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect a provider account" }));
    expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull();
    // The Add-connection form is catalog-driven, so it mounts once the Hub's
    // catalog read lands and the first connectable channel is chosen.
    fireEvent.change(await screen.findByRole("textbox", { name: "Account name" }), {
      target: { value: "new-bot" },
    });
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: "bot-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull(),
    );
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("new-account");
    expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe("new-connection");
    expect((screen.getByLabelText("Automation") as HTMLSelectElement).value).toBe("support");
    fireEvent.click(screen.getByRole("button", { name: "Activate Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Activate Route" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Add Route" })).toBeTruthy();
    expect(screen.getByText("Telegram · new-account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Channel account" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("");
  });

  it("offers every channel this Hub can connect and swaps the credential form", async () => {
    renderChannels();
    await screen.findByRole("button", { name: "Manage" });
    fireEvent.click(screen.getByRole("button", { name: "Add Channel account" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect a provider account" }));
    expect(await screen.findByText("Connect Telegram")).toBeTruthy();
    // Slack Socket Mode is created from a Provider Application; this Member is
    // not an instance operator, so it is not on offer.
    expect(screen.queryByRole("button", { name: "Slack" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zalo Official Bot" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Feishu / Lark" }));
    expect(await screen.findByText("Connect Feishu / Lark")).toBeTruthy();
    expect(screen.getByLabelText("App ID")).toBeTruthy();
    expect(screen.getByLabelText("App secret")).toBeTruthy();
    expect(screen.getByLabelText("Domain")).toBeTruthy();
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
    await screen.findByRole("button", { name: "Manage" });
    fireEvent.click(screen.getByRole("button", { name: "Add Channel account" }));
    await screen.findByText("Automations unavailable");
    expect(screen.queryByLabelText("Account name")).toBeNull();
    unavailable = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry Channel setup" }));
    expect(await screen.findByLabelText("Account name")).toBeTruthy();
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
    await screen.findByRole("button", { name: "Manage" });
    fireEvent.click(screen.getByRole("button", { name: "Add Channel account" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect a provider account" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Account name" }), {
      target: { value: "bot" },
    });
    fireEvent.change(screen.getByLabelText("Bot token"), {
      target: { value: "token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and add Connection" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Back to Channels",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Back to Channel account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () =>
      resolve({
        id: "created",
        provider: "telegram",
        name: "Bot",
        externalName: null,
        status: "connected",
        consumers: [],
      }),
    );
  });

  it("gives Members an Account recovery path without requesting management configuration", () => {
    adapters.canManage = false;
    renderChannels();
    expect(screen.getByRole("button", { name: "Open Account settings" })).toBeTruthy();
    expect(adapters.get).not.toHaveBeenCalled();
  });

  it("preserves an Agent Route directory, clears it on Host change, and saves the selected Project root", async () => {
    const agentConfiguration = {
      ...configuration,
      accounts: [
        {
          ...account,
          routes: [
            {
              match: route.match,
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

  it("opens the seeded Route immediately and Cancel returns to the selected account without saving", async () => {
    await openEditor();
    expect((screen.getByLabelText("Conversation IDs") as HTMLInputElement).value).toBe("C1");
    expect((screen.getByLabelText("Contains exact text") as HTMLInputElement).value).toBe("#help");
    expect((screen.getByLabelText("Reply in a thread") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Channel accounts")).toBeNull();
    expect(screen.queryByText("Add Channel behavior")).toBeNull();
    expect(screen.queryByText("Advanced YAML")).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify and add Connection" })).toBeNull();
    adapters.scrollToTop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Channel accounts");
    expect(adapters.scrollToTop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
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
                match: { kind: "channel", ids: ["C2"], contains: "#help" },
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
    await screen.findByText("Channel accounts");
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
    expect((screen.getByLabelText("Contains exact text") as HTMLInputElement).value).toBe("#help");
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
    fireEvent.click(screen.getByRole("button", { name: "Back to Channels" }));
    await act(async () => confirm(true));
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.put).not.toHaveBeenCalled();
  });
});

describe("Automation Channel inputs", { timeout: 20_000 }, () => {
  it("edits the canonical Route while preserving direct Agent Routes and custom policy", async () => {
    const directRoute = {
      match: { kind: "dm" },
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
    expect(screen.getByText("Run Automation: support").textContent).toBe("Run Automation: support");
    fireEvent.change(screen.getByLabelText("Contains exact text"), {
      target: { value: "#triage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await waitFor(() => expect(adapters.put).toHaveBeenCalledTimes(1));
    expect(adapters.put.mock.calls[0]![1]).toMatchObject({
      expectedRevisionId: "revision",
      accounts: [
        {
          routes: [directRoute, { ...route, match: { ...route.match, contains: "#triage" } }],
        },
      ],
    });
    await screen.findByRole("button", { name: "Edit input and replies" });
  });

  it("keeps a rejected input draft visible and cancels without a second write", async () => {
    adapters.put.mockRejectedValue(new Error("Configuration changed; reload before saving."));
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Contains exact text"), {
      target: { value: "#draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Route" }));
    await screen.findByText("Configuration changed; reload before saving.");
    expect((screen.getByLabelText("Contains exact text") as HTMLInputElement).value).toBe("#draft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Edit input and replies" });
    expect(adapters.put).toHaveBeenCalledTimes(1);
  });

  it("refuses to apply an old draft after another surface reorders the shared configuration", async () => {
    renderChannels("support");
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Contains exact text"), {
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
                  match: { kind: "dm" },
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
    expect((screen.getByLabelText("Contains exact text") as HTMLInputElement).value).toBe("#draft");
  });

  it("stages an Automation input with the shared editor without publishing a Route", async () => {
    const stage = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <AutomationInputDraftContext.Provider
          value={{
            provider: "slack",
            draft: null,
            stage,
            setEditing: vi.fn(),
            pending: false,
          }}
        >
          <ChannelSettings automationName="support" />
        </AutomationInputDraftContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit input and replies" }));
    fireEvent.change(screen.getByLabelText("Contains exact text"), {
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
              match: expect.objectContaining({ contains: "#draft" }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Use this connection" }));
    expect(screen.getByText("Run Automation: support").textContent).toBe("Run Automation: support");
    expect(screen.queryByRole("button", { name: "Create Automation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(adapters.put).not.toHaveBeenCalled();
  });
});
