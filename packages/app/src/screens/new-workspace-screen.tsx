import { useIsFocused } from "expo-router/react-navigation";
import { buildStartDestinations, StartDestinationOption } from "@/clisbot/home/start-destinations";
import { orderStartOptions } from "@/clisbot/home/start-kinds";
import { useStartTemplate, type PendingStartTemplate } from "@/clisbot/home/use-start-template";
import { snapshotStart, composerLaunch } from "@/clisbot/home/start-template";
import { findDestination } from "@/clisbot/quick-starts/model";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { NavigationHomeLayout } from "@/clisbot/navigation/home-layout";
import { HomeStartLayout, StartFeedback } from "@/clisbot/home/start-surface";
import { StartSwitcher } from "@/clisbot/home/start-switcher";
import { useQuickChatByDefault } from "@/clisbot/home/use-quick-chat-default";
import { useCrossHostPicker } from "@/clisbot/home/use-cross-host-picker";
import { useQuickChatAllowed, useQuickChatRoot } from "@/clisbot/quick-chats/quick-chat-projects";
import { QuickStarts } from "@/clisbot/quick-starts/quick-starts";
import type { QuickStartInput } from "@clisbot/protocol/quick-starts/types";
import { useCreationRequest } from "@/clisbot/bots/sidebar/creation-request";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
import { buildHostChatRoute } from "@/clisbot/bots/routes";
import { useStartDestination } from "@/clisbot/home/use-start-destination";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import type {
  CreateAgentRequestOptions,
  CreateWorkspaceRequestOptions,
} from "@clisbot/client/internal/daemon-client";
import type { AgentSnapshotPayload, CreationSnapshot } from "@clisbot/protocol/messages";
import { encodeImages } from "@/utils/encode-images";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ICON_SIZE } from "@/styles/theme";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { createNameId } from "mnemonic-id";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Composer } from "@/composer";
import { ComposerDock } from "@/composer/dock";
import { useComposerEditingSession, useComposerFullscreen } from "@/composer/editing-session";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { ProjectIconView } from "@/components/project-icon-view";
import type { ComboboxProps } from "@/components/ui/combobox";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { MenuHeader } from "@/components/headers/menu-header";
import { HomeHeader } from "@/clisbot/home/home-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useForgeSearchQuery } from "@/git/use-forge-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { useLaunchableTerminalProfiles } from "@/clisbot/terminal-profiles/use-launchable-terminal-profiles";
import { resolveLaunchTarget, type LaunchTarget } from "@/new-workspace-launch/target";
import { useTerminalComposerState } from "@/new-workspace-launch/composer-state";
import { runCreateTerminalWorkspace } from "./new-workspace-terminal";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
  useHostRuntimeIsConnected,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useHostFeature, useHostFeatureMap } from "@/runtime/host-features";
import type { HostProfile } from "@/types/host-connection";
import {
  navigateToWorkspace,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import {
  useWorkspaceDraftSubmissionStore,
  type PendingWorkspaceDraftSetup,
} from "@/stores/workspace-draft-submission-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { toErrorMessage } from "@/utils/error-messages";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import {
  getHostProjectId,
  getWorktreeSupportForHostProject,
  hostProjectFromRoute,
  hostProjectFromWorkspace,
  resolveHostProjectCandidate,
  useHostProjects,
  type HostProjectListItem,
} from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import type { ComposerAttachment } from "@/attachments/types";
import { useDraftWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import type { MessagePayload } from "@/composer/types";
import type { UserComposerAttachment } from "@/attachments/types";
import type { AgentAttachment, ForgeSearchItem } from "@clisbot/protocol/messages";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { AgentProvider } from "@clisbot/protocol/agent-types";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { isEmptyWorkspaceSubmission, runCreateEmptyWorkspace } from "./new-workspace-empty";
import {
  getWorkspaceNamingAttachments,
  remapDraftCwdToWorkspace,
} from "./new-workspace-fork-context";
import {
  buildPickerOptionData,
  defaultBasePickerItem,
  pickerItemLabel,
  pickerItemToCheckoutRequest,
  type BranchPickerDetail,
  type PickerCheckoutRequest,
  type PickerItem,
  type PickerOptionData,
} from "./new-workspace-picker-item";
import {
  clearPickerPrAttachmentForTargetChange,
  initialPickerSelectionState,
  reducePickerSelection,
  syncPickerPrAttachment,
} from "./new-workspace-picker-state";
import {
  resolveNewWorkspaceAutomaticServerId,
  resolveNewWorkspaceInitialServerId,
} from "./new-workspace-initial-context";
import { buildNewWorkspaceProjectIconTargets } from "./new-workspace/project-icon-targets";
import { useNewWorkspaceProjectPicker } from "./new-workspace/project-picker";
import { useNewWorkspaceForm } from "./new-workspace/form";
import { ImportSessionButton } from "./new-workspace/import-session-button";
import { useImportSession } from "@/hooks/use-import-session";
import {
  buildTerminalsQueryKey,
  type ListTerminalsPayload,
  upsertCreatedTerminalPayload,
} from "./workspace/terminals/state";
import { captureWorkspaceDraftCleanup } from "./new-workspace/background-handoff";
import { useNewWorkspaceScreenPresence, startScreenPath } from "./new-workspace/screen-presence";

function useIsNewWorkspaceDraftHandoffActive(input: {
  draftId: string | undefined;
  selectedServerId: string;
}): boolean {
  const normalizedDraftId = input.draftId?.trim() ?? "";
  return useCreateFlowStore((state) =>
    isActiveCreateFlowForDraft({
      draftId: normalizedDraftId,
      serverId: input.selectedServerId,
      pending: normalizedDraftId ? state.pendingByDraftId[normalizedDraftId] : null,
    }),
  );
}

function resolveVisibleDraftContextScopeKeys(input: {
  isDraftHandoffActive: boolean;
  draftContextScopeKey: string;
}): readonly string[] {
  if (input.isDraftHandoffActive || !input.draftContextScopeKey) {
    return [];
  }
  return [input.draftContextScopeKey];
}

function isNewWorkspacePending(input: {
  pendingAction: "chat" | "empty" | "terminal" | null;
  isDraftHandoffActive: boolean;
}): boolean {
  return input.pendingAction !== null || input.isDraftHandoffActive;
}

function buildFirstAgentContext(input: {
  prompt: string;
  attachments: AgentAttachment[];
}): { prompt?: string; attachments?: AgentAttachment[] } | undefined {
  const trimmedPrompt = input.prompt.trim();
  if (!trimmedPrompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    attachments: input.attachments,
  };
}

interface NewWorkspaceScreenProps {
  home?: boolean;
  serverId: string;
  sourceDirectory?: string;
  projectId?: string;
  displayName?: string;
  draftId?: string;
}

// A terminal launch sends argv, not a message: there is nothing to attach and
// no draft to persist, so the composer's attachment and draft seams are inert.
const NO_TERMINAL_ATTACHMENTS: UserComposerAttachment[] = [];
function noopChangeAttachments() {}
function noopClearDraft() {}

// Stable reference so the keyboard-action handler doesn't re-register each render.
const PROJECT_PICK_ACTIONS: readonly KeyboardActionId[] = ["workspace.project.pick"];

interface WorkspaceIsolationState {
  isolation: "local" | "worktree";
  setIsolation: (value: "local" | "worktree", persist?: boolean) => void;
  effectiveIsolation: "local" | "worktree";
  canCreateWorktree: boolean;
  showRefPicker: boolean;
}

// Preserve the user's worktree choice while route metadata is provisional. Once
// the authoritative placement arrives, unsupported projects fall back to local.
function useWorkspaceIsolation(input: {
  supportsMultiplicity: boolean;
  worktreeSupport: "supported" | "unsupported" | "unknown";
}): WorkspaceIsolationState {
  const { supportsMultiplicity, worktreeSupport } = input;
  // The last isolation choice is remembered alongside the other New Workspace
  // form preferences (provider, model, mode). A manual in-screen pick overrides
  // the remembered default until the screen remounts.
  const { preferences, updatePreferences } = useFormPreferences();
  const [manualIsolation, setManualIsolation] = useState<"local" | "worktree" | null>(null);
  const isolation = manualIsolation ?? preferences.isolation ?? "local";
  const canCreateWorktree = supportsMultiplicity && worktreeSupport !== "unsupported";
  const isWorktree = isolation === "worktree" && canCreateWorktree;

  const setIsolation = useCallback(
    (value: "local" | "worktree", persist = true) => {
      setManualIsolation(value);
      if (persist) void updatePreferences({ isolation: value });
    },
    [updatePreferences],
  );

  return {
    isolation,
    setIsolation,
    effectiveIsolation: isWorktree ? "worktree" : "local",
    canCreateWorktree,
    showRefPicker: !supportsMultiplicity || isWorktree,
  };
}

function normalizeBranchDetails(
  data: { branchDetails?: BranchPickerDetail[]; branches?: string[] } | undefined,
): BranchPickerDetail[] {
  const details = data?.branchDetails;
  if (details && details.length > 0) return details;
  const names = data?.branches ?? [];
  return names.map((name) => ({ name, committerDate: 0 }));
}

/**
 * "background" means the user left the New workspace screen mid-creation, so nothing navigated
 * and the screen — if still mounted under another route — has to drop its pending state itself.
 */
type SubmitOutcome = "navigated" | "background";

interface SubmitDraftInput {
  clearConsumedDraft: () => void;
  agentCreation?: {
    result: Promise<AgentSnapshotPayload>;
    retry: (input: CreateAgentRequestOptions) => Promise<AgentSnapshotPayload>;
  };
  serverId: string;
  draftKey: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  draftContextScopeKey: string | null;
  initialSetup?: WorkspaceDraftTabSetup;
  workspaceId: string;
  workspaceDirectory: string;
  text: string;
  attachments: ComposerAttachment[];
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  supportsForgeSearch: boolean;
  resolveClient: () => DaemonClient;
  isStillOnCreateScreen: () => boolean;
}

type NewWorkspaceComposerState = NonNullable<
  ReturnType<typeof useAgentInputDraft>["composerState"]
>;

interface WorkspaceDraftSubmissionConfig {
  cwd: string;
  provider: AgentProvider;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown> | undefined;
  target: WorkspaceTabTarget;
}

interface WorkspaceCreationResult {
  workspace: ReturnType<typeof normalizeWorkspaceDescriptor>;
  agent?: AgentSnapshotPayload;
}

async function createMultiplicityWorkspace(input: {
  idempotencyKey: string;
  worktreeSlug: string;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isolation: "local" | "worktree";
  project: HostProjectListItem;
  sourceDirectory: string;
  checkoutRequest: PickerCheckoutRequest | undefined;
  withInitialAgent: boolean;
  agent?: CreateWorkspaceRequestOptions["agent"];
  onEvent?: (snapshot: CreationSnapshot) => void;
  prompt: string;
  attachments: AgentAttachment[];
  mergeWorkspaces: (
    serverId: string,
    workspaces: ReturnType<typeof normalizeWorkspaceDescriptor>[],
  ) => void;
  serverId: string;
  createFailedMessage: string;
}): Promise<WorkspaceCreationResult> {
  const projectId = getHostProjectId(input.project, input.serverId);
  if (!projectId) throw new Error("Project is not available on the selected host");
  const isWorktree = input.isolation === "worktree";
  const firstAgentContext = buildFirstAgentContext({
    prompt: input.prompt,
    attachments: input.attachments,
  });
  const payload = await input.client.createWorkspace({
    idempotencyKey: input.idempotencyKey,
    agent: input.agent,
    onEvent: input.onEvent,
    source: isWorktree
      ? {
          kind: "worktree",
          cwd: input.sourceDirectory,
          projectId,
          worktreeSlug: input.worktreeSlug,
          ...input.checkoutRequest,
        }
      : {
          kind: "directory",
          path: input.sourceDirectory,
          projectId,
        },
    ...(firstAgentContext ? { firstAgentContext } : {}),
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.withInitialAgent
    ? { ...normalizedWorkspace, status: "running" as const, statusEnteredAt: new Date() }
    : normalizedWorkspace;
  input.mergeWorkspaces(input.serverId, [workspaceForInitialMerge]);
  return { workspace: normalizedWorkspace, agent: payload.agent };
}

interface CreateChatAgentInput {
  payload: MessagePayload;
  composerState: ReturnType<typeof useAgentInputDraft>["composerState"];
  forkDraftSetup?: PendingWorkspaceDraftSetup | null;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
    agent?: CreateWorkspaceRequestOptions["agent"];
    onEvent?: (snapshot: CreationSnapshot) => void;
  }) => Promise<WorkspaceCreationResult>;
  serverId: string;
  draftKey: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  draftId?: string;
  draftContextScopeKey: string | null;
  supportsForgeSearch: boolean;
  resolveClient: () => DaemonClient;
  isStillOnCreateScreen: () => boolean;
  labels: {
    composerStateRequired: string;
    selectModel: string;
  };
}

function buildWorkspaceDraftSetupFromComposer(input: {
  cwd: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.composerState.effectiveModeId || null,
    model: input.composerState.effectiveModelId || null,
    thinkingOptionId: input.composerState.effectiveThinkingOptionId || null,
    featureValues: input.composerState.featureValues ?? {},
  };
}

function buildWorkspaceDraftSetupForCreatedWorkspace(input: {
  forkDraftSetup: PendingWorkspaceDraftSetup | null | undefined;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
}): WorkspaceDraftTabSetup | undefined {
  if (!input.forkDraftSetup) {
    return undefined;
  }
  return buildWorkspaceDraftSetupFromComposer({
    cwd: remapDraftCwdToWorkspace({
      cwd: input.forkDraftSetup.setup.cwd,
      sourceDirectory: input.forkDraftSetup.sourceDirectory,
      workspaceDirectory: input.workspaceDirectory,
    }),
    provider: input.provider,
    composerState: input.composerState,
  });
}

function buildComposerInitialValues(input: {
  initialSetup?: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (input.initialSetup) {
    return {
      provider: input.initialSetup.provider,
      modeId: input.initialSetup.modeId,
      model: input.initialSetup.model,
      thinkingOptionId: input.initialSetup.thinkingOptionId,
    };
  }
  return undefined;
}

const pendingWorkspaceSubmissions = new Map<string, Promise<SubmitOutcome>>();
function runCreateChatAgent(input: CreateChatAgentInput): Promise<SubmitOutcome> {
  const key = JSON.stringify([input.serverId, input.draftId]);
  const pending = pendingWorkspaceSubmissions.get(key);
  if (pending) return pending;
  const submission = Promise.resolve().then(() => createWorkspaceChatAgent(input));
  pendingWorkspaceSubmissions.set(key, submission);
  void submission.finally(() => pendingWorkspaceSubmissions.delete(key)).catch(() => undefined);
  return submission;
}

async function createWorkspaceChatAgent(input: CreateChatAgentInput): Promise<SubmitOutcome> {
  const { payload, composerState, ensureWorkspace, serverId, clearDraft } = input;
  const clearConsumedDraft = captureWorkspaceDraftCleanup(input);
  const { text, attachments, cwd } = payload;
  if (!composerState) {
    throw new Error(input.labels.composerStateRequired);
  }
  const provider = composerState.selectedProvider;
  if (!provider || !composerState.providerDefinitionMap.has(provider)) {
    throw new Error(input.labels.selectModel);
  }
  const attachmentSubmitFormat = resolveComposerAttachmentSubmitFormat({
    supportsForgeAttachments: input.supportsForgeSearch,
  });
  const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(attachments, {
    format: attachmentSubmitFormat,
  });
  const workspaceNamingAttachments = getWorkspaceNamingAttachments(reviewAttachments);
  const wirePayload = splitComposerAttachmentsForSubmit(attachments, {
    format: attachmentSubmitFormat,
  });
  const images = await encodeImages(wirePayload.images);
  let navigated = false;
  let outcome: SubmitOutcome = "background";
  const initialAgent: NonNullable<CreateWorkspaceRequestOptions["agent"]> = {
    config: {
      provider,
      cwd,
      modeId: composerState.effectiveModeId || undefined,
      model: composerState.effectiveModelId || undefined,
      thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
      featureValues: composerState.featureValues,
    },
    initialPrompt: text,
    clientMessageId: `${input.draftId}:initial-message`,
    images: images?.length ? images : undefined,
    attachments: wirePayload.attachments?.length ? wirePayload.attachments : undefined,
  };
  const execute = async (requestedAgent = initialAgent): Promise<AgentSnapshotPayload> => {
    const { agent } = await ensureWorkspace({
      cwd,
      prompt: text,
      attachments: workspaceNamingAttachments,
      withInitialAgent: true,
      agent: requestedAgent,
      onEvent: (snapshot) => {
        if (!snapshot.workspace || navigated) return;
        navigated = true;
        if (!input.isStillOnCreateScreen()) return;
        const workspace = normalizeWorkspaceDescriptor(snapshot.workspace);
        getHostRuntimeStore().acceptWorkspaceSnapshots(serverId, [
          { ...workspace, status: "running" },
        ]);
        const initialSetup = buildWorkspaceDraftSetupForCreatedWorkspace({
          forkDraftSetup: input.forkDraftSetup,
          workspaceDirectory: workspace.workspaceDirectory,
          provider,
          composerState,
        });
        outcome = submitWorkspaceDraft({
          clearConsumedDraft,
          draftKey: input.draftKey,
          draftContextScopeKey: input.draftContextScopeKey,
          resolveClient: input.resolveClient,
          isStillOnCreateScreen: input.isStillOnCreateScreen,
          serverId,
          clearDraft,
          draftId: input.draftId,
          initialSetup,
          workspaceId: workspace.id,
          workspaceDirectory: workspace.workspaceDirectory,
          text,
          attachments,
          provider,
          composerState,
          supportsForgeSearch: input.supportsForgeSearch,
          agentCreation,
        });
      },
    });
    if (!agent) throw new Error("Workspace creation returned no agent");
    return agent;
  };
  const agentCreation = {
    result: Promise.resolve().then(() => execute()),
    retry: (request: CreateAgentRequestOptions) =>
      execute({
        ...initialAgent,
        config: { ...request.config!, cwd },
        initialPrompt: request.initialPrompt ?? "",
        clientMessageId: initialAgent.clientMessageId,
        images: request.images,
        attachments: request.attachments,
      }),
  };
  await agentCreation.result;
  if (outcome === "background") clearConsumedDraft();
  return outcome;
}

function buildComposerConfig(input: {
  serverId: string;
  workspaceDirectory: string | null;
  sourceDirectory: string | null;
  initialSetup?: WorkspaceDraftTabSetup | null;
}): Parameters<typeof useAgentInputDraft>[0]["composer"] {
  const { serverId, workspaceDirectory, sourceDirectory, initialSetup } = input;
  const workingDir = workspaceDirectory || sourceDirectory || undefined;
  return {
    initialServerId: serverId || null,
    initialValues: buildComposerInitialValues({ initialSetup }),
    initialFeatureValues: initialSetup?.featureValues,
    isVisible: true,
    lockedWorkingDir: workingDir,
  };
}

function usePendingWorkspaceDraftSetup(
  draftId: string | undefined,
): PendingWorkspaceDraftSetup | null {
  const normalizedDraftId = draftId?.trim() ?? "";
  return useWorkspaceDraftSubmissionStore((state) => {
    if (!normalizedDraftId) {
      return null;
    }
    return state.setupByDraftId[normalizedDraftId] ?? null;
  });
}

function resolveWorkspaceDraftSubmissionConfig(input: {
  draftId: string;
  workspaceDirectory: string;
  provider: AgentProvider;
  composerState: NewWorkspaceComposerState;
  initialSetup?: WorkspaceDraftTabSetup;
}): WorkspaceDraftSubmissionConfig {
  const { draftId, workspaceDirectory, provider, composerState, initialSetup } = input;
  if (initialSetup) {
    return {
      cwd: initialSetup.cwd,
      provider: initialSetup.provider,
      modeId: initialSetup.modeId,
      model: initialSetup.model,
      thinkingOptionId: initialSetup.thinkingOptionId,
      featureValues: initialSetup.featureValues,
      target: { kind: "draft", draftId, setup: initialSetup },
    };
  }
  return {
    cwd: workspaceDirectory,
    provider,
    modeId: composerState.effectiveModeId || null,
    model: composerState.effectiveModelId || null,
    thinkingOptionId: composerState.effectiveThinkingOptionId || null,
    featureValues: composerState.featureValues,
    target: { kind: "draft", draftId },
  };
}

function submitWorkspaceDraft(input: SubmitDraftInput): SubmitOutcome {
  const {
    serverId,
    clearDraft,
    draftId: draftIdInput,
    workspaceId,
    workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
    initialSetup,
  } = input;
  const draftId = draftIdInput?.trim() || generateDraftId();
  const clientMessageId = `${draftId}:initial-message`;
  const timestamp = Date.now();
  const wirePayload = splitComposerAttachmentsForSubmit(attachments, {
    format: resolveComposerAttachmentSubmitFormat({
      supportsForgeAttachments: input.supportsForgeSearch,
    }),
  });
  const submission = resolveWorkspaceDraftSubmissionConfig({
    draftId,
    workspaceDirectory,
    provider,
    composerState,
    initialSetup,
  });
  const started = useCreateFlowStore.getState().trySetPending({
    serverId,
    draftId,
    workspaceId,
    agentId: null,
    clientMessageId,
    text: text.trim(),
    timestamp,
    ...(wirePayload.images.length > 0 ? { images: wirePayload.images } : {}),
    ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
  });
  if (!started) return "navigated";
  useWorkspaceDraftSubmissionStore.getState().setPending({
    serverId,
    workspaceId,
    draftId,
    text: text.trim(),
    attachments,
    cwd: submission.cwd,
    provider: submission.provider,
    clientMessageId,
    timestamp,
    ...(submission.modeId ? { modeId: submission.modeId } : {}),
    ...(submission.model ? { model: submission.model } : {}),
    ...(submission.thinkingOptionId ? { thinkingOptionId: submission.thinkingOptionId } : {}),
    ...(submission.featureValues ? { featureValues: submission.featureValues } : {}),
    allowEmptyText: true,
    agentCreation: input.agentCreation,
  });
  clearDraft("sent");
  navigateToWorkspace({
    serverId,
    workspaceId,
    target: submission.target,
  });
  return "navigated";
}

function useNewWorkspaceHostSelector(input: {
  initialServerId: string;
  allServerIds: string[];
  projects: HostProjectListItem[];
  lastActiveProject: HostProjectListItem | null;
  hostConnectionStatusByServerId: ReadonlyMap<string, HostRuntimeConnectionStatus>;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
}) {
  const routeServerId = input.initialServerId.trim();
  const defaultServerId = useMemo(
    () =>
      resolveNewWorkspaceInitialServerId({
        allServerIds: input.allServerIds,
        routeServerId: input.initialServerId,
        lastActiveProject: input.lastActiveProject,
        projects: input.projects,
        hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
        workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
      }),
    [
      input.allServerIds,
      input.hostConnectionStatusByServerId,
      input.initialServerId,
      input.lastActiveProject,
      input.projects,
      input.workspaceMultiplicityByServerId,
    ],
  );
  const [automaticSelection, setAutomaticSelection] = useState(() => ({
    routeServerId,
    serverId: defaultServerId,
  }));
  const [manualSelection, setManualSelection] = useState<{
    routeServerId: string;
    serverId: string;
  } | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  useEffect(() => {
    setAutomaticSelection((current) => {
      const nextServerId =
        current.routeServerId === routeServerId
          ? resolveNewWorkspaceAutomaticServerId({
              allServerIds: input.allServerIds,
              routeServerId: input.initialServerId,
              lastActiveProject: input.lastActiveProject,
              projects: input.projects,
              hostConnectionStatusByServerId: input.hostConnectionStatusByServerId,
              workspaceMultiplicityByServerId: input.workspaceMultiplicityByServerId,
              currentServerId: current.serverId,
              nextServerId: defaultServerId,
            })
          : defaultServerId;

      if (current.routeServerId === routeServerId && current.serverId === nextServerId) {
        return current;
      }

      return { routeServerId, serverId: nextServerId };
    });
  }, [
    defaultServerId,
    input.allServerIds,
    input.hostConnectionStatusByServerId,
    input.initialServerId,
    input.lastActiveProject,
    input.projects,
    input.workspaceMultiplicityByServerId,
    routeServerId,
  ]);

  const automaticServerId =
    automaticSelection.routeServerId === routeServerId &&
    input.allServerIds.includes(automaticSelection.serverId)
      ? automaticSelection.serverId
      : defaultServerId;
  const selectedServerId =
    manualSelection?.routeServerId === routeServerId &&
    input.allServerIds.includes(manualSelection.serverId)
      ? manualSelection.serverId
      : automaticServerId;

  const handleSelectHost = useCallback(
    (id: string) => {
      setManualSelection({ routeServerId, serverId: id });
      setHostPickerOpen(false);
    },
    [routeServerId],
  );

  const handleHostPickerOpenChange = useCallback((open: boolean) => {
    setHostPickerOpen(open);
  }, []);

  const openHostPicker = useCallback(() => {
    setHostPickerOpen(true);
  }, []);

  return {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  };
}

interface NewWorkspaceInitialContextState {
  allHosts: HostProfile[];
  selectedServerId: string;
  hostPickerOpen: boolean;
  handleSelectHost: (id: string) => void;
  handleHostPickerOpenChange: (open: boolean) => void;
  openHostPicker: () => void;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
}

function useNewWorkspaceInitialContext({
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
}: NewWorkspaceScreenProps): NewWorkspaceInitialContextState {
  const allHosts = useAvailableHosts();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);
  const projects = useHostProjects(allServerIds);
  const routeDisplayName = displayNameProp?.trim() ?? "";
  const routePlacement = useMemo(
    () =>
      hostProjectFromRoute({
        serverId,
        projectId,
        displayName: routeDisplayName,
        sourceDirectory: sourceDirectoryProp,
      }),
    [projectId, routeDisplayName, serverId, sourceDirectoryProp],
  );
  const routeProject = useMemo(() => {
    if (!routePlacement) return null;
    return (
      resolveHostProjectCandidate({
        candidate: routePlacement,
        projects,
        serverId,
      }) ?? routePlacement
    );
  }, [projects, routePlacement, serverId]);
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const lastWorkspaceServerId = useMemo(
    () =>
      lastWorkspaceSelection && allServerIds.includes(lastWorkspaceSelection.serverId)
        ? lastWorkspaceSelection.serverId
        : null,
    [allServerIds, lastWorkspaceSelection],
  );
  const lastWorkspaceId = lastWorkspaceServerId ? lastWorkspaceSelection!.workspaceId : null;
  const lastWorkspace = useWorkspace(lastWorkspaceServerId, lastWorkspaceId);
  const lastActiveProject = useMemo(
    () =>
      lastWorkspaceServerId
        ? hostProjectFromWorkspace({ serverId: lastWorkspaceServerId, workspace: lastWorkspace })
        : null,
    [lastWorkspace, lastWorkspaceServerId],
  );
  const hostConnectionStatusByServerId = useHostRuntimeConnectionStatuses(allServerIds);
  const workspaceMultiplicityByServerId = useHostFeatureMap(allServerIds, "workspaceMultiplicity");
  const {
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
  } = useNewWorkspaceHostSelector({
    initialServerId: serverId,
    allServerIds,
    projects,
    lastActiveProject,
    hostConnectionStatusByServerId,
    workspaceMultiplicityByServerId,
  });

  return {
    allHosts,
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
    projects,
    routeProject,
    routeProjectContextViewKey: routePlacement?.viewKey ?? null,
    lastActiveProject,
  };
}

export function NewWorkspaceScreen({
  home = false,
  serverId,
  sourceDirectory: sourceDirectoryProp,
  projectId,
  displayName: displayNameProp,
  draftId,
}: NewWorkspaceScreenProps) {
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const toast = useToast();
  const composerEditing = useNewWorkspaceComposerEditing();
  const { leaveFullscreen } = composerEditing;
  const mergeWorkspaces = useCallback(
    (targetServerId: string, workspaces: Iterable<WorkspaceDescriptor>) => {
      getHostRuntimeStore().acceptWorkspaceSnapshots(targetServerId, Array.from(workspaces));
    },
    [],
  );
  const {
    allHosts,
    selectedServerId,
    hostPickerOpen,
    handleSelectHost,
    handleHostPickerOpenChange,
    openHostPicker,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
  } = useNewWorkspaceInitialContext({
    serverId,
    sourceDirectory: sourceDirectoryProp,
    projectId,
    displayName: displayNameProp,
  });
  // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
  const supportsWorkspaceMultiplicity = useHostFeature(selectedServerId, "workspaceMultiplicity");
  const supportsForgeSearch = useHostFeature(selectedServerId, "forgeSearch");
  const [creationIdentity, setCreationIdentity] = useState(() => ({
    draftId: draftId ?? generateDraftId(),
    worktreeSlug: createNameId(),
  }));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creationResult, setCreationResult] = useState<
    WorkspaceCreationResult | { workspace: null }
  >({ workspace: null });
  const [pendingAction, setPendingAction] = useState<"chat" | "empty" | "terminal" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const openAddProjectPicker = useOpenAddProject();
  const [isolationPickerOpen, setIsolationPickerOpen] = useState(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState("");
  const [debouncedPickerSearchQuery, setDebouncedPickerSearchQuery] = useState("");
  const pickerAnchorRef = useRef<View>(null);
  const projectPickerAnchorRef = useRef<View>(null);
  const isolationPickerAnchorRef = useRef<View>(null);
  const hostPickerAnchorRef = useRef<View | null>(null);
  const isDraftHandoffActive = useIsNewWorkspaceDraftHandoffActive({ draftId, selectedServerId });
  const isStillOnCreateScreen = useNewWorkspaceScreenPresence(startScreenPath(home));

  // Launch target: what the composer submits to (chat agent, or a terminal
  // profile). Mirrors useWorkspaceIsolation's pattern below: the derived
  // value reads live from preferences until the user manually picks
  // something in this screen, so the async preferences load doesn't race a
  // frozen useState initializer.
  const { preferences: formPreferences, updatePreferences: updateFormPreferences } =
    useFormPreferences();
  const {
    selectedProject: pickedProject,
    selectedSourceDirectory: pickedDirectory,
    projectPickerOptions,
    projectByOptionId,
    selectedProjectOptionId: pickedOptionId,
    projectTriggerLabel: pickedLabel,
    handleSelectProjectOption: selectProjectOption,
  } = useNewWorkspaceProjectPicker({
    selectedServerId,
    projects,
    routeProject,
    routeProjectContextViewKey,
    lastActiveProject,
    allowAllProjects: supportsWorkspaceMultiplicity,
  });
  const {
    startKind,
    inferredStart,
    selectedBot,
    selectedProject,
    selectedSourceDirectory,
    selectedProjectOptionId,
    projectTriggerLabel,
    setStartTarget,
    setQuickProject,
    botQuery,
    quickStartsFeature,
  } = useStartDestination({
    selectedServerId,
    pickedProject,
    pickedDirectory,
    pickedOptionId,
    pickedLabel,
  });
  const quickChatRoot = useQuickChatRoot(selectedServerId);
  const quickChatPermitted = useQuickChatAllowed(selectedServerId);
  const quickChatAllowed = quickStartsFeature && quickChatPermitted;
  const currentStartDestination = useRef({ host: selectedServerId, kind: startKind });
  currentStartDestination.current = { host: selectedServerId, kind: startKind };
  const [pendingQuickStart, setPendingQuickStart] = useState<PendingStartTemplate | null>(null);
  const [templateBaseRequired, setTemplateBaseRequired] = useState(false);
  const [templateApplied, setTemplateApplied] = useState(false);
  // Clisbot Managed Access: only the profiles, and the shell, this Project grants.
  const {
    profiles: terminalProfiles,
    shell: terminalShellAllowed,
    canManageProfiles: canManageTerminalProfiles,
  } = useLaunchableTerminalProfiles(selectedServerId, selectedSourceDirectory);
  // Manual selection wins once the user picks something; until then the target
  // reads live from preferences so the async load can't race a frozen
  // initializer. Both go through `resolveLaunchTarget`, so a profile deleted
  // daemon-side falls back to chat rather than leaving a dead selection.
  const [manualLaunchTarget, setManualLaunchTarget] = useState<LaunchTarget | null>(null);
  const launchTarget = useMemo(
    () =>
      resolveLaunchTarget(
        manualLaunchTarget ?? formPreferences.launchTarget,
        terminalProfiles,
        terminalShellAllowed,
      ),
    [manualLaunchTarget, formPreferences.launchTarget, terminalProfiles, terminalShellAllowed],
  );
  const [terminalPromptText, setTerminalPromptText] = useState("");
  const {
    isTerminalLaunch,
    selectedTerminalProfile,
    terminalTakesPrompt,
    terminalComposerValue,
    terminalPlaceholder,
    terminalSubmitLabel,
    launchFocusKey,
  } = useTerminalComposerState({ launchTarget, terminalProfiles, terminalPromptText });
  const terminalTextSource = useMemo(
    () => ({
      getSnapshot: () => terminalComposerValue,
      subscribe: (_listener: () => void) => () => {},
    }),
    [terminalComposerValue],
  );
  const terminalTextReplacement = useMemo(
    () => ({ kind: "replace" as const, key: launchFocusKey, text: terminalComposerValue }),
    [launchFocusKey, terminalComposerValue],
  );

  useEffect(() => {
    const trimmed = pickerSearchQuery.trim();
    const timer = setTimeout(() => setDebouncedPickerSearchQuery(trimmed), 180);
    return () => clearTimeout(timer);
  }, [pickerSearchQuery]);

  const { workspace } = creationResult;
  const client = useHostRuntimeClient(selectedServerId);
  const isConnected = useHostRuntimeIsConnected(selectedServerId);
  const projectIconTargets = useMemo(
    () => buildNewWorkspaceProjectIconTargets(projects, selectedServerId),
    [projects, selectedServerId],
  );

  const projectIconDataByProjectViewKey = useProjectIcons({
    projects: projectIconTargets,
  });
  const draftKey = buildNewWorkspaceDraftKey(draftId);
  const forkDraftSetup = usePendingWorkspaceDraftSetup(draftId);
  const draftContextScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const visibleDraftContextScopeKeys = useMemo(
    () => resolveVisibleDraftContextScopeKeys({ isDraftHandoffActive, draftContextScopeKey }),
    [draftContextScopeKey, isDraftHandoffActive],
  );
  const chatDraft = useAgentInputDraft({
    draftKey,
    composer: buildComposerConfig({
      serverId: selectedServerId,
      workspaceDirectory: workspace?.workspaceDirectory ?? null,
      sourceDirectory: selectedSourceDirectory,
      initialSetup: forkDraftSetup?.setup,
    }),
  });
  const composerState = chatDraft.composerState;
  const [pickerSelection, dispatchPickerSelection] = useReducer(
    reducePickerSelection,
    initialPickerSelectionState,
  );
  const selectedItem = pickerSelection.selectedItem;

  const handleForgeChangeRequestDetected = useCallback(() => {
    dispatchPickerSelection({ type: "pr-detected" });
  }, []);

  const handleForgeChangeRequestAutoAttach = useCallback((item: ForgeSearchItem) => {
    dispatchPickerSelection({
      type: "pr-added",
      item: { kind: "github-pr", item },
    });
  }, []);

  const withConnectedClient = useCallback(() => {
    const connectedClient = getHostRuntimeStore().getClient(selectedServerId);
    if (!connectedClient?.isConnected) {
      throw new Error(t("newWorkspace.errors.hostDisconnected"));
    }
    return connectedClient;
  }, [selectedServerId, t]);

  const clientReady = useMemo(() => isConnected && Boolean(client), [isConnected, client]);
  const hasSelectedSourceDirectory = selectedSourceDirectory !== null;
  const pickerQueryEnabled = pickerOpen && clientReady && hasSelectedSourceDirectory;

  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId: selectedServerId,
    cwd: selectedSourceDirectory ?? "",
  });

  const worktreeSupport = startWorktreeSupport(selectedProject, selectedServerId);
  const isPending = isNewWorkspacePending({ pendingAction, isDraftHandoffActive });
  const { effectiveIsolation, setIsolation, canCreateWorktree, showRefPicker } =
    useWorkspaceIsolation({
      supportsMultiplicity: supportsWorkspaceMultiplicity,
      worktreeSupport: startKind === "project" ? worktreeSupport : "unsupported",
    });

  const branchSuggestionsQuery = useQuery({
    queryKey: [
      "branch-suggestions",
      selectedServerId,
      selectedSourceDirectory,
      debouncedPickerSearchQuery,
    ],
    queryFn: async () => {
      if (!selectedSourceDirectory) {
        throw new Error("Choose a project");
      }
      const connectedClient = withConnectedClient();
      return connectedClient.getBranchSuggestions({
        cwd: selectedSourceDirectory,
        query: debouncedPickerSearchQuery || undefined,
        limit: 20,
      });
    },
    enabled: pickerQueryEnabled,
    staleTime: 15_000,
  });

  const githubPrSearchQuery = useForgeSearchQuery({
    client,
    serverId: selectedServerId,
    cwd: selectedSourceDirectory ?? "",
    query: debouncedPickerSearchQuery,
    kinds: ["change_request"],
    supportsForgeSearch,
    enabled: pickerQueryEnabled,
  });

  const branchDetails = useMemo(
    () => normalizeBranchDetails(branchSuggestionsQuery.data),
    [branchSuggestionsQuery.data],
  );
  const forgeSearchAuthenticated =
    !githubPrSearchQuery.data || githubPrSearchQuery.data.authState === "authenticated";
  const prItems: ForgeSearchItem[] = useMemo(() => {
    if (!forgeSearchAuthenticated) return [];
    return githubPrSearchQuery.data?.items ?? [];
  }, [forgeSearchAuthenticated, githubPrSearchQuery.data?.items]);

  const baseItem = useMemo(
    () => selectedItem ?? (checkoutStatus ? defaultBasePickerItem(checkoutStatus) : null),
    [checkoutStatus, selectedItem],
  );
  const { options, itemById, selectedOptionId }: PickerOptionData = useMemo(
    () =>
      buildPickerOptionData({
        branchDetails,
        prItems,
        baseItem,
      }),
    [baseItem, branchDetails, prItems],
  );
  const triggerLabel = useMemo(() => {
    const displayItem = itemById.get(selectedOptionId);
    return displayItem ? pickerItemLabel(displayItem) : "main";
  }, [itemById, selectedOptionId]);
  const selectPickerItem = useCallback(
    (item: PickerItem) => {
      setTemplateBaseRequired(false);
      const nextAttachments = syncPickerPrAttachment({
        attachments: chatDraft.attachments,
        item,
      });

      dispatchPickerSelection({ type: "picker-selected", item });
      chatDraft.setAttachments(nextAttachments);
      setPickerOpen(false);
    },
    [chatDraft],
  );

  const handleSelectOption = useCallback(
    (id: string) => {
      const item = itemById.get(id);
      if (!item) return;
      selectPickerItem(item);
    },
    [itemById, selectPickerItem],
  );

  const clearPickerSelectionForTargetChange = useCallback(
    (currentTargetId: string, nextTargetId: string) => {
      const nextAttachments = clearPickerPrAttachmentForTargetChange({
        attachments: chatDraft.attachments,
        currentTargetId,
        nextTargetId,
      });
      if (nextAttachments === chatDraft.attachments) return;
      chatDraft.setAttachments(nextAttachments);
      dispatchPickerSelection({ type: "target-changed" });
    },
    [chatDraft],
  );

  const handleSelectProjectOption = useCallback(
    (id: string) => {
      // selectProjectOption enforces selectability (worktree-only when
      // multiplicity is off, any project when it's on); don't re-gate here on
      // canCreateWorktree or non-git projects become unselectable.
      setPendingQuickStart(null);
      setTemplateBaseRequired(false);
      setTemplateApplied(false);
      setStartTarget({ host: selectedServerId, kind: "project" });
      selectProjectOption(id);
      setProjectPickerOpen(false);
      clearPickerSelectionForTargetChange(selectedProjectOptionId, id);
    },
    [
      clearPickerSelectionForTargetChange,
      selectProjectOption,
      setStartTarget,
      selectedProjectOptionId,
      selectedServerId,
    ],
  );

  const handleSelectWorkspaceHost = useCallback(
    (id: string) => {
      setPendingQuickStart(null);
      setTemplateBaseRequired(false);
      setTemplateApplied(false);
      handleSelectHost(id);
      clearPickerSelectionForTargetChange(selectedServerId, id);
    },
    [clearPickerSelectionForTargetChange, handleSelectHost, selectedServerId],
  );

  const handleAddProject = useCallback(() => {
    setProjectPickerOpen(false);
    openAddProjectPicker(selectedServerId);
  }, [openAddProjectPicker, selectedServerId]);

  const handleAddHost = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const openProjectPicker = useCallback(() => {
    setProjectPickerOpen(true);
  }, []);

  // Cmd/Ctrl+P opens the project picker with its search focused so the user can
  // switch projects from the keyboard. Registered only while this screen is
  // mounted, so the shortcut doesn't swallow the browser's native print
  // elsewhere; gated on having projects to pick.
  const handleProjectPick = useCallback(() => {
    openProjectPicker();
    return true;
  }, [openProjectPicker]);
  useKeyboardActionHandler({
    handlerId: "new-workspace-project-pick",
    actions: PROJECT_PICK_ACTIONS,
    enabled: focused && projectPickerOptions.length > 0,
    priority: 0,
    handle: handleProjectPick,
  });

  const openIsolationPicker = useCallback(() => {
    setIsolationPickerOpen(true);
  }, []);

  const handleIsolationPickerOpenChange = useCallback((nextOpen: boolean) => {
    setIsolationPickerOpen(nextOpen);
  }, []);

  const handleClearDraft = useCallback(() => {
    // No-op: screen navigates away on success, text should stay for retry on error
  }, []);

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
    if (!nextOpen) {
      setPickerSearchQuery("");
    }
  }, []);

  const handleProjectPickerOpenChange = useCallback((nextOpen: boolean) => {
    setProjectPickerOpen(nextOpen);
  }, []);

  const ensureWorkspace = useCallback(
    async (input: {
      cwd: string;
      prompt: string;
      attachments: AgentAttachment[];
      withInitialAgent: boolean;
      agent?: CreateWorkspaceRequestOptions["agent"];
      onEvent?: (snapshot: CreationSnapshot) => void;
    }) => {
      if (creationResult.workspace) {
        return creationResult;
      }
      if (!selectedProject) {
        throw new Error("Choose a project");
      }
      if (!selectedSourceDirectory) {
        throw new Error("Choose a host for this project");
      }
      const connectedClient = withConnectedClient();
      if (templateBaseRequired)
        throw new Error("Choose a base branch or PR before starting this quick start.");
      const createsWorktree =
        startKind === "project" &&
        (!supportsWorkspaceMultiplicity || effectiveIsolation === "worktree");
      const checkoutStatusForCreate = createsWorktree
        ? await ensureCheckoutStatus({
            queryClient,
            client: connectedClient,
            serverId: selectedServerId,
            cwd: selectedSourceDirectory,
          })
        : null;
      const checkoutRequest = checkoutStatusForCreate
        ? pickerItemToCheckoutRequest(
            selectedItem ?? defaultBasePickerItem(checkoutStatusForCreate),
          )
        : undefined;
      const normalizedWorkspace = await createMultiplicityWorkspace({
        idempotencyKey: creationIdentity.draftId,
        worktreeSlug: creationIdentity.worktreeSlug,
        client: connectedClient,
        isolation: createsWorktree ? "worktree" : "local",
        project: selectedProject,
        sourceDirectory: selectedSourceDirectory,
        checkoutRequest,
        withInitialAgent: input.withInitialAgent,
        prompt: input.prompt,
        attachments: input.attachments,
        agent: input.agent,
        onEvent: input.onEvent,
        mergeWorkspaces,
        serverId: selectedServerId,
        createFailedMessage: t("newWorkspace.errors.createWorktreeFailed"),
      });
      setCreationResult(normalizedWorkspace);
      return normalizedWorkspace;
    },
    [
      creationIdentity,
      creationResult,
      startKind,
      templateBaseRequired,
      effectiveIsolation,
      mergeWorkspaces,
      queryClient,
      selectedItem,
      selectedProject,
      selectedServerId,
      selectedSourceDirectory,
      supportsWorkspaceMultiplicity,
      t,
      withConnectedClient,
    ],
  );

  const { configurationProblem, acceptCurrent } = useStartTemplate({
    focused,
    pending: pendingQuickStart,
    setPending: setPendingQuickStart,
    draft: chatDraft,
    composer: composerState,
    directory: selectedSourceDirectory,
    kind: startKind,
    bot: selectedBot,
    project: selectedProject,
    serverId: selectedServerId,
    preferences: formPreferences,
    worktreeSupport,
    setIsolation,
    setBaseRequired: setTemplateBaseRequired,
    setPickerOpen,
    setError: setErrorMessage,
    dispatchPicker: dispatchPickerSelection,
  });
  const handleSubmitNewWorkspace = useCallback(
    async (payload: MessagePayload) => {
      try {
        setErrorMessage(null);
        if (pendingQuickStart?.serverId === selectedServerId)
          throw new Error("Wait for the destination and agent configuration to load.");
        if (configurationProblem)
          throw new Error(
            configurationProblem + " Choose settings and confirm Use current settings.",
          );
        if (home) rememberChatReturn("/open-project");
        if (!templateApplied) await composerState?.persistFormPreferences();
        await updateFormPreferences({ launchTarget });
        if (startKind === "bot") {
          if (!quickStartsFeature)
            throw new Error("Update this Host to start a bot chat with these agent settings.");
          const clearConsumedDraft = captureWorkspaceDraftCleanup({
            draftId: creationIdentity.draftId,
            draftKey,
            clearDraft: chatDraft.clear,
            draftContextScopeKey,
          });
          if (!selectedBot || !composerState?.selectedProvider)
            throw new Error("Choose a bot and an available provider.");
          setPendingAction("chat");
          const wire = splitComposerAttachmentsForSubmit(payload.attachments, {
            format: resolveComposerAttachmentSubmitFormat({
              supportsForgeAttachments: supportsForgeSearch,
            }),
          });
          const result = await withConnectedClient().createChat({
            botIds: [selectedBot.id],
            kind: "direct",
            idempotencyKey: creationIdentity.draftId,
            launch: composerLaunch(composerState),
            firstMessage: {
              text: payload.text,
              images: await encodeImages(wire.images),
              attachments: wire.attachments,
              messageId: `${creationIdentity.draftId}:initial-message`,
            },
          });
          if (result.error || !result.chat)
            throw new Error(result.error ?? "Could not create chat.");
          clearConsumedDraft();
          setCreationIdentity({ draftId: generateDraftId(), worktreeSlug: createNameId() });
          setPendingAction(null);
          if (isStillOnCreateScreen()) {
            leaveFullscreen();
            router.push(buildHostChatRoute(selectedServerId, result.chat.id));
          }
          return;
        }
        if (isEmptyWorkspaceSubmission(payload)) {
          setPendingAction("empty");
          await runCreateEmptyWorkspace({
            payload,
            ensureWorkspace: async (request) => (await ensureWorkspace(request)).workspace,
            serverId: selectedServerId,
            navigate: (targetServerId, workspaceId) => {
              if (!isStillOnCreateScreen()) {
                return;
              }
              leaveFullscreen();
              navigateToWorkspace({ serverId: targetServerId, workspaceId });
            },
          });
          // Nothing navigated, so this screen may still be mounted under another route. Release
          // the pending lock it would otherwise keep forever.
          setCreationResult({ workspace: null });
          setCreationIdentity({ draftId: generateDraftId(), worktreeSlug: createNameId() });
          setPendingAction(null);
          return;
        }

        setPendingAction("chat");
        const outcome = await runCreateChatAgent({
          payload,
          composerState,
          forkDraftSetup,
          ensureWorkspace,
          serverId: selectedServerId,
          clearDraft: chatDraft.clear,
          draftKey,
          draftId: creationIdentity.draftId,
          draftContextScopeKey,
          supportsForgeSearch,
          resolveClient: withConnectedClient,
          isStillOnCreateScreen,
          labels: {
            composerStateRequired: t("newWorkspace.errors.composerStateRequired"),
            selectModel: t("newWorkspace.errors.selectModel"),
          },
        });
        if (outcome === "navigated") leaveFullscreen();
        setCreationResult({ workspace: null });
        setCreationIdentity({ draftId: generateDraftId(), worktreeSlug: createNameId() });
        setPendingAction(null);
      } catch (error) {
        const message = toErrorMessage(error);
        setPendingAction(null);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [
      composerState,
      home,
      pendingQuickStart,
      configurationProblem,
      templateApplied,
      startKind,
      quickStartsFeature,
      selectedBot,
      draftContextScopeKey,
      creationIdentity,
      chatDraft,
      draftKey,
      ensureWorkspace,
      forkDraftSetup,
      isStillOnCreateScreen,
      launchTarget,
      leaveFullscreen,
      selectedServerId,
      supportsForgeSearch,
      t,
      toast,
      updateFormPreferences,
      withConnectedClient,
    ],
  );

  const handleSubmitTerminalLaunch = useCallback(async () => {
    try {
      setErrorMessage(null);
      await updateFormPreferences({ launchTarget });
      setPendingAction("terminal");

      await runCreateTerminalWorkspace({
        cwd: selectedSourceDirectory ?? "",
        prompt: terminalPromptText,
        profile: selectedTerminalProfile,
        profileName: selectedTerminalProfile?.name,
        ensureWorkspace: async (request) => (await ensureWorkspace(request)).workspace,
        createTerminal: async (input) => {
          const connectedClient = withConnectedClient();
          const createdTerminal = await connectedClient.createTerminal(
            input.workspaceDirectory,
            input.name,
            undefined,
            {
              command: input.command,
              args: input.args,
              workspaceId: input.workspaceId,
              ...(input.profileId === undefined
                ? {}
                : { profileId: input.profileId, prompt: input.prompt }),
            },
          );
          const terminal = createdTerminal.terminal;
          if (!terminal) {
            throw new Error(createdTerminal.error ?? t("newWorkspace.errors.createWorktreeFailed"));
          }
          queryClient.setQueryData<ListTerminalsPayload>(
            buildTerminalsQueryKey(selectedServerId, input.workspaceDirectory, input.workspaceId),
            (current) =>
              upsertCreatedTerminalPayload({
                current,
                terminal,
                workspaceDirectory: input.workspaceDirectory,
              }),
          );
          return { terminalId: terminal.id };
        },
        sendTerminalInput: (terminalId, data) => {
          withConnectedClient().sendTerminalInput(terminalId, { type: "input", data });
        },
        serverId: selectedServerId,
        // The terminal is spawned and fed its command before this runs, so skipping the
        // navigation costs nothing: it is standalone, and `reconcileTabs` auto-opens standalone
        // terminals when the workspace is next visited.
        navigate: (targetServerId, workspaceId, target) => {
          if (!isStillOnCreateScreen()) {
            return;
          }
          leaveFullscreen();
          navigateToWorkspace({ serverId: targetServerId, workspaceId, target });
        },
      });
      setCreationResult({ workspace: null });
      setCreationIdentity({ draftId: generateDraftId(), worktreeSlug: createNameId() });
      setPendingAction(null);
    } catch (error) {
      const message = toErrorMessage(error);
      setPendingAction(null);
      setErrorMessage(message);
      toast.error(message);
    }
  }, [
    ensureWorkspace,
    isStillOnCreateScreen,
    launchTarget,
    queryClient,
    selectedServerId,
    selectedSourceDirectory,
    selectedTerminalProfile,
    t,
    terminalPromptText,
    toast,
    leaveFullscreen,
    updateFormPreferences,
    withConnectedClient,
  ]);

  const agentControlsWithDisabled = useMemo(
    () =>
      composerState
        ? {
            ...composerState.agentControls,
            disabled: isPending,
          }
        : undefined,
    [composerState, isPending],
  );

  const pickerEmptyText =
    branchSuggestionsQuery.isFetching || githubPrSearchQuery.isFetching
      ? t("newWorkspace.refPicker.searching")
      : t("newWorkspace.refPicker.noMatchingRefs");

  const prepareQuickChat = useCallback(async () => {
    const host = selectedServerId;
    setPendingQuickStart(null);
    setTemplateBaseRequired(false);
    setTemplateApplied(false);
    acceptCurrent();
    setStartTarget({ host, kind: "quickChat" });
    setProjectPickerOpen(false);
    setErrorMessage(null);
    try {
      const c = getHostRuntimeStore().getClient(host);
      if (!c || !quickStartsFeature)
        throw new Error("Connect or update this Host to use Quick chat.");
      const result = await c.prepareQuickChat();
      if (result.error || !result.cwd || !result.projectId)
        throw new Error(result.error ?? "Unable to prepare Quick chat");
      if (
        currentStartDestination.current.host === host &&
        currentStartDestination.current.kind === "quickChat"
      )
        setQuickProject({ host, cwd: result.cwd, projectId: result.projectId });
    } catch (error) {
      if (
        currentStartDestination.current.host === host &&
        currentStartDestination.current.kind === "quickChat"
      )
        setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [selectedServerId, setStartTarget, setQuickProject, quickStartsFeature, acceptCurrent]);
  // With several Hosts every picker row names its Host, the selected one included.
  const currentHostLabel = hostLabelWhenSeveral(allHosts, selectedServerId);
  const destinations = useMemo(
    () =>
      buildStartDestinations({
        quickChat: quickChatAllowed,
        quickChatRoot,
        serverId: selectedServerId,
        projects: projectPickerOptions,
        byOption: projectByOptionId,
        icons: projectIconDataByProjectViewKey,
        bots: botQuery.data ?? [],
        hostLabel: currentHostLabel,
      }),
    [
      currentHostLabel,
      quickChatAllowed,
      quickChatRoot,
      selectedServerId,
      projectPickerOptions,
      projectByOptionId,
      projectIconDataByProjectViewKey,
      botQuery.data,
    ],
  );
  const selectDestination = useCallback(
    (id: string) => {
      dispatchPickerSelection({ type: "target-changed" });
      setPendingQuickStart(null);
      setTemplateApplied(false);
      acceptCurrent();
      setTemplateBaseRequired(false);
      setErrorMessage(null);
      if (id === "quickChat") {
        void prepareQuickChat();
        return;
      }
      if (id.startsWith("bot:")) {
        const bot = botQuery.data?.find((entry) => `bot:${entry.id}` === id);
        if (!bot) return;
        setStartTarget({ host: selectedServerId, kind: "bot", botId: bot.id });
        setPendingQuickStart({
          serverId: selectedServerId,
          template: {
            name: bot.name,
            visibility: "personal",
            target: { kind: "bot", botId: bot.id },
            startingPrompt: chatDraft.textSource.getSnapshot(),
            agent: { kind: "configured", config: bot.launch },
          },
        });
        setProjectPickerOpen(false);
        return;
      }
      handleSelectProjectOption(id);
    },
    [
      prepareQuickChat,
      acceptCurrent,
      botQuery.data,
      selectedServerId,
      setStartTarget,
      chatDraft.textSource,
      handleSelectProjectOption,
    ],
  );
  const crossHost = useCrossHostPicker({
    enabled: HOME_V2_ENABLED && focused,
    selectedServerId,
    hosts: allHosts,
    projects,
    icons: projectIconDataByProjectViewKey,
    current: destinations,
    selectHost: handleSelectWorkspaceHost,
    selectCurrent: selectDestination,
  });
  const snapshotQuickStart = useCallback((): QuickStartInput | null => {
    const destination = destinations.find((entry) => entry.option.id === selectedProjectOptionId);
    return destination
      ? snapshotStart(
          destination.target,
          chatDraft.textSource.getSnapshot(),
          composerState,
          effectiveIsolation,
          selectedItem,
        )
      : null;
  }, [
    destinations,
    selectedProjectOptionId,
    chatDraft.textSource,
    composerState,
    effectiveIsolation,
    selectedItem,
  ]);
  const applyQuickStart = useCallback(
    (item: QuickStartInput) => {
      const destination = findDestination(destinations, item.target);
      if (!destination) {
        setErrorMessage("This destination is unavailable. Choose another destination.");
        return;
      }
      selectDestination(destination.option.id);
      setPendingQuickStart({ serverId: selectedServerId, template: item });
      setTemplateApplied(true);
      setManualLaunchTarget({ kind: "chat" });
    },
    [destinations, selectDestination, selectedServerId],
  );
  // Reopening Home after a Bot chat restores that Bot with its own agent settings, through the
  // same selection a pick makes; inference alone would launch it with the composer's settings.
  const restoredBot = useRef<string | null>(null);
  useEffect(() => {
    if (!focused || !inferredStart || startKind !== "bot" || !selectedBot) return;
    const key = `${selectedServerId}:${selectedBot.id}`;
    if (restoredBot.current === key) return;
    restoredBot.current = key;
    selectDestination(`bot:${selectedBot.id}`);
  }, [focused, inferredStart, startKind, selectedBot, selectedServerId, selectDestination]);
  const chooseStart = useCallback(
    (kind: "quickChat" | "project" | "bot") => {
      setManualLaunchTarget({ kind: "chat" });
      if (kind === "quickChat") {
        void prepareQuickChat();
        return;
      }
      // The mode changes on the tap; the picker then asks which Project or Bot.
      setPendingQuickStart(null);
      setTemplateApplied(false);
      setTemplateBaseRequired(false);
      acceptCurrent();
      setErrorMessage(null);
      setStartTarget({
        host: selectedServerId,
        kind,
        botId: kind === "bot" ? selectedBot?.id : undefined,
      });
      setProjectPickerOpen(true);
    },
    [prepareQuickChat, acceptCurrent, setStartTarget, selectedServerId, selectedBot],
  );
  const startMark = useMemo(
    () =>
      HOME_V2_ENABLED && startKind !== "project"
        ? destinations
            .find((entry) => entry.option.id === selectedProjectOptionId)
            ?.mark?.(ICON_SIZE.md)
        : undefined,
    [destinations, selectedProjectOptionId, startKind],
  );
  const projectMark = useMemo(
    () =>
      startKind === "project" && selectedProject ? (
        <ProjectIconView
          iconDataUri={projectIconDataByProjectViewKey.get(selectedProject.viewKey) ?? null}
          initial={(projectTriggerLabel.charAt(0) || "?").toUpperCase()}
          projectViewKey={selectedProject.viewKey}
          size={ICON_SIZE.md}
          textStyle={styles.projectIconFallbackText}
        />
      ) : undefined,
    [startKind, selectedProject, projectIconDataByProjectViewKey, projectTriggerLabel],
  );
  useQuickChatByDefault({
    focused,
    inferred: inferredStart,
    supported: quickChatAllowed,
    serverId: selectedServerId,
    kind: startKind,
    hasOrdinaryProject: destinations.some((entry) => entry.option.group === "Projects"),
    prepare: prepareQuickChat,
  });
  const quickChat = useCallback(() => chooseStart("quickChat"), [chooseStart]);
  const choices = useMemo(
    () => (
      <StartSwitcher
        kind={startKind}
        size={isCompact ? "md" : "sm"}
        disabled={isPending}
        label={projectTriggerLabel}
        mark={startKind === "project" ? projectMark : startMark}
        anchorRef={projectPickerAnchorRef}
        quickChat={quickChatAllowed}
        onQuickChat={quickChat}
        onPick={chooseStart}
      />
    ),
    [
      startKind,
      isCompact,
      isPending,
      projectTriggerLabel,
      projectMark,
      startMark,
      quickChatAllowed,
      quickChat,
      chooseStart,
    ],
  );
  const quickStarts = useMemo(
    () => (
      <QuickStarts
        key={selectedServerId}
        serverId={selectedServerId}
        destinations={destinations}
        snapshot={snapshotQuickStart}
        onApply={applyQuickStart}
      />
    ),
    [selectedServerId, destinations, snapshotQuickStart, applyQuickStart],
  );
  const renderStartOption = useCallback(
    (props: Parameters<NonNullable<ComboboxProps["renderOption"]>>[0]) => (
      <StartDestinationOption {...props} destinations={crossHost.destinations} />
    ),
    [crossHost.destinations],
  );
  const addBotFromProjectPicker = useCallback(() => {
    useCreationRequest.getState().ask("bot");
    handleProjectPickerOpenChange(false);
  }, [handleProjectPickerOpenChange]);
  const selectIsolation = useCallback(
    (isolation: "local" | "worktree") => {
      setIsolation(isolation);
      if (isolation === "local") {
        setTemplateBaseRequired(false);
        setErrorMessage(null);
      }
    },
    [setIsolation],
  );
  const formStack = useNewWorkspaceForm({
    home: HOME_V2_ENABLED,
    isCompact,
    isPending,
    project: {
      anchorRef: projectPickerAnchorRef,
      open: openProjectPicker,
      ...startPicker(
        { options: orderStartOptions(crossHost.destinations, startKind), onSelect: crossHost.pick },
        { options: projectPickerOptions, onSelect: handleSelectProjectOption },
      ),
      triggerLabel: projectTriggerLabel,
      projectByOptionId,
      selectedServerId,
      supportsWorkspaceMultiplicity,
      iconDataByProjectViewKey: projectIconDataByProjectViewKey,
      selectedProject,
      selectedOptionId: selectedProjectOptionId,
      onAddProject: handleAddProject,
      openState: projectPickerOpen,
      onOpenChange: handleProjectPickerOpenChange,
      onAddBot: HOME_V2_ENABLED ? addBotFromProjectPicker : undefined,
      renderOption: HOME_V2_ENABLED ? renderStartOption : undefined,
    },
    host: {
      anchorRef: hostPickerAnchorRef,
      open: openHostPicker,
      openState: hostPickerOpen,
      onOpenChange: handleHostPickerOpenChange,
      allHosts,
      selectedServerId,
      onSelect: handleSelectWorkspaceHost,
      onAddHost: handleAddHost,
    },
    isolation: {
      anchorRef: isolationPickerAnchorRef,
      open: openIsolationPicker,
      openState: isolationPickerOpen,
      onOpenChange: handleIsolationPickerOpenChange,
      effectiveIsolation,
      canCreateWorktree,
      onSelect: selectIsolation,
    },
    base: {
      anchorRef: pickerAnchorRef,
      open: openPicker,
      openState: pickerOpen,
      onOpenChange: handlePickerOpenChange,
      selectedSourceDirectory,
      selectedItem,
      triggerLabel,
      options,
      itemById,
      selectedOptionId,
      onSelect: handleSelectOption,
      setSearchQuery: setPickerSearchQuery,
      emptyText: pickerEmptyText,
      showRefPicker,
    },
    launch: {
      serverId: selectedServerId,
      target: launchTarget,
      onChange: setManualLaunchTarget,
      profiles: terminalProfiles,
      shell: terminalShellAllowed,
      canManageProfiles: canManageTerminalProfiles,
      disabled: isPending,
    },
  });

  const importSession = useImportSession({ serverId: selectedServerId });

  const isComposerFullscreen = composerEditing.isFullscreen(isTerminalLaunch);
  const composer = useMemo(
    () =>
      isTerminalLaunch ? (
        <Composer
          key={`terminal:${creationIdentity.draftId}`}
          editingSession={composerEditing.terminal}
          inputMode="terminal"
          readOnly={!terminalTakesPrompt}
          placeholder={terminalPlaceholder}
          submitLabel={terminalSubmitLabel}
          agentId={draftKey}
          serverId={selectedServerId}
          isPaneFocused={focused}
          onSubmitMessage={handleSubmitTerminalLaunch}
          allowEmptySubmit={true}
          submitButtonAccessibilityLabel={t("newWorkspace.launch.submit")}
          submitButtonTestID="new-workspace-launch-submit"
          isSubmitLoading={isPending}
          submitBehavior="preserve-and-lock"
          blurOnSubmit={true}
          textSource={terminalTextSource}
          onChangeText={setTerminalPromptText}
          textReplacement={terminalTextReplacement}
          attachments={NO_TERMINAL_ATTACHMENTS}
          onChangeAttachments={noopChangeAttachments}
          cwd={selectedSourceDirectory ?? ""}
          clearDraft={noopClearDraft}
          autoFocus={terminalTakesPrompt}
          autoFocusKey={launchFocusKey}
        />
      ) : (
        <Composer
          key={`chat:${creationIdentity.draftId}`}
          editingSession={composerEditing.chat}
          agentId={draftKey}
          serverId={selectedServerId}
          isPaneFocused={focused}
          onSubmitMessage={handleSubmitNewWorkspace}
          allowEmptySubmit={true}
          submitButtonAccessibilityLabel={t("newWorkspace.create")}
          submitButtonTestID="workspace-create-submit"
          submitIcon="return"
          isSubmitLoading={isPending}
          waitForForgeAutoAttachOnSubmit
          submitBehavior="preserve-and-lock"
          blurOnSubmit={true}
          textSource={chatDraft.textSource}
          onChangeText={chatDraft.editText}
          textReplacement={chatDraft.textReplacement}
          attachments={chatDraft.attachments}
          attachmentScopeKeys={visibleDraftContextScopeKeys}
          onChangeAttachments={chatDraft.setAttachments}
          onForgeChangeRequestDetected={handleForgeChangeRequestDetected}
          onForgeChangeRequestAutoAttach={handleForgeChangeRequestAutoAttach}
          cwd={selectedSourceDirectory ?? ""}
          clearDraft={handleClearDraft}
          autoFocus={!home}
          autoFocusKey={launchFocusKey}
          commandDraft={composerState?.commandDraft}
          agentControls={agentControlsWithDisabled}
        />
      ),
    [
      isTerminalLaunch,
      creationIdentity.draftId,
      focused,
      terminalTakesPrompt,
      terminalPlaceholder,
      terminalSubmitLabel,
      draftKey,
      selectedServerId,
      handleSubmitTerminalLaunch,
      t,
      isPending,
      terminalTextSource,
      setTerminalPromptText,
      terminalTextReplacement,
      selectedSourceDirectory,
      launchFocusKey,
      handleSubmitNewWorkspace,
      chatDraft,
      visibleDraftContextScopeKeys,
      handleForgeChangeRequestDetected,
      handleForgeChangeRequestAutoAttach,
      handleClearDraft,
      home,
      composerState,
      agentControlsWithDisabled,
      composerEditing.terminal,
      composerEditing.chat,
    ],
  );
  const feedback = useMemo(
    () => (
      <StartFeedback
        error={errorMessage}
        configurationProblem={configurationProblem}
        onAccept={acceptCurrent}
      />
    ),
    [errorMessage, configurationProblem, acceptCurrent],
  );
  const composerWithFeedback = useMemo(
    () => (
      <>
        {composer}
        {feedback}
      </>
    ),
    [composer, feedback],
  );
  // Retain selection/draft state in the navigation stack, but mount only the foreground
  // composer: attachments, keyboard shortcuts and upload ownership have one active UI owner.
  if (!focused) return null;
  return (
    <FileDropZone style={styles.container}>
      <NewWorkspacePresentation
        home={home}
        compact={isCompact}
        fullscreen={isComposerFullscreen}
        choices={choices}
        form={formStack}
        composer={composerWithFeedback}
        quickStarts={quickStarts}
        serverId={selectedServerId}
        onImportSession={importSession.open}
      />
      {importSession.sheet}
    </FileDropZone>
  );
}

function NewWorkspacePresentation({
  home,
  compact,
  fullscreen,
  choices,
  form,
  composer,
  quickStarts,
  serverId,
  onImportSession,
}: {
  home: boolean;
  compact: boolean;
  fullscreen: boolean;
  choices: ReactNode;
  form: ReactNode;
  composer: ReactElement;
  quickStarts: ReactNode;
  serverId: string;
  onImportSession: () => void;
}) {
  const { t } = useTranslation();
  return HOME_V2_ENABLED ? (
    <>
      {fullscreen ? null : <StartScreenHeader home={home} />}
      <View style={styles.content}>
        {fullscreen ? (
          <ComposerDock fullscreen>
            {null}
            {composer}
          </ComposerDock>
        ) : (
          <StartLayout
            navigationHome={NAVIGATION_V2_ENABLED && home}
            compact={compact}
            title={startTitle(home, t)}
            choices={choices}
            form={form}
            composer={composer}
            quickStarts={quickStarts}
            serverId={serverId}
            showActivity={home}
            onImportSession={onImportSession}
          />
        )}
      </View>
    </>
  ) : (
    <NewWorkspaceLayout
      isCompact={compact}
      fullscreen={fullscreen}
      title={t("newWorkspace.title")}
      formStack={form}
      onImportSession={onImportSession}
    >
      {composer}
    </NewWorkspaceLayout>
  );
}

/** Navigation V2's Home owns its own layout; New workspace and the Home V2 Home share this one. */
function StartLayout({
  navigationHome,
  ...props
}: Parameters<typeof HomeStartLayout>[0] & { navigationHome: boolean }) {
  return navigationHome ? <NavigationHomeLayout {...props} /> : <HomeStartLayout {...props} />;
}

/** Home names itself in the header; New workspace keeps its title in the page. */
/** With several Hosts, the name every picker row carries; none when there is only one. */
function hostLabelWhenSeveral(hosts: HostProfile[], serverId: string): string | undefined {
  if (hosts.length < 2) return undefined;
  return hosts.find((host) => host.serverId === serverId)?.label;
}

/** Home's destination picker spans Hosts and Bots; the legacy picker lists this Host's projects. */
function startPicker<T>(home: T, legacy: T): T {
  return HOME_V2_ENABLED ? home : legacy;
}

function StartScreenHeader({ home }: { home: boolean }) {
  if (HOME_V2_ENABLED && home) return <HomeHeader />;
  return <MenuHeader borderless />;
}

function startTitle(home: boolean, t: TFunction): string {
  return home ? "Where would you like to start?" : t("newWorkspace.title");
}

/** Terminal and chat launches edit in separate sessions; the screen follows the mounted one. */
function useNewWorkspaceComposerEditing() {
  const terminal = useComposerEditingSession("terminal");
  const chat = useComposerEditingSession("chat");
  const isTerminalFullscreen = useComposerFullscreen(terminal);
  const isChatFullscreen = useComposerFullscreen(chat);
  // The sessions outlive the screen (its draft keeps them), so a launch that leaves
  // the screen also leaves fullscreen; the next draft starts inline.
  const leaveFullscreen = useCallback(() => {
    terminal.setFullscreen(false);
    chat.setFullscreen(false);
  }, [chat, terminal]);
  return {
    terminal,
    chat,
    leaveFullscreen,
    isFullscreen: (isTerminalLaunch: boolean) =>
      isTerminalLaunch ? isTerminalFullscreen : isChatFullscreen,
  };
}

function NewWorkspaceLayout({
  isCompact,
  fullscreen,
  title,
  formStack,
  onImportSession,
  children,
}: {
  isCompact: boolean;
  /** The composer covers the screen; the header leaves and the dock fills the content. */
  fullscreen: boolean;
  title: string;
  formStack: ReactNode;
  onImportSession: () => void;
  children: ReactNode;
}) {
  // In the header on compact layouts, under the composer otherwise.
  const importSessionButton = <ImportSessionButton compact={isCompact} onPress={onImportSession} />;
  // Compact has no title: the fields name themselves. The free space above pushes them down onto
  // the composer, where the thumb is.
  const setupFields = isCompact ? (
    <>
      <View style={styles.compactSetupSpace} pointerEvents="none" />
      {formStack}
    </>
  ) : (
    <>
      <View style={styles.composerTitleContainer} pointerEvents="none">
        <Text style={styles.composerTitle}>{title}</Text>
      </View>
      {formStack}
    </>
  );
  return (
    <>
      {fullscreen ? null : (
        <MenuHeader borderless rightContent={isCompact ? importSessionButton : undefined} />
      )}
      <View style={styles.content}>
        <TitlebarDragRegion />
        <ComposerDock centered={!isCompact} fullscreen={fullscreen}>
          {setupFields}
          <>
            {children}
            {isCompact || fullscreen ? null : importSessionButton}
          </>
        </ComposerDock>
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  projectIconFallbackText: { fontSize: 10, fontWeight: theme.fontWeight.semibold },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
  },
  compactSetupSpace: {
    flex: 1,
  },
  composerTitleContainer: {
    marginBottom: theme.spacing[8],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[4],
  },
  composerTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    lineHeight: 20,
  },
}));

function startWorktreeSupport(project: HostProjectListItem | null, serverId: string) {
  return project ? getWorktreeSupportForHostProject({ project, serverId }) : "unsupported";
}
