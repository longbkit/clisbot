import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@clisbot/protocol/agent-types";
import { slugify } from "@clisbot/protocol/branch-slug";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import {
  buildProviderDefinitionMapForStatuses,
  RESOLVABLE_PROVIDER_STATUSES,
  resolveDefaultModelId,
  resolveFormStateFromProviderModels,
  type FormInitialValues,
  type FormState,
  type ProviderModelsByProvider,
  type UserModifiedFields,
} from "@/provider-selection/resolve-agent-form";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { i18n } from "@/i18n/i18next";
import type { BotFormDisplay, BotFormHost, BotFormSnapshot, BotFormState } from "./bot-form-model";
import {
  awaitingTemplatePreview,
  initialTemplateState,
  type BotTemplateChoice,
} from "./bot-template-choice";

/**
 * Pure state derivation for the bot form model: the initial state, the provider/model/mode
 * selection resolved against a Host's provider snapshot, and the display fields derived from it.
 */
type ThinkingOption = BotFormState["availableThinkingOptions"][number];

const FALLBACK_SLUG = "bot";

export function previewBotSlug(name: string): string {
  return slugify(name) || FALLBACK_SLUG;
}

function resolveInitialServerId(snapshot: BotFormSnapshot): string | null {
  if (snapshot.mode === "edit") return snapshot.bot?.serverId ?? snapshot.defaults.serverId ?? null;
  if (snapshot.defaults.project) return snapshot.defaults.project.serverId;
  if (snapshot.defaults.serverId !== undefined) return snapshot.defaults.serverId;
  return snapshot.hosts.length === 1 ? (snapshot.hosts[0]?.serverId ?? null) : null;
}

export function hostDisplay(
  hosts: readonly BotFormHost[],
  serverId: string | null,
): BotFormDisplay | null {
  const host = hosts.find((entry) => entry.serverId === serverId);
  return host ? { label: host.label } : null;
}

export function initialValuesOf(snapshot: BotFormSnapshot): FormInitialValues | undefined {
  const launch = snapshot.bot?.launchDefaults;
  if (!launch) return undefined;
  return {
    provider: launch.provider,
    model: launch.model ?? null,
    modeId: launch.modeId ?? null,
    thinkingOptionId: launch.thinkingOptionId ?? null,
  };
}

export function entryFor(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
) {
  return provider ? (entries.find((entry) => entry.provider === provider) ?? null) : null;
}

export function modelsFor(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
) {
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
  if (!id) return { label: i18n.t("bots.workspace.shared.form.defaultMode") };
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

/**
 * The preferences the selection starts from, so a new bot never opens without a model: when
 * nothing chose a provider yet, or the remembered one is not on this Host, the first provider the
 * Host reports ready stands in. The stored preferences are not changed.
 */
function withAvailableProvider(
  input: {
    state: BotFormState;
    initialValues: FormInitialValues | undefined;
    preferences: FormPreferences | null;
    entries: readonly ProviderSnapshotEntry[];
    userModified: UserModifiedFields;
  },
  allowed: ReadonlyMap<AgentProvider, unknown>,
): FormPreferences | null {
  if (input.userModified.provider || input.initialValues?.provider) return input.preferences;
  const chosen = input.preferences?.provider ?? input.state.selectedProvider;
  if (chosen && allowed.has(chosen)) return input.preferences;
  const ready = input.entries.find((entry) => entry.enabled && entry.status === "ready");
  return ready ? { ...input.preferences, provider: ready.provider } : input.preferences;
}

export function resolveSelection(input: {
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
    withAvailableProvider(input, allowed),
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

export function updateDerivedState(input: {
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
    // A bot from a Project runs on that Project's Host.
    showHostField:
      !state.project &&
      (input.hosts.length !== 1 || input.hosts[0]?.serverId !== state.selectedServerId),
    selectedModelDisplay: modelDisplay(models, state.selectedModel),
    selectedModeDisplay: modeDisplay(modeOptions, state.selectedMode),
    selectedThinkingDisplay: thinkingDisplay(thinkingOptions, state.selectedThinkingOptionId),
    modeOptions,
    availableThinkingOptions: thinkingOptions,
    providerSnapshotRequest:
      state.selectedServerId && resolution !== "complete"
        ? { serverId: state.selectedServerId }
        : null,
    canSubmit: Boolean(
      state.name.trim() &&
      state.selectedServerId &&
      state.selectedProvider &&
      !awaitingTemplatePreview(state.template, state.project !== null),
    ),
  };
}

/** The Project a new bot is made from, and no template unless an existing bot was seeded with one. */
function initialProjectAndTemplate(
  snapshot: BotFormSnapshot,
): Pick<BotFormState, "project" | "template"> {
  const project = snapshot.mode === "create" ? (snapshot.defaults.project ?? null) : null;
  return { project, template: initialTemplateState(initialTemplateChoice(snapshot, project)) };
}

/**
 * A bot from a Project starts from what the Project holds, so no template; a new bot gets an
 * empty folder, so Personal, which writes the files it needs. An existing bot shows how it began.
 */
function initialTemplateChoice(
  snapshot: BotFormSnapshot,
  project: BotFormState["project"],
): BotTemplateChoice {
  if (snapshot.mode !== "create") return snapshot.bot?.template ? snapshot.bot.kind : "none";
  return project ? "none" : "personal";
}

export function buildInitialState(snapshot: BotFormSnapshot): BotFormState {
  const selectedServerId = resolveInitialServerId(snapshot);
  const launch = snapshot.bot?.launchDefaults;
  const model = launch?.model ?? "";
  const mode = launch?.modeId ?? "";
  const thinking = launch?.thinkingOptionId ?? "";
  return {
    mode: snapshot.mode,
    name: snapshot.bot?.name ?? snapshot.defaults.name ?? "",
    description: snapshot.bot?.description ?? "",
    slugPreview: "",
    kind: snapshot.bot?.kind ?? "personal",
    ...initialProjectAndTemplate(snapshot),
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
