// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  useProviderSwitch,
  withSwitchProviders,
  type ProviderSwitchTarget,
} from "./provider-switch";

const state = vi.hoisted(() => ({
  features: { chatProviderFork: true, agentForkContext: true } as Record<string, boolean>,
  confirm: vi.fn(async (_input: Record<string, unknown>) => true),
  fork: vi.fn(async (_request: unknown) => undefined),
  forkChatSession: vi.fn(async (_params: unknown) => ({ error: null as string | null })),
  toastError: vi.fn(),
  agent: {
    provider: "claude",
    cwd: "/bot",
    workspaceId: "ws",
    labels: { "clisbot.bot-id": "bot-a", "clisbot.chat-id": "chat-a" },
  },
}));
const agent = state.agent;
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: state.toastError }) }));
vi.mock("@/hooks/use-fork-agent", () => ({ useForkAgent: () => state.fork }));
vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_server: string, name: string) => state.features[name] === true,
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: state.confirm }));
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

function mount(target: ProviderSwitchTarget | undefined) {
  return renderHook(() =>
    useProviderSwitch({
      serverId: "host",
      agentId: "agent-1",
      target,
      providerLabel: (id) => id.toUpperCase(),
    }),
  );
}

async function pick(switchProvider: ((p: string, m: string) => void) | null) {
  await act(async () => {
    switchProvider?.("codex", "gpt-5");
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.features = { chatProviderFork: true, agentForkContext: true };
  state.confirm.mockResolvedValue(true);
  state.forkChatSession.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("a direct chat forks on the Host once, with the session the person saw", async () => {
  const hook = mount({ kind: "chat", chatId: "chat-a" });
  await pick(hook.result.current);
  await vi.waitFor(() => expect(state.forkChatSession).toHaveBeenCalledTimes(1));
  expect(state.confirm.mock.calls[0]?.[0]).toMatchObject({
    title: "composer.providerSwitch.title",
    message: "composer.providerSwitch.chatMessage",
    confirmLabel: "composer.providerSwitch.confirm",
  });
  expect(state.forkChatSession).toHaveBeenCalledWith({
    chatId: "chat-a",
    botId: "bot-a",
    launch: { provider: "codex", model: "gpt-5" },
    expectedAgentId: "agent-1",
  });
  expect(state.fork).not.toHaveBeenCalled();
});

test("Cancel changes nothing and sends nothing", async () => {
  state.confirm.mockResolvedValue(false);
  const hook = mount({ kind: "chat", chatId: "chat-a" });
  await pick(hook.result.current);
  await vi.waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1));
  expect(state.forkChatSession).not.toHaveBeenCalled();
  expect(state.fork).not.toHaveBeenCalled();
});

test("a second pick while the dialog is open forks once", async () => {
  let accept!: (value: boolean) => void;
  state.confirm.mockImplementation(() => new Promise<boolean>((yes) => (accept = yes)));
  const hook = mount({ kind: "chat", chatId: "chat-a" });
  await pick(hook.result.current);
  await pick(hook.result.current);
  await act(async () => accept(true));
  await vi.waitFor(() => expect(state.forkChatSession).toHaveBeenCalledTimes(1));
  expect(state.confirm).toHaveBeenCalledTimes(1);
});

test("a Host without the feature says so instead of ignoring the pick", async () => {
  state.features.chatProviderFork = false;
  const hook = mount({ kind: "chat", chatId: "chat-a" });
  await pick(hook.result.current);
  expect(state.toastError).toHaveBeenCalledWith("composer.providerSwitch.hostNeedsUpdate");
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.forkChatSession).not.toHaveBeenCalled();
});

test("a refused fork is shown; the selection stays as it was", async () => {
  state.forkChatSession.mockResolvedValue({ error: "Bot is running" });
  const hook = mount({ kind: "chat", chatId: "chat-a" });
  await pick(hook.result.current);
  await vi.waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Bot is running"));
});

test("a Work session forks into a draft tab on the new provider", async () => {
  const hook = mount({ kind: "workspace", workspaceId: "ws" });
  await pick(hook.result.current);
  await vi.waitFor(() => expect(state.fork).toHaveBeenCalledTimes(1));
  expect(state.fork).toHaveBeenCalledWith({
    agentId: "agent-1",
    agent,
    workspaceId: "ws",
    target: "tab",
    launch: { provider: "codex", model: "gpt-5" },
  });
  expect(state.confirm.mock.calls[0]?.[0]).toMatchObject({
    message: "composer.providerSwitch.workMessage",
  });
  expect(state.forkChatSession).not.toHaveBeenCalled();
});

test("a group chat or no target offers no switch", () => {
  expect(mount({ kind: "unavailable" }).result.current).toBeNull();
  expect(mount(undefined).result.current).toBeNull();
});

test("the session's own provider stays first and unchanged; others read as a new session", () => {
  const own = [{ id: "claude", label: "Claude", modelSelection: { kind: "models", rows: [] } }];
  const all = [
    { id: "codex", label: "Codex", modelSelection: { kind: "models", rows: [] } },
    { id: "claude", label: "Claude", modelSelection: { kind: "models", rows: [] } },
  ];
  // @ts-expect-error minimal rows for the ordering under test
  const result = withSwitchProviders(own, all, "claude", "new session");
  expect(result.map((provider) => [provider.id, provider.label])).toEqual([
    ["claude", "Claude"],
    ["codex", "Codex · new session"],
  ]);
});
