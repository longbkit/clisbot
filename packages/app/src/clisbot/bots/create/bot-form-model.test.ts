import type { AgentModelDefinition, ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { describe, expect, it } from "vitest";
import type { BotPayload } from "../data/contracts";
import {
  openBotForm,
  previewBotSlug,
  toCreateRequest,
  toUpdateRequest,
  type BotFormSnapshot,
} from "./bot-form-model";

const HOSTS = [
  { serverId: "host-a", label: "Host A" },
  { serverId: "host-b", label: "Host B" },
] as const;

const MODELS: AgentModelDefinition[] = [
  { provider: "mock", id: "model-a", label: "Model A", isDefault: true },
  {
    provider: "mock",
    id: "model-t",
    label: "Model T",
    defaultThinkingOptionId: "high",
    thinkingOptions: [
      { id: "low", label: "Low" },
      { id: "high", label: "High", isDefault: true },
    ],
  },
];

const ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "mock",
    status: "ready",
    enabled: true,
    label: "Mock",
    models: MODELS,
    modes: [{ id: "build", label: "Build" }],
    defaultModeId: "build",
  },
];

const BOT: BotPayload & { serverId: string } = {
  id: "bot-1",
  serverId: "host-b",
  slug: "research-bot",
  name: "Research bot",
  projectId: "p1",
  workspaceId: "w1",
  cwd: "/bots/research-bot",
  kind: "team",
  launchDefaults: { provider: "mock", model: "model-t", modeId: "build", thinkingOptionId: "low" },
};

function createSnapshot(overrides: Partial<BotFormSnapshot> = {}): BotFormSnapshot {
  return { mode: "create", hosts: [HOSTS[0]], defaults: { name: "Ops Bot!" }, ...overrides };
}

describe("previewBotSlug", () => {
  it("derives the directory name the daemon will use", () => {
    expect(previewBotSlug("Ops Bot!")).toBe("ops-bot");
    expect(previewBotSlug("!!!")).toBe("bot");
  });
});

describe("openBotForm", () => {
  it("is fresh per open", () => {
    const first = openBotForm(createSnapshot());
    const second = openBotForm(createSnapshot());
    first.setName("Changed");
    expect(second.getState().name).toBe("Ops Bot!");
    expect(first.getState().slugPreview).toBe("changed");
  });

  it("selects the only host and hides the host field", () => {
    const state = openBotForm(createSnapshot()).getState();
    expect(state.selectedServerId).toBe("host-a");
    expect(state.selectedHostDisplay).toEqual({ label: "Host A" });
    expect(state.showHostField).toBe(false);
    expect(state.providerSnapshotRequest).toEqual({ serverId: "host-a" });
    expect(state.canSubmit).toBe(false);
  });

  it("shows the host field with several hosts and selects none", () => {
    const model = openBotForm(createSnapshot({ hosts: HOSTS }));
    expect(model.getState().showHostField).toBe(true);
    expect(model.getState().selectedServerId).toBeNull();
    expect(model.getState().providerSnapshotRequest).toBeNull();
    model.setHost("host-b", { label: "Second" });
    expect(model.getState().selectedHostDisplay).toEqual({ label: "Second" });
    expect(model.getState().providerSnapshotRequest).toEqual({ serverId: "host-b" });
  });

  it("starts on the first ready provider when nothing chose one (README D11)", () => {
    const model = openBotForm(createSnapshot());
    expect(model.getState().selectedProvider).toBeNull();
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    expect(model.getState()).toMatchObject({
      selectedProvider: "mock",
      selectedModel: "model-a",
      selectedMode: "build",
      canSubmit: true,
    });
  });

  it("replaces a remembered provider the Host does not have", () => {
    const model = openBotForm(
      createSnapshot({ defaults: { name: "Ops", preferences: { provider: "grok" } } }),
    );
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    expect(model.getState().selectedProvider).toBe("mock");
  });

  it("lets saved preferences that arrive late replace the stand-in provider", () => {
    const other = {
      ...ENTRIES[0]!,
      provider: "other",
      label: "Other",
      models: [{ provider: "other", id: "other-a", label: "Other A", isDefault: true }],
    };
    const model = openBotForm(createSnapshot());
    model.applyProviderSnapshot("host-a", { entries: [...ENTRIES, other] });
    expect(model.getState().selectedProvider).toBe("mock");
    model.applyPreferences({ provider: "other" });
    expect(model.getState().selectedProvider).toBe("other");
  });

  it("starts over on a new Host: a choice made for the old one does not block the stand-in", () => {
    const model = openBotForm(createSnapshot({ hosts: HOSTS, defaults: { serverId: "host-a" } }));
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    model.setProvider("mock");
    expect(model.isProviderChosen()).toBe(true);
    model.setHost("host-b");
    model.applyProviderSnapshot("host-b", { entries: ENTRIES });
    expect(model.getState().selectedProvider).toBe("mock");
    expect(model.isProviderChosen()).toBe(false);
  });

  it("counts a saved provider as chosen, and the stand-in as not", () => {
    const saved = openBotForm(createSnapshot({ defaults: { preferences: { provider: "mock" } } }));
    saved.applyProviderSnapshot("host-a", { entries: ENTRIES });
    expect(saved.isProviderChosen()).toBe(true);
    const standIn = openBotForm(createSnapshot());
    standIn.applyProviderSnapshot("host-a", { entries: ENTRIES });
    expect(standIn.getState().selectedProvider).toBe("mock");
    expect(standIn.isProviderChosen()).toBe(false);
  });

  it("does not replace a provider the user chose", () => {
    const model = openBotForm(createSnapshot());
    model.setProvider("grok");
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    expect(model.getState().selectedProvider).toBe("grok");
  });

  it("applies a provider snapshot only for the selected host and resolves the preferred defaults", () => {
    const model = openBotForm(
      createSnapshot({
        hosts: HOSTS,
        defaults: { serverId: "host-a", preferences: { provider: "mock" } },
      }),
    );
    model.applyProviderSnapshot("host-b", { entries: ENTRIES });
    expect(model.getState().selectedProvider).toBeNull();
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    const state = model.getState();
    expect(state.selectedProvider).toBe("mock");
    expect(state.selectedModel).toBe("model-a");
    expect(state.selectedModelDisplay).toEqual({ label: "Model A" });
    expect(state.selectedMode).toBe("build");
    expect(state.modeOptions).toHaveLength(1);
    expect(state.modelSelectorProviders.map((provider) => provider.id)).toEqual(["mock"]);
    expect(state.providerResolutionByServerId).toEqual({ "host-a": "complete" });
    expect(state.providerSnapshotRequest).toBeNull();
    expect(state.canSubmit).toBe(false);
    model.setName("Ops");
    expect(model.getState().canSubmit).toBe(true);
  });

  it("clears the provider selection when the host changes", () => {
    const model = openBotForm(createSnapshot({ hosts: HOSTS, defaults: { serverId: "host-a" } }));
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    model.setHost("host-b");
    const state = model.getState();
    expect(state.selectedProvider).toBeNull();
    expect(state.modelSelectorProviders).toEqual([]);
    expect(state.providerResolutionByServerId).toEqual({ "host-b": "pending" });
    expect(state.canSubmit).toBe(false);
  });

  it("picks the model's default thinking option and keeps an explicit one", () => {
    const model = openBotForm(createSnapshot());
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    model.setModel("mock", "model-t");
    expect(model.getState().selectedThinkingOptionId).toBe("high");
    expect(model.getState().selectedThinkingDisplay?.label).toBe("High");
    model.setThinkingOption("low");
    model.setModel("mock", "model-t");
    expect(model.getState().selectedThinkingOptionId).toBe("low");
    model.setModel("mock", "model-a");
    expect(model.getState().selectedThinkingOptionId).toBe("");
    expect(model.getState().availableThinkingOptions).toEqual([]);
  });

  it("builds the create request from the resolved state", () => {
    const model = openBotForm(createSnapshot());
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    model.setProvider("mock");
    model.setTemplate("team");
    model.setFeature("fast", true);
    expect(toCreateRequest(model.getState())).toEqual({
      serverId: "host-a",
      name: "Ops Bot!",
      kind: "team",
      launch: {
        provider: "mock",
        model: "model-a",
        modeId: "build",
        thinkingOptionId: undefined,
        featureValues: { fast: true },
      },
    });
  });

  it("starts a new bot with Personal, which seeds its empty folder", () => {
    const model = openBotForm(createSnapshot());
    model.applyProviderSnapshot("host-a", { entries: ENTRIES });
    model.setProvider("mock");
    expect(model.getState().template.choice).toBe("personal");
    expect(toCreateRequest(model.getState())).not.toHaveProperty("template");
    model.setTemplate("none");
    expect(toCreateRequest(model.getState()).template).toEqual({ seed: false });
  });

  it("starts a bot from a Project with no template, which writes no files", () => {
    const project = { serverId: "host-b", projectId: "p9", name: "Repo", path: "/code/repo" };
    const model = openBotForm(createSnapshot({ hosts: HOSTS, defaults: { project } }));
    model.applyProviderSnapshot("host-b", { entries: ENTRIES });
    model.setProvider("mock");
    expect(model.getState().template.choice).toBe("none");
    expect(toCreateRequest(model.getState()).template).toEqual({ seed: false });
  });

  it("makes a bot from a Project on its Host and replaces only the files picked", () => {
    const project = { serverId: "host-b", projectId: "p9", name: "Repo", path: "/code/repo" };
    const model = openBotForm(createSnapshot({ hosts: HOSTS, defaults: { project } }));
    expect(model.getState()).toMatchObject({ selectedServerId: "host-b", showHostField: false });
    model.applyProviderSnapshot("host-b", { entries: ENTRIES });
    model.setProvider("mock");
    model.setTemplate("personal");
    model.applyTemplatePreview([
      { name: "AGENTS.md", exists: true },
      { name: "SOUL.md", exists: true },
      { name: "USER.md", exists: false },
    ]);
    const keep = toCreateRequest(model.getState());
    expect(keep).toMatchObject({ path: "/code/repo", kind: "personal" });
    expect(keep).not.toHaveProperty("template");
    model.setConflictPolicy("choose");
    model.toggleReplace("AGENTS.md");
    expect(toCreateRequest(model.getState()).template).toEqual({ overwrite: ["AGENTS.md"] });
    // Use template replaces the files the preview listed, by name, never a blanket `true`.
    model.setConflictPolicy("replace");
    expect(toCreateRequest(model.getState()).template).toEqual({
      overwrite: ["AGENTS.md", "SOUL.md"],
    });
  });

  it("sends the role on create only when written, and keeps or clears it on save", () => {
    const create = openBotForm(createSnapshot());
    create.applyProviderSnapshot("host-a", { entries: ENTRIES });
    create.setProvider("mock");
    expect(toCreateRequest(create.getState())).not.toHaveProperty("description");
    create.setDescription("  Owns the numbers  ");
    expect(toCreateRequest(create.getState()).description).toBe("Owns the numbers");
    const edit = openBotForm({
      mode: "edit",
      bot: { ...BOT, description: "Owns research" },
      hosts: HOSTS,
      defaults: {},
    });
    expect(edit.getState().description).toBe("Owns research");
    expect(toUpdateRequest(edit.getState(), BOT.id).description).toBe("Owns research");
    edit.setDescription(" ");
    expect(toUpdateRequest(edit.getState(), BOT.id).description).toBeNull();
  });

  it("applies a profile as one copy", () => {
    const model = openBotForm(createSnapshot());
    model.applyProfile({
      id: "profile",
      name: "Fast",
      provider: "mock",
      model: "model-t",
      modeId: "build",
      thinkingOptionId: "low",
      featureValues: { fast: true },
    });
    const state = model.getState();
    expect(state.selectedProvider).toBe("mock");
    expect(state.selectedModel).toBe("model-t");
    expect(state.featureValues).toEqual({ fast: true });
    expect(state.canSubmit).toBe(true);
  });

  it("seeds edit mode from the record and keeps its slug", () => {
    const model = openBotForm({ mode: "edit", bot: BOT, hosts: HOSTS, defaults: {} });
    const seeded = model.getState();
    expect(seeded.name).toBe("Research bot");
    expect(seeded.kind).toBe("team");
    expect(seeded.selectedServerId).toBe("host-b");
    expect(seeded.selectedHostDisplay).toEqual({ label: "Host B" });
    expect(seeded.selectedModelDisplay).toEqual({ label: "model-t" });
    expect(seeded.selectedThinkingDisplay?.label).toBe("Low");
    expect(seeded.canSubmit).toBe(true);
    model.setName("Renamed");
    expect(model.getState().slugPreview).toBe("research-bot");
    model.applyProviderSnapshot("host-b", { entries: ENTRIES });
    const resolved = model.getState();
    expect(resolved.selectedModel).toBe("model-t");
    expect(resolved.selectedModelDisplay).toEqual({ label: "Model T" });
    expect(resolved.selectedThinkingOptionId).toBe("low");
    expect(toUpdateRequest(resolved, BOT.id)).toMatchObject({
      serverId: "host-b",
      botId: "bot-1",
      name: "Renamed",
      launch: { provider: "mock", model: "model-t", thinkingOptionId: "low" },
    });
  });

  it("ignores preferences in edit mode and stops publishing once closed", () => {
    const model = openBotForm({ mode: "edit", bot: BOT, hosts: HOSTS, defaults: {} });
    const seen: string[] = [];
    const unsubscribe = model.subscribe(() => seen.push(model.getState().name));
    model.applyPreferences({ provider: "other" });
    model.setName("A");
    model.close();
    model.setName("B");
    unsubscribe();
    expect(seen).toEqual(["A"]);
    expect(model.getState().name).toBe("A");
  });
});

it("keeps the remaining Host selectable when hosts change before a selection", () => {
  const model = openBotForm(createSnapshot({ hosts: HOSTS }));
  model.applyHosts([HOSTS[1]]);
  expect(model.getState().selectedServerId).toBeNull();
  expect(model.getState().showHostField).toBe(true);
  model.setHost("host-b");
  expect(model.getState().showHostField).toBe(false);
  model.applyHosts([HOSTS[0]]);
  expect(model.getState().showHostField).toBe(true);
});
