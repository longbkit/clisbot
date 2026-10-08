import type { OwnedSubscription } from "./connection/index.js";
export type { OwnedSubscription, SubscriptionObserver } from "./connection/index.js";
import type { DaemonClientConfig } from "./daemon-client.js";
import type { AgentPermissionResponse } from "@clisbot/protocol/agent-types";
import type {
  AgentSnapshotPayload,
  CreationSnapshot,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListCommandsResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ProjectListRequestMessage,
  ProjectListResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProviderUsageListResponseMessage,
  ProjectPlacementPayload,
  WorkspaceProjectDescriptorPayload,
  RefreshProvidersSnapshotResponseMessage,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
  WorkspaceCreateRequest,
} from "@clisbot/protocol/messages";
import { DaemonClient, type CreateAgentRequestOptions } from "./daemon-client.js";
import {
  createTerminalActions,
  type ClisbotTerminalActions,
  type ClisbotWorkspaceTerminalActions,
} from "./terminals/index.js";
export type {
  ClisbotTerminal,
  ClisbotTerminalActions,
  ClisbotTerminalHandle,
  ClisbotTerminalCreateOptions,
  ClisbotTerminalListOptions,
  ClisbotTerminalListResult,
  ClisbotTerminalCaptureOptions,
  ClisbotTerminalCaptureResult,
  ClisbotWorkspaceTerminalActions,
} from "./terminals/index.js";
import type { PluginTimelineItem } from "@clisbot/protocol/agent-types";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  SendMessageOptions,
  WaitForFinishResult,
} from "./daemon-client.js";

/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface ClisbotLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ClisbotClientConfig {
  capabilities?: DaemonClientConfig["capabilities"];
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: ClisbotLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type ClisbotWorkspace = WorkspaceDescriptorPayload;
export type ClisbotAgent = AgentSnapshotPayload;
export type ClisbotAgentListOptions = FetchAgentsOptions;
export type ClisbotProject = WorkspaceProjectDescriptorPayload;
export type ClisbotProjectListOptions = Omit<ProjectListRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};
export type ClisbotProjectListResult = ProjectListResponseMessage["payload"];
export type ClisbotProjectUpdate = Extract<
  SessionOutboundMessage,
  { type: "project.update" }
>["payload"];
export type ClisbotProjectUpdateHandler = (update: ClisbotProjectUpdate) => void;

export interface ClisbotAgentListResult {
  subscription?: OwnedSubscription<ClisbotAgentListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
export type ClisbotWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface ClisbotWorkspaceListResult {
  subscription?: OwnedSubscription<ClisbotWorkspaceListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: ClisbotWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface ClisbotWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export type ClisbotWorkspaceCreateOptions = Omit<
  WorkspaceCreateRequest,
  "type" | "requestId" | "agent" | "subscribe"
> & {
  requestId?: string;
  agent?: Omit<
    ClisbotAgentCreateOptions,
    "worktree" | "git" | "onEvent" | "idempotencyKey" | "requestId"
  >;
  onEvent?: (snapshot: CreationSnapshot) => void;
};

export interface ClisbotWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type ClisbotWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type ClisbotWorkspaceUpdateHandler = (update: ClisbotWorkspaceUpdate) => void;

export interface ClisbotWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: ClisbotWorkspace["status"] | null;
  readonly agents: {
    create(options: ClisbotWorkspaceAgentCreateOptions): Promise<ClisbotAgentHandle>;
  };
  readonly terminals: ClisbotWorkspaceTerminalActions;
  current(): ClisbotWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<ClisbotWorkspace | null>;
  setTitle(title: string | null, requestId?: string): Promise<{ title: string | null }>;
  archive(requestId?: string): Promise<ClisbotWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: ClisbotWorkspaceUpdate) => void): () => void;
}

export interface ClisbotProjectActions {
  list(options?: ClisbotProjectListOptions): Promise<ClisbotProjectListResult>;
  subscribe(handler: ClisbotProjectUpdateHandler): () => void;
}

export interface ClisbotWorkspaceActions {
  list(options: ClisbotWorkspaceListOptions & { subscribe: {} }): Promise<
    ClisbotWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<ClisbotWorkspaceListResult>;
    }
  >;
  list(options?: ClisbotWorkspaceListOptions): Promise<ClisbotWorkspaceListResult>;
  ref(workspace: string | ClisbotWorkspace): ClisbotWorkspaceHandle;
  open(
    input: string | ClisbotWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<ClisbotWorkspaceHandle>;
  create(options: ClisbotWorkspaceCreateOptions): Promise<ClisbotWorkspaceHandle>;
  archive(
    workspace: string | ClisbotWorkspaceHandle,
    requestId?: string,
  ): Promise<ClisbotWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ClisbotWorkspaceUpdateHandler): () => void;
}

type ClisbotAgentSessionConfig = CreateAgentRequestMessage["config"];
export type ClisbotAgentProvider = ClisbotAgentSessionConfig["provider"];

export type ClisbotProviderFeatureValues = Record<string, unknown>;

export interface ClisbotAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: ClisbotAgentSessionConfig["modeId"];
  thinkingOptionId?: ClisbotAgentSessionConfig["thinkingOptionId"];
  featureValues?: ClisbotProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: ClisbotAgentSessionConfig["providerOptions"];
  systemPrompt?: ClisbotAgentSessionConfig["systemPrompt"];
  toolPolicy?: ClisbotAgentSessionConfig["toolPolicy"];
  mcpServers?: ClisbotAgentSessionConfig["mcpServers"];
}

export interface ClisbotAgentCreateOptions {
  idempotencyKey?: string;
  agentId?: string;
  onEvent?: (snapshot: CreationSnapshot) => void;
  config: ClisbotAgentConfig;
  cwd: string;
  parent?: string | ClisbotAgentHandle;
  title?: ClisbotAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type ClisbotWorkspaceAgentCreateOptions = Omit<ClisbotAgentCreateOptions, "cwd">;

export interface ClisbotAgentRefetchResult {
  agent: ClisbotAgent;
  project: ProjectPlacementPayload | null;
}

export interface ClisbotAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export type ClisbotAgentSendOptions = SendMessageOptions;

export interface ClisbotAgentRunOptions extends ClisbotAgentSendOptions {
  timeoutMs?: number;
}

export type ClisbotAgentRunResult = WaitForFinishResult;
export type ClisbotAgentPermissionResponse = AgentPermissionResponse;

export interface ClisbotAgentRespondToPermissionOptions {
  requestId: string;
  response: ClisbotAgentPermissionResponse;
}

export interface ClisbotAgentCommandsOptions {
  requestId?: string;
}

export type ClisbotAgentCommandsResult = ListCommandsResponse["payload"];

export type ClisbotAgentUpdate = Extract<
  SessionOutboundMessage,
  { type: "agent_update" }
>["payload"];

export type ClisbotAgentStream = Extract<
  SessionOutboundMessage,
  { type: "agent_stream" }
>["payload"];

export type ClisbotAgentUpdateHandler = (update: ClisbotAgentUpdate) => void;

export type ClisbotAgentTimelineEvent =
  | ClisbotAgentStream
  | {
      agentId: string;
      event: { type: "replacement"; epoch: string };
    }
  | {
      agentId: string;
      subscriptionId: string;
      event: { type: "subscription_restored" };
    }
  | { agentId: string; event: { type: "error"; error: string } };

export type ClisbotAgentTimelineSubscription = ReturnType<DaemonClient["subscribeAgentTimeline"]>;

export interface ClisbotAgentTimelineHandle {
  append(item: Omit<PluginTimelineItem, "pluginId">): Promise<{ seq: number; epoch: string }>;
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: ClisbotAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Delivers live events only. After reconnect, subscription_restored precedes
   * subsequent updates. History may have been missed; use refetch() to request
   * the range you need. No history is fetched automatically. A replacement event
   * invalidates the previous epoch. Subscription errors release this observation.
   * Await the returned unsubscribe function's `ready` promise before starting
   * work that must be observed. It rejects if establishment fails.
   */
  subscribe(handler: (event: ClisbotAgentTimelineEvent) => void): ClisbotAgentTimelineSubscription;
}

export interface ClisbotAgentHandle {
  readonly id: string;
  /**
   * `workspaceId` through `archivedAt` mirror the last snapshot this handle
   * observed. A handle from `ref()` reads `null` for all of them until
   * `refresh()`, `run()`, `waitForFinish()`, a timeline refetch, or
   * `subscribe()` delivers a snapshot. Optional snapshot values also read as
   * `null`; use `current()` when you need to distinguish those states.
   */
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: ClisbotAgent["status"] | null;
  readonly capabilities: ClisbotAgent["capabilities"] | null;
  readonly availableModes: ClisbotAgent["availableModes"] | null;
  readonly pendingPermissions: ClisbotAgent["pendingPermissions"] | null;
  readonly activeTurn: NonNullable<ClisbotAgent["activeTurn"]> | null;
  readonly lastUsage: NonNullable<ClisbotAgent["lastUsage"]> | null;
  readonly lastError: NonNullable<ClisbotAgent["lastError"]> | null;
  readonly features: NonNullable<ClisbotAgent["features"]> | null;
  readonly runtimeInfo: NonNullable<ClisbotAgent["runtimeInfo"]> | null;
  readonly archivedAt: NonNullable<ClisbotAgent["archivedAt"]> | null;
  readonly timeline: ClisbotAgentTimelineHandle;
  current(): ClisbotAgent | null;
  refresh(requestId?: string): Promise<ClisbotAgentRefetchResult | null>;
  send(text: string, options?: ClisbotAgentSendOptions): Promise<void>;
  respondToPermission(options: ClisbotAgentRespondToPermissionOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: ClisbotAgentRunOptions): Promise<ClisbotAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<ClisbotAgentRunResult>;
  /**
   * Asks the running session for the slash commands and skills it actually
   * loaded. Providers answer from the live session, so this sees built-in and
   * bundled entries that no directory scan can find. The payload carries its own
   * `error` string; a provider that cannot answer reports it there rather than
   * rejecting.
   */
  commands(options?: ClisbotAgentCommandsOptions): Promise<ClisbotAgentCommandsResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: ClisbotAgentUpdate) => void): () => void;
}

export interface ClisbotAgentActions {
  list(options: ClisbotAgentListOptions & { subscribe: {} }): Promise<
    ClisbotAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<ClisbotAgentListResult>;
    }
  >;
  list(options?: ClisbotAgentListOptions): Promise<ClisbotAgentListResult>;
  ref(agent: string | ClisbotAgent): ClisbotAgentHandle;
  create(options: ClisbotAgentCreateOptions): Promise<ClisbotAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ClisbotAgentUpdateHandler): () => void;
}

export type ClisbotProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type ClisbotProviderModesResult = ListProviderModesResponseMessage["payload"];
type ClisbotProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface ClisbotProviderFeaturesInput extends Omit<
  ClisbotProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
export type ClisbotProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type ClisbotProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type ClisbotProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type ClisbotProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type ClisbotProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type ClisbotProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];
export type ClisbotProviderUsageResult = ProviderUsageListResponseMessage["payload"];
export interface ClisbotProviderUsageOptions {
  requestId?: string;
}

export interface ClisbotProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface ClisbotProviderRefreshOptions {
  cwd?: string;
  providers?: ClisbotAgentProvider[];
  requestId?: string;
}

export interface ClisbotProviderWaitOptions extends ClisbotProviderListOptions {
  timeoutMs?: number;
}

export interface ClisbotProviderActions {
  listModels(
    provider: ClisbotAgentProvider,
    options?: ClisbotProviderListOptions,
  ): Promise<ClisbotProviderModelsResult>;
  listModes(
    provider: ClisbotAgentProvider,
    options?: ClisbotProviderListOptions,
  ): Promise<ClisbotProviderModesResult>;
  listFeatures(
    draftConfig: ClisbotProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<ClisbotProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<ClisbotProviderAvailabilityResult>;
  snapshot(options?: ClisbotProviderListOptions): Promise<ClisbotProviderSnapshotResult>;
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: ClisbotProviderWaitOptions): Promise<ClisbotProviderSnapshotResult>;
  refresh(options?: ClisbotProviderRefreshOptions): Promise<ClisbotProviderRefreshResult>;
  diagnostic(
    provider: ClisbotAgentProvider,
    options?: { requestId?: string },
  ): Promise<ClisbotProviderDiagnosticResult>;
  listUsage(options?: ClisbotProviderUsageOptions): Promise<ClisbotProviderUsageResult>;
  subscribe(handler: (update: ClisbotProviderSnapshotUpdate) => void): () => void;
}

export interface ClisbotConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface ClisbotApi {
  dispose(): Promise<void>;
  observeEvents: DaemonClient["observeEvents"];
  readonly terminals: ClisbotTerminalActions;
  readonly workspaces: ClisbotWorkspaceActions;
  readonly projects: ClisbotProjectActions;
  readonly agents: ClisbotAgentActions;
  readonly providers: ClisbotProviderActions;
  readonly config: ClisbotConfigActions;
}

export interface ClisbotClient extends ClisbotApi {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createClisbotClient(config: ClisbotClientConfig): ClisbotClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const api = createClisbotApi(daemonClient);
  return {
    ...api,
    connect: () => daemonClient.connect(),
    close: async () => {
      try {
        await api.dispose();
      } finally {
        await daemonClient.close();
      }
    },
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

function toDaemonAgentCreateOptions(
  options: ClisbotAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
): CreateAgentRequestOptions {
  const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
  const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
  const { provider, model } = parseProviderModel(providerModel);
  return {
    ...requestOptions,
    config: {
      ...runtimeConfig,
      provider,
      model,
      cwd: placement?.cwd ?? cwd,
      ...(title !== undefined ? { title } : {}),
      ...(providerOptions !== undefined ? { providerOptions } : {}),
    },
    ...(placement ? { workspaceId: placement.workspaceId } : {}),
    ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
    ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
  };
}

export function createClisbotApi(
  daemonClient: DaemonClient,
  scopeOptions?: { signal?: AbortSignal },
): ClisbotApi {
  const handles = new Set<{ release(): Promise<void> }>();
  const agentListeners = new Set<ClisbotAgentUpdateHandler>();
  const workspaceListeners = new Set<ClisbotWorkspaceUpdateHandler>();
  const lifetime = new AbortController();
  const own = <T extends { release(): Promise<void> }>(create: () => T): T => {
    if (lifetime.signal.aborted) throw new Error("Clisbot API is disposed");
    const handle = create();
    handles.add(handle);
    const release = handle.release.bind(handle);
    handle.release = async () => {
      await release();
      handles.delete(handle);
    };
    return handle;
  };
  const listenAgents = (handler: ClisbotAgentUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Clisbot API is disposed");
    agentListeners.add(handler);
    return () => {
      agentListeners.delete(handler);
    };
  };
  const listenWorkspaces = (handler: ClisbotWorkspaceUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Clisbot API is disposed");
    workspaceListeners.add(handler);
    return () => {
      workspaceListeners.delete(handler);
    };
  };
  const createAgentHandle = createAgentHandleFactory(
    daemonClient,
    listenAgents,
    (agentId, handler) => own(() => daemonClient.subscribeAgentTimeline(agentId, handler)),
  );
  const createAgent = async (
    options: ClisbotAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const agent = await daemonClient.createAgent(toDaemonAgentCreateOptions(options, placement));
    return createAgentHandle(agent);
  };
  const terminals = createTerminalActions(daemonClient, async (workspaceId) => {
    const workspace = await createWorkspaceHandle(workspaceId).refresh();
    if (!workspace?.workspaceDirectory) {
      throw new Error(`Workspace ${workspaceId} is not active or has no available directory`);
    }
    return workspace.workspaceDirectory;
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(
    daemonClient,
    createAgent,
    terminals,
    listenWorkspaces,
  );

  let disposal: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    lifetime.abort();
    scopeOptions?.signal?.removeEventListener("abort", abort);
    agentListeners.clear();
    workspaceListeners.clear();
    disposal = Promise.allSettled([...handles].map((handle) => handle.release())).then(
      (results) => {
        handles.clear();
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, "Failed to release API subscriptions");
        return undefined;
      },
    );
    return disposal;
  };
  const abort = () => {
    void dispose().catch((error) => console.error("API subscription cleanup failed", error));
  };
  if (scopeOptions?.signal?.aborted) abort();
  else scopeOptions?.signal?.addEventListener("abort", abort, { once: true });

  const observeEvents: DaemonClient["observeEvents"] = (events, options) =>
    own(() => daemonClient.observeEvents(events, options));

  const subscribeEvent = (
    event: "project.update" | "providers_snapshot_update",
    update: (message: SessionOutboundMessage) => void,
  ): (() => void) => {
    const observation = observeEvents([event]);
    observation.subscribe({ snapshot: () => {}, update });
    return () => {
      void observation
        .release()
        .catch((error) => console.error("Event subscription cleanup failed", error));
    };
  };

  function listWorkspaces(options: ClisbotWorkspaceListOptions & { subscribe: {} }): Promise<
    ClisbotWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<ClisbotWorkspaceListResult>;
    }
  >;
  function listWorkspaces(
    options?: ClisbotWorkspaceListOptions,
  ): Promise<ClisbotWorkspaceListResult>;
  async function listWorkspaces(
    options?: ClisbotWorkspaceListOptions,
  ): Promise<ClisbotWorkspaceListResult> {
    if (!options?.subscribe) return daemonClient.fetchWorkspaces(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeWorkspaces(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "workspace_update")
          for (const listener of workspaceListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  function listAgents(options: ClisbotAgentListOptions & { subscribe: {} }): Promise<
    ClisbotAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<ClisbotAgentListResult>;
    }
  >;
  function listAgents(options?: ClisbotAgentListOptions): Promise<ClisbotAgentListResult>;
  async function listAgents(options?: ClisbotAgentListOptions): Promise<ClisbotAgentListResult> {
    if (!options?.subscribe) return daemonClient.fetchAgents(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeAgents(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "agent_update")
          for (const listener of agentListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  return {
    dispose,
    observeEvents,
    terminals,
    projects: {
      list: (options) => daemonClient.listProjects(options),
      subscribe: (handler) => {
        return subscribeEvent("project.update", (message) => {
          if (message.type === "project.update") handler(message.payload);
        });
      },
    },
    workspaces: {
      list: listWorkspaces,
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, agent, ...options }) => {
        const result = await daemonClient.createWorkspace(
          { ...options, ...(agent ? { agent: toDaemonAgentCreateOptions(agent) } : {}) },
          requestId,
        );
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: listenWorkspaces,
    },
    agents: {
      list: listAgents,
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: listenAgents,
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) =>
        waitForProvidersReady(
          daemonClient,
          observeEvents(["providers_snapshot_update"]),
          lifetime.signal,
          options,
        ),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      listUsage: (options) => listProviderUsage(daemonClient, options),
      subscribe: (handler) => {
        return subscribeEvent("providers_snapshot_update", (message) => {
          if (message.type === "providers_snapshot_update") handler(message.payload);
        });
      },
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
  };
}

type WorkspaceHandleFactory = (workspace: string | ClisbotWorkspace) => ClisbotWorkspaceHandle;
type AgentHandleFactory = (agent: string | ClisbotAgent) => ClisbotAgentHandle;
type CreateAgent = (
  options: ClisbotAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<ClisbotAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
  terminals: ClisbotTerminalActions,
  listen: (handler: ClisbotWorkspaceUpdateHandler) => () => void,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      terminals: {
        create: (options) => terminals.create({ ...options, workspaceId: id }),
        list: (options) => terminals.list({ ...options, workspaceId: id }),
      },
      current: () => current,
      refresh,
      setTitle: (title, requestId) => daemonClient.setWorkspaceTitle(id, title, requestId),
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(
  daemonClient: DaemonClient,
  listen: (handler: ClisbotAgentUpdateHandler) => () => void,
  subscribeTimeline: DaemonClient["subscribeAgentTimeline"],
): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: ClisbotAgentHandle = {
      id,
      timeline: {
        append: (item) => daemonClient.appendAgentTimelineItem(id, item),
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          subscribeTimeline(id, (message) => {
            switch (message.type) {
              case "agent_stream":
                return handler(message.payload);
              case "agent.timeline.subscription_restored":
                return handler({
                  agentId: id,
                  subscriptionId: message.payload.subscriptionId,
                  event: { type: "subscription_restored" },
                });
              case "agent.timeline.error":
                return handler({
                  agentId: id,
                  event: { type: "error", error: message.payload.error },
                });
              case "agent.timeline.replacement":
                return handler({
                  agentId: id,
                  event: { type: "replacement", epoch: message.payload.epoch },
                });
            }
          }),
      },
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      get capabilities() {
        return current?.capabilities ?? null;
      },
      get availableModes() {
        return current?.availableModes ?? null;
      },
      get pendingPermissions() {
        return current?.pendingPermissions ?? null;
      },
      get activeTurn() {
        return current?.activeTurn ?? null;
      },
      get lastUsage() {
        return current?.lastUsage ?? null;
      },
      get lastError() {
        return current?.lastError ?? null;
      },
      get features() {
        return current?.features ?? null;
      },
      get runtimeInfo() {
        return current?.runtimeInfo ?? null;
      },
      get archivedAt() {
        return current?.archivedAt ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      respondToPermission: async ({ requestId, response }) => {
        await daemonClient.respondToPermission(id, requestId, response);
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      commands: (options) => daemonClient.listCommands({ agentId: id, ...options }),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.agent.id === id) {
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | ClisbotWorkspaceOpenOptions,
  requestId?: string,
): Promise<ClisbotWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | ClisbotWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | ClisbotAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function listProviderUsage(
  daemonClient: DaemonClient,
  options?: ClisbotProviderUsageOptions,
): Promise<ClisbotProviderUsageResult> {
  // COMPAT(providerUsageList): added in v0.1.98, remove after 2027-02-28 once daemon floor >= v0.1.98.
  if (daemonClient.getLastServerInfoMessage()?.features?.providerUsageList !== true) {
    return Promise.reject(new Error("Update the host to list provider usage."));
  }
  return daemonClient.listProviderUsage(options);
}

async function waitForProvidersReady(
  daemonClient: DaemonClient,
  observation: ReturnType<DaemonClient["observeEvents"]>,
  signal: AbortSignal,
  options: ClisbotProviderWaitOptions = {},
): Promise<ClisbotProviderSnapshotResult> {
  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  try {
    await observation.ready;
    signal.throwIfAborted();
    return await new Promise<ClisbotProviderSnapshotResult>((resolve, reject) => {
      let settled = false;
      let requestId: string | null = null;
      let snapshotCwd: string | undefined;
      const pendingUpdates = new Map<string | undefined, ClisbotProviderSnapshotUpdate>();
      let latestEntries: ClisbotProviderSnapshotResult["entries"] = [];

      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
        signal.removeEventListener("abort", abort);
      };
      const finish = (snapshot: ClisbotProviderSnapshotResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const updateMatches = (update: ClisbotProviderSnapshotUpdate) => update.cwd === snapshotCwd;

      const unsubscribe = observation.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type !== "providers_snapshot_update") return;
          const update = message.payload;
          if (!requestId) {
            pendingUpdates.set(update.cwd, update);
            return;
          }
          if (!updateMatches(update)) return;
          latestEntries = update.entries;
          if (update.entries.some((entry) => entry.status === "loading")) return;
          finish({ ...update, requestId });
        },
      });
      const abort = () => fail(new Error("Clisbot API is disposed"));
      signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        const loading = latestEntries
          .filter((entry) => entry.status === "loading")
          .map((entry) => entry.provider)
          .join(", ");
        fail(
          new Error(
            loading
              ? `Timed out waiting for providers: ${loading}`
              : "Timed out waiting for provider discovery",
          ),
        );
      }, timeoutMs);

      void daemonClient
        .getProvidersSnapshot(snapshotOptions)
        .then((snapshot) => {
          requestId = snapshot.requestId;
          snapshotCwd = snapshot.cwd;
          latestEntries = snapshot.entries;
          if (!snapshot.entries.some((entry) => entry.status === "loading")) {
            finish(snapshot);
            return;
          }
          const pendingUpdate = pendingUpdates.get(snapshotCwd);
          if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
            finish({ ...pendingUpdate, requestId });
          }
          return undefined;
        })
        .catch(fail);
    });
  } finally {
    await observation.release();
  }
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `clisbot-sdk-${randomId}`;
}
