import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import { slugify } from "@getpaseo/protocol/branch-slug";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  buildProviderDefinitionMapForStatuses,
  INITIAL_USER_MODIFIED,
  RESOLVABLE_PROVIDER_STATUSES,
  resolveDefaultModelId,
  resolveFormStateFromProviderModels,
  resolveThinkingOptionId,
  type FormInitialValues,
  type FormState,
  type ProviderModelsByProvider,
  type UserModifiedFields,
} from "@/provider-selection/resolve-agent-form";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { botsCopy } from "../copy";
import type { BotKind, BotLaunchDefaults, BotPayload } from "../data/contracts";

/**
 * The bot create/edit form model (docs/forms.md; shape of `schedules/schedule-form-model.ts`).
 * Zero React. Provider, model, mode and thinking resolve through the same helpers the
 * schedule form uses, so a bot's launch defaults behave like every other agent form.
 */
export interface BotFormDisplay {
  label: string;
}

export interface BotFormHost {
  serverId: string;
  label: string;
}

export interface BotFormSnapshot {
  mode: "create" | "edit";
  bot?: BotPayload & { serverId?: string };
  hosts: readonly BotFormHost[];
  defaults: {
    serverId?: string | null;
    name?: string;
    preferences?: FormPreferences;
  };
}

export interface BotFormProviderSnapshot {
  entries: ProviderSnapshotEntry[];
}

type ProviderResolutionStatus = "idle" | "pending" | "complete";
type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

export interface BotFormState {
  mode: "create" | "edit";
  name: string;
  /** The directory name the daemon will derive (README D3); the record's slug in edit mode. */
  slugPreview: string;
  kind: BotKind;
  hosts: BotFormHost[];
  selectedServerId: string | null;
  selectedHostDisplay: BotFormDisplay | null;
  showHostField: boolean;
  selectedProvider: AgentProvider | null;
  selectedModel: string;
  selectedMode: string;
  selectedThinkingOptionId: string;
  featureValues: Record<string, unknown>;
  selectedModelDisplay: BotFormDisplay | null;
  selectedModeDisplay: BotFormDisplay;
  selectedThinkingDisplay: BotFormDisplay | null;
  modelSelectorProviders: ProviderSelectorProvider[];
  modeOptions: AgentMode[];
  availableThinkingOptions: ThinkingOption[];
  providerResolutionByServerId: Record<string, ProviderResolutionStatus>;
  /** The host whose provider snapshot the adapter should fetch next; null when nothing is owed. */
  providerSnapshotRequest: { serverId: string } | null;
  canSubmit: boolean;
  submitError: string | null;
}

export interface BotCreateRequest {
  serverId: string;
  name: string;
  kind: BotKind;
  launch: BotLaunchDefaults;
}

export interface BotUpdateRequest {
  serverId: string;
  botId: string;
  name: string;
  launch: BotLaunchDefaults;
}

export interface BotFormModel {
  getState: () => BotFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  applyHosts: (hosts: readonly BotFormHost[]) => void;
  applyPreferences: (preferences: FormPreferences | undefined) => void;
  applyProviderSnapshot: (serverId: string, snapshot: BotFormProviderSnapshot) => void;
  applyProfile: (profile: AgentProfile) => void;
  setName: (value: string) => void;
  setKind: (value: BotKind) => void;
  setHost: (serverId: string | null, display?: BotFormDisplay | null) => void;
  setProvider: (provider: AgentProvider) => void;
  setModel: (provider: AgentProvider, modelId: string) => void;
  setMode: (modeId: string) => void;
  setThinkingOption: (thinkingOptionId: string) => void;
  setFeature: (featureId: string, value: unknown) => void;
  setSubmitError: (value: string | null) => void;
}

const FALLBACK_SLUG = "bot";

export function previewBotSlug(name: string): string {
  return slugify(name) || FALLBACK_SLUG;
}

function resolveInitialServerId(snapshot: BotFormSnapshot): string | null {
  if (snapshot.mode === "edit") return snapshot.bot?.serverId ?? snapshot.defaults.serverId ?? null;
  if (snapshot.defaults.serverId !== undefined) return snapshot.defaults.serverId;
  return snapshot.hosts.length === 1 ? (snapshot.hosts[0]?.serverId ?? null) : null;
}

function hostDisplay(
  hosts: readonly BotFormHost[],
  serverId: string | null,
): BotFormDisplay | null {
  const host = hosts.find((entry) => entry.serverId === serverId);
  return host ? { label: host.label } : null;
}

function initialValuesOf(snapshot: BotFormSnapshot): FormInitialValues | undefined {
  const launch = snapshot.bot?.launchDefaults;
  if (!launch) return undefined;
  return {
    provider: launch.provider,
    model: launch.model ?? null,
    modeId: launch.modeId ?? null,
    thinkingOptionId: launch.thinkingOptionId ?? null,
  };
}

function entryFor(entries: readonly ProviderSnapshotEntry[], provider: AgentProvider | null) {
  return provider ? (entries.find((entry) => entry.provider === provider) ?? null) : null;
}

function modelsFor(entries: readonly ProviderSnapshotEntry[], provider: AgentProvider | null) {
  return filterSelectableModels(entryFor(entries, provider)?.models ?? null);
}

function effectiveModel(models: AgentModelDefinition[] | null, modelId: string) {
  const id = modelId.trim();
  if (!models || !id) return null;
  return models.find((model) => model.id === id) ?? models.find((model) => model.isDefault) ?? null;
}

function modelDisplay(
  models: AgentModelDefinition[] | null,
  modelId: string,
): BotFormDisplay | null {
  const id = modelId.trim();
  if (!id) return null;
  return { label: effectiveModel(models, id)?.label ?? id };
}

function modeDisplay(modes: readonly AgentMode[], modeId: string): BotFormDisplay {
  const id = modeId.trim();
  if (!id) return { label: botsCopy.form.defaultMode };
  return { label: modes.find((mode) => mode.id === id)?.label ?? id };
}

function thinkingDisplay(options: readonly ThinkingOption[], id: string): BotFormDisplay | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const option = options.find((entry) => entry.id === trimmed) ?? { id: trimmed };
  return { label: formatThinkingOptionLabel(option) };
}

function toFormState(state: BotFormState): FormState {
  return {
    provider: state.selectedProvider,
    modeId: state.selectedMode,
    model: state.selectedModel,
    thinkingOptionId: state.selectedThinkingOptionId,
  };
}

function providerModelsByProvider(entries: ProviderSnapshotEntry[]): ProviderModelsByProvider {
  const map: ProviderModelsByProvider = new Map();
  for (const entry of entries)
    map.set(entry.provider, filterSelectableModels(entry.models ?? null));
  return map;
}

function resolveSelection(input: {
  state: BotFormState;
  initialValues: FormInitialValues | undefined;
  preferences: FormPreferences | null;
  entries: ProviderSnapshotEntry[];
  userModified: UserModifiedFields;
}): BotFormState {
  const allowed = buildProviderDefinitionMapForStatuses({
    snapshotEntries: input.entries,
    providerDefinitions: buildProviderDefinitions(input.entries),
    statuses: RESOLVABLE_PROVIDER_STATUSES,
  });
  const resolved = resolveFormStateFromProviderModels(
    input.initialValues,
    input.preferences,
    providerModelsByProvider(input.entries),
    input.userModified,
    toFormState(input.state),
    allowed,
  );
  // An empty model after resolution means "the provider's default"; name it, as `setProvider` does.
  const selectedModel =
    resolved.provider && !resolved.model
      ? resolveDefaultModelId(modelsFor(input.entries, resolved.provider))
      : resolved.model;
  return {
    ...input.state,
    selectedProvider: resolved.provider,
    selectedMode: resolved.modeId,
    selectedModel,
    selectedThinkingOptionId: resolved.thinkingOptionId,
  };
}

function updateDerivedState(input: {
  state: BotFormState;
  hosts: readonly BotFormHost[];
  entries: readonly ProviderSnapshotEntry[];
  slug: string | null;
}): BotFormState {
  const { state } = input;
  const models = modelsFor(input.entries, state.selectedProvider);
  const modeOptions = entryFor(input.entries, state.selectedProvider)?.modes ?? [];
  const thinkingOptions = effectiveModel(models, state.selectedModel)?.thinkingOptions ?? [];
  const resolution = state.selectedServerId
    ? (state.providerResolutionByServerId[state.selectedServerId] ?? "idle")
    : "idle";
  return {
    ...state,
    slugPreview: input.slug ?? previewBotSlug(state.name),
    hosts: [...input.hosts],
    selectedHostDisplay:
      state.selectedHostDisplay ?? hostDisplay(input.hosts, state.selectedServerId),
    showHostField: input.hosts.length !== 1 || input.hosts[0]?.serverId !== state.selectedServerId,
    selectedModelDisplay: modelDisplay(models, state.selectedModel),
    selectedModeDisplay: modeDisplay(modeOptions, state.selectedMode),
    selectedThinkingDisplay: thinkingDisplay(thinkingOptions, state.selectedThinkingOptionId),
    modeOptions,
    availableThinkingOptions: thinkingOptions,
    providerSnapshotRequest:
      state.selectedServerId && resolution !== "complete"
        ? { serverId: state.selectedServerId }
        : null,
    canSubmit: Boolean(state.name.trim() && state.selectedServerId && state.selectedProvider),
  };
}

function buildInitialState(snapshot: BotFormSnapshot): BotFormState {
  const selectedServerId = resolveInitialServerId(snapshot);
  const launch = snapshot.bot?.launchDefaults;
  const model = launch?.model ?? "";
  const mode = launch?.modeId ?? "";
  const thinking = launch?.thinkingOptionId ?? "";
  return {
    mode: snapshot.mode,
    name: snapshot.bot?.name ?? snapshot.defaults.name ?? "",
    slugPreview: "",
    kind: snapshot.bot?.kind ?? "personal",
    hosts: [],
    selectedServerId,
    selectedHostDisplay: null,
    showHostField: false,
    selectedProvider: launch?.provider ?? null,
    selectedModel: model,
    selectedMode: mode,
    selectedThinkingOptionId: thinking,
    featureValues: { ...launch?.featureValues },
    selectedModelDisplay: model ? { label: model } : null,
    selectedModeDisplay: modeDisplay([], mode),
    selectedThinkingDisplay: thinkingDisplay([], thinking),
    modelSelectorProviders: [],
    modeOptions: [],
    availableThinkingOptions: [],
    providerResolutionByServerId: selectedServerId ? { [selectedServerId]: "pending" } : {},
    providerSnapshotRequest: null,
    canSubmit: false,
    submitError: null,
  };
}

function launchOf(state: BotFormState): BotLaunchDefaults {
  if (!state.selectedProvider) throw new Error("A provider is required");
  return {
    provider: state.selectedProvider,
    model: state.selectedModel.trim() || undefined,
    modeId: state.selectedMode.trim() || undefined,
    thinkingOptionId: state.selectedThinkingOptionId.trim() || undefined,
    featureValues: Object.keys(state.featureValues).length > 0 ? state.featureValues : undefined,
  };
}

export function toCreateRequest(state: BotFormState): BotCreateRequest {
  if (!state.selectedServerId) throw new Error("A Host is required");
  return {
    serverId: state.selectedServerId,
    name: state.name.trim(),
    kind: state.kind,
    launch: launchOf(state),
  };
}

export function toUpdateRequest(state: BotFormState, botId: string): BotUpdateRequest {
  if (!state.selectedServerId) throw new Error("A Host is required");
  return {
    serverId: state.selectedServerId,
    botId,
    name: state.name.trim(),
    launch: launchOf(state),
  };
}

export function openBotForm(snapshot: BotFormSnapshot): BotFormModel {
  const listeners = new Set<() => void>();
  const initialValues = initialValuesOf(snapshot);
  const editSlug = snapshot.mode === "edit" ? (snapshot.bot?.slug ?? null) : null;
  let closed = false;
  let hosts = snapshot.hosts;
  let preferences = snapshot.mode === "create" ? (snapshot.defaults.preferences ?? null) : null;
  let entries: ProviderSnapshotEntry[] = [];
  let userModified: UserModifiedFields = { ...INITIAL_USER_MODIFIED };
  let state = updateDerivedState({
    state: buildInitialState(snapshot),
    hosts,
    entries,
    slug: editSlug,
  });

  function publish(next: BotFormState): void {
    if (closed) return;
    state = updateDerivedState({ state: next, hosts, entries, slug: editSlug });
    for (const listener of listeners) listener();
  }

  function resolved(next: BotFormState): BotFormState {
    if (entries.length === 0) return next;
    return resolveSelection({ state: next, initialValues, preferences, entries, userModified });
  }

  function clearProviderSelection(next: BotFormState): BotFormState {
    entries = [];
    return {
      ...next,
      selectedProvider: null,
      selectedModel: "",
      selectedMode: "",
      selectedThinkingOptionId: "",
      modelSelectorProviders: [],
    };
  }

  function markUserModified(fields: Partial<UserModifiedFields>): void {
    userModified = { ...userModified, ...fields };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    applyHosts(nextHosts) {
      if (closed || hosts === nextHosts) return;
      hosts = nextHosts;
      publish(state);
    },
    applyPreferences(nextPreferences) {
      const normalized = snapshot.mode === "create" ? (nextPreferences ?? null) : null;
      if (closed || preferences === normalized) return;
      preferences = normalized;
      publish(resolved(state));
    },
    applyProviderSnapshot(serverId, providerSnapshot) {
      if (closed || state.selectedServerId !== serverId) return;
      entries = providerSnapshot.entries;
      publish({
        ...resolved(state),
        modelSelectorProviders: buildSelectableProviderSelectorProviders(entries),
        providerResolutionByServerId: {
          ...state.providerResolutionByServerId,
          [serverId]: "complete",
        },
      });
    },
    applyProfile(profile) {
      if (closed) return;
      markUserModified({ provider: true, model: true, modeId: true, thinkingOptionId: true });
      publish({
        ...state,
        selectedProvider: profile.provider,
        selectedModel: profile.model ?? "",
        selectedMode: profile.modeId ?? "",
        selectedThinkingOptionId: profile.thinkingOptionId ?? "",
        featureValues: { ...profile.featureValues },
      });
    },
    setName(value) {
      publish({ ...state, name: value });
    },
    setKind(value) {
      publish({ ...state, kind: value });
    },
    setHost(serverId, display) {
      if (closed || state.selectedServerId === serverId) return;
      publish(
        clearProviderSelection({
          ...state,
          selectedServerId: serverId,
          selectedHostDisplay: display ?? hostDisplay(hosts, serverId),
          providerResolutionByServerId: serverId ? { [serverId]: "pending" } : {},
        }),
      );
    },
    setProvider(provider) {
      if (closed) return;
      const entry = entryFor(entries, provider);
      const model = state.selectedProvider === provider ? state.selectedModel : "";
      markUserModified({ provider: true, model: true, modeId: true, thinkingOptionId: true });
      publish({
        ...state,
        selectedProvider: provider,
        selectedModel: model || resolveDefaultModelId(modelsFor(entries, provider)),
        selectedMode: entry?.defaultModeId ?? entry?.modes?.[0]?.id ?? "",
        selectedThinkingOptionId: "",
      });
    },
    setModel(provider, modelId) {
      if (closed) return;
      const models = modelsFor(entries, provider);
      const selectedModel = modelId.trim() || resolveDefaultModelId(models);
      const providerChanged = state.selectedProvider !== provider;
      const entry = entryFor(entries, provider);
      markUserModified({ provider: true, model: true, modeId: true, thinkingOptionId: true });
      publish({
        ...state,
        selectedProvider: provider,
        selectedModel,
        selectedMode: providerChanged
          ? (entry?.defaultModeId ?? entry?.modes?.[0]?.id ?? "")
          : state.selectedMode,
        selectedThinkingOptionId: resolveThinkingOptionId({
          availableModels: models,
          modelId: selectedModel,
          requestedThinkingOptionId: providerChanged ? "" : state.selectedThinkingOptionId,
        }),
      });
    },
    setMode(modeId) {
      if (closed) return;
      markUserModified({ modeId: true });
      publish({ ...state, selectedMode: modeId });
    },
    setThinkingOption(thinkingOptionId) {
      if (closed) return;
      markUserModified({ thinkingOptionId: true });
      publish({ ...state, selectedThinkingOptionId: thinkingOptionId });
    },
    setFeature(featureId, value) {
      publish({ ...state, featureValues: { ...state.featureValues, [featureId]: value } });
    },
    setSubmitError(value) {
      publish({ ...state, submitError: value });
    },
  };
}
