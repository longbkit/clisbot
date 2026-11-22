// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import { AGENT_PROVIDER_DEFINITIONS } from "@clisbot/protocol/provider-manifest";
import {
  useProviderSwitch,
  withSwitchProviders,
  type ProviderSwitchTarget,
} from "./provider-switch";

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  fork: vi.fn(async (_request: unknown) => undefined),
  forkChatSession: vi.fn(async (_params: unknown) => ({ error: null as string | null })),
  toastError: vi.fn(),
  agent: {
    provider: "codex",
    model: "codex-model",
    cwd: "/bot",
    workspaceId: "ws",
    currentModeId: "full-access" as string | null,
    fullAutoAccept: false,
    features: [] as { id: string; value?: unknown }[],
    availableModes: [] as { id: string; label: string }[],
    labels: { "clisbot.bot-id": "bot-a", "clisbot.chat-id": "chat-a" },
  },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: state.toastError }) }));
vi.mock("@/hooks/use-fork-agent", () => ({ useForkAgent: () => state.fork }));
vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_server: string, name: string) => state.features[name] === true,
}));
vi.mock("./feature", () => ({ COMPOSER_PICKER_ENABLED: true }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: {
    children: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <button
      type="button"
      data-testid={props.testID}
      disabled={props.disabled}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: (props: {
    header: { title: string };
    children: React.ReactNode;
    footer: React.ReactNode;
    onClose: () => void;
    onDismiss?: () => void;
    testID?: string;
  }) => (
    <div data-testid={props.testID} role="dialog" aria-label={props.header.title}>
      <button type="button" data-testid="sheet-close" onClick={props.onClose}>
        close
      </button>
      <button type="button" data-testid="sheet-dismiss" onClick={props.onDismiss}>
        dismiss
      </button>
      {props.children}
      {props.footer}
    </div>
  ),
}));
vi.mock("@/stores/session-store", () => {
  const store = {
    sessions: {
      host: {
        client: { forkChatSession: state.forkChatSession },
        agents: new Map([["agent-1", state.agent]]),
      },
    },
  };
  const useSessionStore = (select: (value: typeof store) => unknown) => select(store);
  useSessionStore.getState = () => store;
  return { useSessionStore };
});

const ENTRIES: ProviderSnapshotEntry[] = [
  ...AGENT_PROVIDER_DEFINITIONS.map(
    (definition): ProviderSnapshotEntry => ({
      provider: definition.id,
      status: "ready",
      enabled: true,
      label: definition.label,
      modes: definition.modes.map(({ id, label, isUnattended }) => ({
        id,
        label,
        ...(isUnattended ? { isUnattended } : {}),
      })),
      models: [
        {
          provider: definition.id,
          id: `${definition.id}-model`,
          label: `${definition.label} Model`,
        },
      ],
    }),
  ),
  {
    provider: "acme-acp",
    status: "ready",
    enabled: true,
    label: "Acme",
    modes: [
      { id: "careful", label: "Careful" },
      { id: "foo#plan", label: "Plan-ish" },
    ],
    models: [{ provider: "acme-acp", id: "acme-model", label: "Acme Model" }],
  },
];

function Harness(props: {
  target: ProviderSwitchTarget;
  onReady: (pick: ((p: string, m: string) => void) | null) => void;
}) {
  const { switchProvider, reviewElement } = useProviderSwitch({
    serverId: "host",
    agentId: "agent-1",
    target: props.target,
    entries: ENTRIES,
  });
  props.onReady(switchProvider);
  return reviewElement;
}

let pickFn: ((p: string, m: string) => void) | null = null;
const onReady = (next: ((p: string, m: string) => void) | null) => {
  pickFn = next;
};
function mount(target: ProviderSwitchTarget = { kind: "chat", chatId: "chat-a" }) {
  render(<Harness target={target} onReady={onReady} />);
}
async function pick(provider: string, model = `${provider}-model`) {
  await act(async () => pickFn?.(provider, model));
}
async function press(testId: string) {
  await act(async () => fireEvent.click(screen.getByTestId(testId)));
}
const text = (testId: string) => screen.getByTestId(testId).textContent;
const checked = (modeId: string) =>
  screen.getByTestId(`provider-switch-permission-${modeId}`).getAttribute("aria-checked");

beforeEach(() => {
  state.features = { chatProviderFork: true, agentForkContext: true, fullAutoAccept: true };
  Object.assign(state.agent, {
    provider: "codex",
    model: "codex-model",
    currentModeId: "full-access",
    fullAutoAccept: false,
  });
  state.forkChatSession.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("Codex Full access → Claude: both sides and permissions are shown; Bypass, not Full auto-accept", async () => {
  mount();
  await pick("claude");
  expect(text("provider-switch-from")).toBe("Codex · Codex Model");
  expect(text("provider-switch-from-permission")).toBe(
    "composer.picker.modeLabels.codexFullAccess",
  );
  expect(text("provider-switch-to")).toBe("Claude · Claude Model");
  expect(text("provider-switch-to-permission")).toBe("composer.picker.modeLabels.claudeBypass");
  expect(checked("bypassPermissions")).toBe("true");
  expect(checked(FULL_AUTO_ACCEPT_MODE_ID)).toBe("false");
  expect(text("provider-switch-reason")).toContain("reasons.equivalent");
  expect(text("provider-switch-history")).toBe("composer.providerSwitch.chatHistory");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledTimes(1);
  expect(state.forkChatSession).toHaveBeenCalledWith({
    chatId: "chat-a",
    botId: "bot-a",
    launch: { provider: "claude", model: "claude-model", modeId: "bypassPermissions" },
    expectedAgentId: "agent-1",
  });
  expect(screen.queryByTestId("provider-switch-review")).toBeNull();
});

test("Clisbot Full auto-accept is kept as itself; Claude → Codex in Work forks a draft in it", async () => {
  Object.assign(state.agent, {
    provider: "claude",
    currentModeId: "bypassPermissions",
    fullAutoAccept: true,
  });
  mount({ kind: "workspace", workspaceId: "ws" });
  await pick("codex");
  expect(text("provider-switch-from-permission")).toBe("composer.picker.modeLabels.fullAutoAccept");
  expect(checked(FULL_AUTO_ACCEPT_MODE_ID)).toBe("true");
  expect(text("provider-switch-history")).toBe("composer.providerSwitch.workHistory");
  await press("provider-switch-confirm");
  expect(state.fork).toHaveBeenCalledWith(
    expect.objectContaining({
      target: "tab",
      workspaceId: "ws",
      launch: { provider: "codex", model: "codex-model", modeId: FULL_AUTO_ACCEPT_MODE_ID },
    }),
  );
  expect(state.forkChatSession).not.toHaveBeenCalled();
});

test("strict Always ask → Codex has no equivalent: nothing preselected until the person picks", async () => {
  Object.assign(state.agent, { provider: "claude", currentModeId: "default" });
  mount();
  await pick("codex");
  const confirm = screen.getByTestId("provider-switch-confirm") as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  for (const radio of screen.getAllByRole("radio"))
    expect(radio.getAttribute("aria-checked")).toBe("false");
  expect(text("provider-switch-to-permission")).toBe("composer.providerSwitch.chooseBelow");
  expect(text("provider-switch-reason")).toContain("reasons.noEquivalent");
  await press("provider-switch-permission-auto");
  expect(confirm.disabled).toBe(false);
  expect(text("provider-switch-to-permission")).toBe("composer.picker.modeLabels.codexDefault");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledWith(
    expect.objectContaining({
      launch: { provider: "codex", model: "codex-model", modeId: "auto" },
    }),
  );
});

test("plan → a provider without plan asks for a choice", async () => {
  Object.assign(state.agent, { provider: "claude", currentModeId: "plan" });
  mount();
  await pick("omp");
  expect(text("provider-switch-reason")).toContain("reasons.planUnavailable");
  expect((screen.getByTestId("provider-switch-confirm") as HTMLButtonElement).disabled).toBe(true);
});

test("an unknown custom mode is chosen explicitly and reaches the launch as its own id", async () => {
  Object.assign(state.agent, { provider: "claude", currentModeId: "plan" });
  mount();
  await pick("acme-acp", "acme-model");
  expect(checked("foo#plan")).toBe("false");
  await press("provider-switch-permission-foo#plan");
  expect(text("provider-switch-to-permission")).toBe("Plan-ish");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledWith(
    expect.objectContaining({
      launch: { provider: "acme-acp", model: "acme-model", modeId: "foo#plan" },
    }),
  );
});

test("a provider without modes offers only its default, chosen explicitly, and launches without a mode", async () => {
  mount();
  await pick("pi");
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  await press("provider-switch-permission-provider-default");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledWith(
    expect.objectContaining({ launch: { provider: "pi", model: "pi-model" } }),
  );
});

test("a session with no reported mode shows that and asks for a choice", async () => {
  Object.assign(state.agent, { currentModeId: null });
  mount();
  await pick("claude");
  expect(text("provider-switch-from-permission")).toBe("composer.providerSwitch.unknownMode");
  expect(text("provider-switch-reason")).toContain("reasons.noSourceMode");
});

test("Cancel, the close button and a dismissed sheet change nothing and send nothing", async () => {
  mount();
  for (const how of ["provider-switch-cancel", "sheet-close", "sheet-dismiss"]) {
    await pick("claude");
    expect(screen.getByTestId("provider-switch-review")).toBeTruthy();
    await press(how);
    expect(screen.queryByTestId("provider-switch-review")).toBeNull();
  }
  expect(state.forkChatSession).not.toHaveBeenCalled();
  expect(state.fork).not.toHaveBeenCalled();
});

test("a second pick while the review is open neither stacks a review nor forks twice", async () => {
  mount();
  await pick("claude");
  await pick("copilot");
  expect(screen.getAllByTestId("provider-switch-review")).toHaveLength(1);
  expect(text("provider-switch-to")).toBe("Claude · Claude Model");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledTimes(1);
});

test("a Host without the feature says so before any review", async () => {
  state.features.chatProviderFork = false;
  mount();
  await pick("claude");
  expect(state.toastError).toHaveBeenCalledWith("composer.providerSwitch.hostNeedsUpdate");
  expect(screen.queryByTestId("provider-switch-review")).toBeNull();
});

test("a Host without Full auto-accept never offers it", async () => {
  state.features.fullAutoAccept = false;
  mount();
  await pick("claude");
  expect(screen.queryByTestId(`provider-switch-permission-${FULL_AUTO_ACCEPT_MODE_ID}`)).toBeNull();
});

test("a refused fork is shown and can be retried", async () => {
  state.forkChatSession.mockResolvedValueOnce({ error: "Bot is running" });
  mount();
  await pick("claude");
  await press("provider-switch-confirm");
  await vi.waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Bot is running"));
  await pick("claude");
  await press("provider-switch-confirm");
  expect(state.forkChatSession).toHaveBeenCalledTimes(2);
});

test("a group chat or no target offers no switch", () => {
  mount({ kind: "unavailable" });
  expect(pickFn).toBeNull();
});

test("the session's own provider stays first and unchanged; others read as a new session", () => {
  const own = [
    { id: "claude", label: "Claude", modelSelection: { kind: "models" as const, rows: [] } },
  ];
  const all = [
    { id: "codex", label: "Codex", modelSelection: { kind: "models" as const, rows: [] } },
    { id: "claude", label: "Claude", modelSelection: { kind: "models" as const, rows: [] } },
  ];
  const result = withSwitchProviders(own, all, "claude", "new session");
  expect(result.map((provider) => [provider.id, provider.label])).toEqual([
    ["claude", "Claude"],
    ["codex", "Codex · new session"],
  ]);
});
