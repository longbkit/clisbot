/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import type { BotPayload } from "../data/contracts";
import { toCreateRequest, toUpdateRequest } from "./bot-form-model";
import { useBotForm, type BotCreateFormProps } from "./use-bot-form";

const inputs = vi.hoisted(() => ({ preferences: {} as FormPreferences, create: vi.fn() }));
vi.mock("@/hooks/use-form-preferences", () => ({
  useFormPreferences: () => ({ preferences: inputs.preferences }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ createBot: inputs.create }),
    getSnapshot: () => ({ connectionStatus: "online" }),
  }),
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
vi.mock("./use-bot-provider-snapshot", () => ({ useBotProviderSnapshot: () => ({}) }));

const ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    status: "ready",
    enabled: true,
    models: [
      { provider: "mock", id: "default-model", label: "Default model", isDefault: true },
      {
        provider: "mock",
        id: "saved-model",
        label: "Saved model",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      },
    ],
    modes: [
      { id: "ask", label: "Ask" },
      { id: "full", label: "Full access" },
    ],
    defaultModeId: "ask",
  },
];
const SAVED: FormPreferences = {
  provider: "mock",
  providerPreferences: {
    mock: { model: "saved-model", mode: "full", thinkingByModel: { "saved-model": "high" } },
    codex: { model: "another-model", mode: "other-mode" },
  },
};
const PROPS: BotCreateFormProps = {
  name: "Assistant",
  hosts: [{ serverId: "host-a", label: "Host A" }],
  onCreated: () => {},
  onCancel: () => {},
};
beforeEach(() => {
  inputs.preferences = {};
});
afterEach(cleanup);

describe("useBotForm saved defaults", () => {
  it("seeds cached defaults for the saved provider and includes them in creation", () => {
    inputs.preferences = SAVED;
    const { result } = renderHook(() => useBotForm(PROPS));
    act(() => result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES }));
    expect(toCreateRequest(result.current.state)).toMatchObject({
      name: "Assistant",
      serverId: "host-a",
      kind: "personal",
      launch: { provider: "mock", model: "saved-model", modeId: "full", thinkingOptionId: "high" },
    });
  });

  it("applies asynchronously hydrated defaults without reconstructing the user's draft", () => {
    const { result, rerender } = renderHook(() => useBotForm(PROPS));
    const model = result.current.model;
    act(() => {
      model.applyProviderSnapshot("host-a", { entries: ENTRIES });
      model.setName("My assistant");
      model.setKind("team");
    });
    expect(result.current.state.selectedProvider).toBeNull();
    inputs.preferences = SAVED;
    rerender();
    expect(result.current.model).toBe(model);
    expect(result.current.state).toMatchObject({
      name: "My assistant",
      kind: "team",
      selectedProvider: "mock",
      selectedModel: "saved-model",
      selectedMode: "full",
      selectedThinkingOptionId: "high",
      canSubmit: true,
    });
  });

  it("preserves explicit model, permission and thinking choices when defaults hydrate late", () => {
    const { result, rerender } = renderHook(() => useBotForm(PROPS));
    act(() => {
      result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES });
      result.current.model.setModel("mock", "saved-model");
      result.current.model.setMode("ask");
      result.current.model.setThinkingOption("low");
    });
    inputs.preferences = {
      provider: "codex",
      providerPreferences: { mock: { model: "default-model", mode: "full" } },
    };
    rerender();
    expect(result.current.state).toMatchObject({
      selectedProvider: "mock",
      selectedModel: "saved-model",
      selectedMode: "ask",
      selectedThinkingOptionId: "low",
    });
  });

  it("updates untouched defaults while keeping an explicitly changed permission", () => {
    inputs.preferences = { provider: "mock" };
    const { result, rerender } = renderHook(() => useBotForm(PROPS));
    act(() => {
      result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES });
      result.current.model.setMode("ask");
    });
    expect(result.current.state.selectedModel).toBe("default-model");
    inputs.preferences = SAVED;
    rerender();
    expect(result.current.state).toMatchObject({
      selectedModel: "saved-model",
      selectedMode: "ask",
      selectedThinkingOptionId: "high",
    });
  });

  it("keeps an explicitly applied profile when saved defaults hydrate", () => {
    const { result, rerender } = renderHook(() => useBotForm(PROPS));
    act(() => {
      result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES });
      result.current.model.applyProfile({
        id: "profile",
        name: "My profile",
        provider: "mock",
        model: "saved-model",
        modeId: "ask",
        thinkingOptionId: "low",
        featureValues: { fast_mode: true },
      });
    });
    inputs.preferences = SAVED;
    rerender();
    expect(toCreateRequest(result.current.state).launch).toEqual({
      provider: "mock",
      model: "saved-model",
      modeId: "ask",
      thinkingOptionId: "low",
      featureValues: { fast_mode: true },
    });
  });

  it("never applies cached or late creation defaults to an existing bot", () => {
    const bot: BotPayload = {
      id: "bot-a",
      slug: "assistant",
      name: "Existing bot",
      projectId: "project-a",
      workspaceId: "workspace-a",
      cwd: "/bots/assistant",
      kind: "team",
      launchDefaults: {
        provider: "mock",
        model: "saved-model",
        modeId: "ask",
        thinkingOptionId: "low",
        featureValues: { fast_mode: false },
      },
    };
    inputs.preferences = SAVED;
    const { result, rerender } = renderHook(() =>
      useBotForm({ ...PROPS, defaultServerId: "host-a", bot }),
    );
    act(() => result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES }));
    inputs.preferences = { provider: "codex" };
    rerender();
    expect(toUpdateRequest(result.current.state, bot.id)).toEqual({
      serverId: "host-a",
      botId: bot.id,
      name: "Existing bot",
      launch: bot.launchDefaults,
    });
  });
});

it("does not navigate from a dismissed bot creation after its request succeeds", async () => {
  let finish!: (value: unknown) => void;
  inputs.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  inputs.preferences = SAVED;
  const onCreated = vi.fn();
  const { result, unmount } = renderHook(() => useBotForm({ ...PROPS, onCreated }));
  act(() => result.current.model.applyProviderSnapshot("host-a", { entries: ENTRIES }));
  act(() => result.current.submitAction());
  expect(inputs.create).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    finish({ bot: { id: "created" } });
  });
  expect(onCreated).not.toHaveBeenCalled();
});
