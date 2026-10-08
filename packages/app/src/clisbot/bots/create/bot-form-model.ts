import type { AgentProfile } from "@clisbot/protocol/agent-profile";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@clisbot/protocol/agent-types";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  INITIAL_USER_MODIFIED,
  resolveDefaultModelId,
  resolveThinkingOptionId,
  type FormInitialValues,
  type UserModifiedFields,
} from "@/provider-selection/resolve-agent-form";
import type { BotKind, BotLaunchDefaults, BotPayload } from "../data/contracts";
import {
  initialTemplateState,
  templateRequest,
  toggledReplace,
  type BotTemplateChoice,
  type BotTemplateConflictPolicy,
  type BotTemplateFile,
  type BotTemplateState,
} from "./bot-template-choice";
import {
  buildInitialState,
  entryFor,
  hostDisplay,
  initialValuesOf,
  modelsFor,
  resolveSelection,
  updateDerivedState,
} from "./bot-form-derive";

export { previewBotSlug } from "./bot-form-derive";

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

/** An existing Project a new bot is made from: the bot works in it and shares it. */
export interface BotFromProject {
  serverId: string;
  projectId: string;
  name: string;
  path: string;
}

export interface BotFormSnapshot {
  mode: "create" | "edit";
  bot?: BotPayload & { serverId?: string };
  hosts: readonly BotFormHost[];
  defaults: {
    serverId?: string | null;
    name?: string;
    preferences?: FormPreferences;
    project?: BotFromProject;
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
  /** What other bots in a group read to decide when to tag this one; empty = none. */
  description: string;
  /** The directory name the daemon will derive (README D3); the record's slug in edit mode. */
  slugPreview: string;
  kind: BotKind;
  /** The Project the bot is made from; its Host is the bot's Host. */
  project: BotFromProject | null;
  template: BotTemplateState;
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
  description?: string;
  path?: string;
  launch: BotLaunchDefaults;
  template?: { seed: false } | { overwrite: boolean | string[] };
}

export interface BotUpdateRequest {
  serverId: string;
  botId: string;
  name: string;
  description: string | null;
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
  setDescription: (value: string) => void;
  setKind: (value: BotKind) => void;
  setTemplate: (choice: BotTemplateChoice) => void;
  setConflictPolicy: (policy: BotTemplateConflictPolicy) => void;
  toggleReplace: (fileName: string) => void;
  applyTemplatePreview: (files: BotTemplateFile[]) => void;
  setHost: (serverId: string | null, display?: BotFormDisplay | null) => void;
  setProvider: (provider: AgentProvider) => void;
  setModel: (provider: AgentProvider, modelId: string) => void;
  setMode: (modeId: string) => void;
  setThinkingOption: (thinkingOptionId: string) => void;
  setFeature: (featureId: string, value: unknown) => void;
  setSubmitError: (value: string | null) => void;
  /**
   * The provider is one someone chose: the user here, or the saved preferences. False for the
   * Host's first ready provider standing in, which must not become the next form's default.
   */
  isProviderChosen: () => boolean;
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
  const template = templateRequest(state.template);
  return {
    serverId: state.selectedServerId,
    name: state.name.trim(),
    kind: state.kind,
    ...(state.description.trim() ? { description: state.description.trim() } : {}),
    ...(state.project ? { path: state.project.path } : {}),
    launch: launchOf(state),
    ...(template ? { template } : {}),
  };
}

export function toUpdateRequest(state: BotFormState, botId: string): BotUpdateRequest {
  if (!state.selectedServerId) throw new Error("A Host is required");
  return {
    serverId: state.selectedServerId,
    botId,
    name: state.name.trim(),
    description: state.description.trim() || null,
    launch: launchOf(state),
  };
}

/** The mutable half of an open form: what the model's methods read and publish through. */
interface BotFormSession {
  readonly snapshot: BotFormSnapshot;
  readonly initialValues: FormInitialValues | undefined;
  readonly editSlug: string | null;
  readonly listeners: Set<() => void>;
  closed: boolean;
  hosts: readonly BotFormHost[];
  preferences: FormPreferences | null;
  entries: ProviderSnapshotEntry[];
  userModified: UserModifiedFields;
  state: BotFormState;
}

const ALL_LAUNCH_FIELDS_MODIFIED: UserModifiedFields = {
  provider: true,
  model: true,
  modeId: true,
  thinkingOptionId: true,
};

function openSession(snapshot: BotFormSnapshot): BotFormSession {
  const editSlug = snapshot.mode === "edit" ? (snapshot.bot?.slug ?? null) : null;
  return {
    snapshot,
    initialValues: initialValuesOf(snapshot),
    editSlug,
    listeners: new Set(),
    closed: false,
    hosts: snapshot.hosts,
    preferences: snapshot.mode === "create" ? (snapshot.defaults.preferences ?? null) : null,
    entries: [],
    userModified: { ...INITIAL_USER_MODIFIED },
    state: updateDerivedState({
      state: buildInitialState(snapshot),
      hosts: snapshot.hosts,
      entries: [],
      slug: editSlug,
    }),
  };
}

function publish(session: BotFormSession, next: BotFormState): void {
  if (session.closed) return;
  const { hosts, entries, editSlug } = session;
  session.state = updateDerivedState({ state: next, hosts, entries, slug: editSlug });
  for (const listener of session.listeners) listener();
}

function resolved(session: BotFormSession, next: BotFormState): BotFormState {
  const { entries, initialValues, preferences, userModified } = session;
  if (entries.length === 0) return next;
  return resolveSelection({ state: next, initialValues, preferences, entries, userModified });
}

function clearProviderSelection(session: BotFormSession, next: BotFormState): BotFormState {
  session.entries = [];
  // The choices were for the old Host; the new one starts from preferences and its own providers.
  session.userModified = { ...INITIAL_USER_MODIFIED };
  return {
    ...next,
    selectedProvider: null,
    selectedModel: "",
    selectedMode: "",
    selectedThinkingOptionId: "",
    modelSelectorProviders: [],
  };
}

function markUserModified(session: BotFormSession, fields: Partial<UserModifiedFields>): void {
  session.userModified = { ...session.userModified, ...fields };
}

function defaultModeOf(entry: ProviderSnapshotEntry | null): string {
  return entry?.defaultModeId ?? entry?.modes?.[0]?.id ?? "";
}

function lifecycleMethods(
  session: BotFormSession,
): Pick<BotFormModel, "getState" | "subscribe" | "close" | "isProviderChosen"> {
  return {
    getState: () => session.state,
    isProviderChosen: () =>
      session.userModified.provider ||
      (session.state.selectedProvider !== null &&
        session.state.selectedProvider === session.preferences?.provider),
    subscribe(listener) {
      if (session.closed) return () => {};
      session.listeners.add(listener);
      return () => {
        session.listeners.delete(listener);
      };
    },
    close() {
      session.closed = true;
      session.listeners.clear();
    },
  };
}

/** Inputs the adapter pushes in: Hosts, stored preferences, a Host's provider snapshot, a profile. */
function sourceMethods(
  session: BotFormSession,
): Pick<
  BotFormModel,
  "applyHosts" | "applyPreferences" | "applyProviderSnapshot" | "applyProfile"
> {
  return {
    applyHosts(nextHosts) {
      if (session.closed || session.hosts === nextHosts) return;
      session.hosts = nextHosts;
      publish(session, session.state);
    },
    applyPreferences(nextPreferences) {
      const normalized = session.snapshot.mode === "create" ? (nextPreferences ?? null) : null;
      if (session.closed || session.preferences === normalized) return;
      session.preferences = normalized;
      publish(session, resolved(session, session.state));
    },
    applyProviderSnapshot(serverId, providerSnapshot) {
      const { state } = session;
      if (session.closed || state.selectedServerId !== serverId) return;
      session.entries = providerSnapshot.entries;
      publish(session, {
        ...resolved(session, state),
        modelSelectorProviders: buildSelectableProviderSelectorProviders(session.entries),
        providerResolutionByServerId: {
          ...state.providerResolutionByServerId,
          [serverId]: "complete",
        },
      });
    },
    applyProfile(profile) {
      if (session.closed) return;
      markUserModified(session, ALL_LAUNCH_FIELDS_MODIFIED);
      publish(session, {
        ...session.state,
        selectedProvider: profile.provider,
        selectedModel: profile.model ?? "",
        selectedMode: profile.modeId ?? "",
        selectedThinkingOptionId: profile.thinkingOptionId ?? "",
        featureValues: { ...profile.featureValues },
      });
    },
  };
}

/** The template a new bot starts from, and what it does to files the folder already has. */
function templateMethods(
  session: BotFormSession,
): Pick<
  BotFormModel,
  "setTemplate" | "setConflictPolicy" | "toggleReplace" | "applyTemplatePreview"
> {
  const patchTemplate = (update: (template: BotTemplateState) => BotTemplateState) =>
    publish(session, { ...session.state, template: update(session.state.template) });
  return {
    setTemplate(choice) {
      const kind = choice === "none" ? session.state.kind : choice;
      // Another template writes other files; its preview comes again.
      publish(session, { ...session.state, kind, template: initialTemplateState(choice) });
    },
    setConflictPolicy: (policy) => patchTemplate((template) => ({ ...template, policy })),
    toggleReplace: (fileName) => patchTemplate((template) => toggledReplace(template, fileName)),
    applyTemplatePreview: (files) => patchTemplate((template) => ({ ...template, files })),
  };
}

/** The bot's own fields: name, description, kind, Host, and the submit error. */
function identityMethods(
  session: BotFormSession,
): Pick<BotFormModel, "setName" | "setDescription" | "setKind" | "setHost" | "setSubmitError"> {
  const patch = (fields: Partial<BotFormState>) =>
    publish(session, { ...session.state, ...fields });
  return {
    setName: (value) => patch({ name: value }),
    setDescription: (value) => patch({ description: value }),
    setKind: (value) => patch({ kind: value }),
    setSubmitError: (value) => patch({ submitError: value }),
    setHost(serverId, display) {
      if (session.closed || session.state.selectedServerId === serverId) return;
      publish(
        session,
        clearProviderSelection(session, {
          ...session.state,
          selectedServerId: serverId,
          selectedHostDisplay: display ?? hostDisplay(session.hosts, serverId),
          providerResolutionByServerId: serverId ? { [serverId]: "pending" } : {},
        }),
      );
    },
  };
}

/** The launch defaults: provider, model, mode, thinking option, and feature values. */
function launchMethods(
  session: BotFormSession,
): Pick<BotFormModel, "setProvider" | "setModel" | "setMode" | "setThinkingOption" | "setFeature"> {
  return {
    setProvider(provider) {
      if (session.closed) return;
      const { state, entries } = session;
      const model = state.selectedProvider === provider ? state.selectedModel : "";
      markUserModified(session, ALL_LAUNCH_FIELDS_MODIFIED);
      publish(session, {
        ...state,
        selectedProvider: provider,
        selectedModel: model || resolveDefaultModelId(modelsFor(entries, provider)),
        selectedMode: defaultModeOf(entryFor(entries, provider)),
        selectedThinkingOptionId: "",
      });
    },
    setModel(provider, modelId) {
      if (session.closed) return;
      markUserModified(session, ALL_LAUNCH_FIELDS_MODIFIED);
      publish(session, withModel(session, provider, modelId));
    },
    setMode(modeId) {
      if (session.closed) return;
      markUserModified(session, { modeId: true });
      publish(session, { ...session.state, selectedMode: modeId });
    },
    setThinkingOption(thinkingOptionId) {
      if (session.closed) return;
      markUserModified(session, { thinkingOptionId: true });
      publish(session, { ...session.state, selectedThinkingOptionId: thinkingOptionId });
    },
    setFeature(featureId, value) {
      const { state } = session;
      publish(session, { ...state, featureValues: { ...state.featureValues, [featureId]: value } });
    },
  };
}

function withModel(
  session: BotFormSession,
  provider: AgentProvider,
  modelId: string,
): BotFormState {
  const { state, entries } = session;
  const models = modelsFor(entries, provider);
  const selectedModel = modelId.trim() || resolveDefaultModelId(models);
  const providerChanged = state.selectedProvider !== provider;
  return {
    ...state,
    selectedProvider: provider,
    selectedModel,
    selectedMode: providerChanged ? defaultModeOf(entryFor(entries, provider)) : state.selectedMode,
    selectedThinkingOptionId: resolveThinkingOptionId({
      availableModels: models,
      modelId: selectedModel,
      requestedThinkingOptionId: providerChanged ? "" : state.selectedThinkingOptionId,
    }),
  };
}

export function openBotForm(snapshot: BotFormSnapshot): BotFormModel {
  const session = openSession(snapshot);
  return {
    ...lifecycleMethods(session),
    ...sourceMethods(session),
    ...identityMethods(session),
    ...templateMethods(session),
    ...launchMethods(session),
  };
}
