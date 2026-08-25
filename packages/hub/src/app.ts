import { createExecutionCapabilityServer } from "./execution-capabilities/server.js";
import { OutputExecutorRegistry } from "./execution-capabilities/outputs.js";
import {
  createAttachmentCapabilityRegistry,
  type AttachmentCapabilityRegistry,
  type AttachmentProvider,
  type AttachmentResolver,
} from "./attachments/capabilities.js";
import {
  ProjectConfigurationStore,
  validateHubBundleForOrganization,
} from "./configuration/store.js";
import type {
  AcceptedTriggerRunRecord,
  Database,
  TriggerRunRecord,
  WorkflowDeadlineRecovery,
} from "./db/types.js";
import { DatabaseUnavailableError } from "./db/errors.js";
import {
  ActiveDaemonRegistry,
  createDaemonUpgradeHandler,
  createDaemonModule,
  enrollDaemon,
  revokeDaemon,
  type DaemonClock,
  type DaemonModule,
} from "./daemons/index.js";
import { createDispatcherWithEngine } from "./dispatcher/index.js";
import type {
  DaemonDispatchLifecycleOptions,
  ExecutionDeadlineClock,
} from "./daemons/lifecycle.js";
import type { TriggerProviderFactory, TriggerProviderResources } from "./providers/registration.js";
import type { TriggerProvider, TriggerSource } from "./triggers/index.js";
import {
  createManualTriggerSource,
  dispatchManualTrigger,
  handleManualTriggerRequest,
} from "./triggers/manual/source.js";
import { createManualRunProvider } from "./triggers/manual/provider.js";
import { DaemonRegistration } from "./daemons/registration.js";
import { CliAuthorizations } from "./cli-authorizations/index.js";
import type { BrowserOrganizationAccess } from "./auth/browser-organization-access.js";
import { createPublicApi, type PublicApi, type PublicApiComposition } from "./public-api/index.js";
import { createPublicOperations } from "./public-operations/index.js";
import { createDatabasePublicOperationRepository } from "./public-operations/database-adapter.js";
import type { EntitlementsService } from "./entitlements/service.js";
import type { ExecutionAuthority } from "./execution-authority/index.js";

export interface HubRuntimeOptions {
  database: Database | null;
  /** Required end to end so the executions meter can never be silently skipped. */
  entitlements: EntitlementsService | null;
  providers?: readonly TriggerProvider[];
  providerFactories?: readonly TriggerProviderFactory[];
  executionAuthority?: ExecutionAuthority;
  attachmentResolvers?: Partial<Record<AttachmentProvider, AttachmentResolver>>;
  connectionsForProject?: TriggerProviderResources["connectionsForProject"];
  configurationRevisionId?: string;
  outputRegistry?: OutputExecutorRegistry;
  publicApi: PublicApiComposition;
  completionTokenSecret?: string;
  publicBaseUrl?: string;
  daemonClock?: DaemonClock;
  executionDeadlineClock?: ExecutionDeadlineClock;
  dispatchTimeoutMs?: number;
  browserOrganizationAccess?: BrowserOrganizationAccess;
  daemonConnectionForId?: DaemonDispatchLifecycleOptions["connectionForDaemon"];
}

export interface HubRuntime {
  daemonModule: DaemonModule | null;
  resourceCounts(): {
    recoveredExecutionSubscriptions: number;
  };
  processWorkflowOutbox(): Promise<void>;
  handleUpgrade: ReturnType<typeof createDaemonUpgradeHandler> | null;
  start(sources?: readonly TriggerSource[]): Promise<void>;
  stop(): Promise<void>;
}

export interface HubOperations {
  handleDaemonEnrollment(request: Request): Promise<Response>;
  handleDaemonRevocation(request: Request, daemonId: string): Promise<Response>;
  handleCliAuthorizationStart(request: Request): Promise<Response>;
  handleCliAuthorizationPoll(request: Request): Promise<Response>;
  handleCliAuthorizationInspect(request: Request): Promise<Response>;
  handleCliAuthorizationDecision(request: Request): Promise<Response>;
  handleOrganizationDaemons(request: Request): Promise<Response>;
  handleOrganizationDaemonRename(request: Request, daemonId: string): Promise<Response>;
  handleOrganizationDaemonRevocation(request: Request, daemonId: string): Promise<Response>;
  handleExecutionCapabilities(request: Request, executionId: string): Promise<Response>;
  handleAttachmentDownload(
    request: Request,
    executionId: string,
    attachmentId: string,
  ): Promise<Response>;
  handleManualTrigger(request: Request, entrypoint: "trigger" | "smoke"): Promise<Response>;
}

export interface HubApplication {
  hub: HubRuntime;
  operations: HubOperations;
  publicApi: PublicApi;
  configurationForProject(projectId: string): ProjectConfigurationStore;
}

export function createHubRuntime(options: HubRuntimeOptions): HubRuntime {
  return createHubApplication(options).hub;
}

export function createHubApplication(options: HubRuntimeOptions): HubApplication {
  const daemons =
    options.database === null
      ? null
      : new ActiveDaemonRegistry(options.database, options.daemonClock);
  const storeForProject = (projectId: string) => {
    if (options.database === null) throw new DatabaseUnavailableError();
    return new ProjectConfigurationStore(options.database, projectId, daemons ?? undefined);
  };
  const manualProvider =
    options.database === null ? undefined : createManualRunProvider(storeForProject);
  const attachments = createAttachmentRegistry(options);
  const configuredProviders =
    options.database === null
      ? []
      : (options.providerFactories ?? []).map((factory) =>
          factory({
            configurationStoreForProject: storeForProject,
            connectionsForProject:
              options.connectionsForProject ??
              (() => () => {
                throw new Error("no connection resolver registered");
              }),
            ...(attachments === undefined ? {} : { attachments }),
          }),
        );
  const providers = [manualProvider, ...configuredProviders, ...(options.providers ?? [])].filter(
    (provider): provider is TriggerProvider => provider !== undefined,
  );
  const outputRegistry = options.outputRegistry ?? new OutputExecutorRegistry();
  const daemonModule = createAppDaemonModule(options, daemons, providers, outputRegistry);
  const capabilityServer = createAppExecutionCapabilityServer(
    options,
    daemonModule,
    outputRegistry,
  );
  const registration =
    options.database === null || daemons === null
      ? null
      : new DaemonRegistration({
          database: options.database,
          activeDaemons: daemons,
          ...(options.browserOrganizationAccess === undefined
            ? {}
            : { access: options.browserOrganizationAccess }),
        });
  const cliAuthorizations =
    options.database === null
      ? null
      : new CliAuthorizations(
          options.database,
          options.browserOrganizationAccess,
          options.publicBaseUrl,
        );

  const manualSource =
    options.database === null ? undefined : createManualTriggerSource(options.database);
  const durableDispatchHandler =
    options.database === null || daemonModule === null
      ? undefined
      : (intent: Parameters<DaemonModule["lifecycle"]["handoffLaunchMachineIntent"]>[0]) =>
          daemonModule.lifecycle.handoffLaunchMachineIntent(intent);
  const dispatcherOptions = {
    database: options.database,
    entitlements: options.entitlements,
    providers,
    ...(options.configurationRevisionId === undefined
      ? {}
      : { configurationRevisionId: options.configurationRevisionId }),
    ...(options.executionDeadlineClock === undefined
      ? {}
      : { now: () => new Date(options.executionDeadlineClock!.now()) }),
    ...(options.outputRegistry === undefined
      ? {}
      : {
          validateLaunchMachineIntent: (
            intent: import("./dispatcher/launch-machine-intent.js").LaunchMachineIntent,
          ) =>
            options.outputRegistry!.validateRequiredOutputs(
              intent.allowOutputs,
              intent.outputContext,
            ),
        }),
    ...(daemonModule === null
      ? {}
      : {
          onWorkflowDeadlineExceeded: async (recovery: WorkflowDeadlineRecovery) => {
            await daemonModule.lifecycle.recoverWorkflowDeadlineExecutions(recovery.executionIds);
          },
          onWorkflowRunAccepted: (run: AcceptedTriggerRunRecord) =>
            daemonModule.lifecycle.notifyWorkflowRunAccepted(run),
          onWorkflowRunStarted: (run: AcceptedTriggerRunRecord) =>
            daemonModule.lifecycle.notifyWorkflowRunStarted(run),
          onWorkflowRunTerminal: (run: TriggerRunRecord) =>
            daemonModule.lifecycle.notifyWorkflowRunTerminal(run),
        }),
  };
  const { handler: workflowDispatcher, engine: workflowEngine } = createDispatcherWithEngine({
    ...dispatcherOptions,
    ...(durableDispatchHandler === undefined
      ? {}
      : { dispatchLaunchMachineIntent: durableDispatchHandler }),
  });
  connectDaemonLifecycle(daemons, daemonModule);
  let activeSources: readonly TriggerSource[] = [];

  const hub: HubRuntime = {
    daemonModule,
    resourceCounts: () => ({
      recoveredExecutionSubscriptions:
        daemonModule?.lifecycle.activeRecoveryObservationCount() ?? 0,
    }),
    processWorkflowOutbox: () => workflowEngine.processAvailable(),
    handleUpgrade:
      options.database === null ? null : createDaemonUpgradeHandler(options.database, daemons!),
    async start(sources = []) {
      await Promise.all([
        daemonModule?.lifecycle.recoverAgentExecutionDeadlines(),
        daemonModule?.lifecycle.recoverPendingHubActions(),
      ]);
      workflowEngine.start();
      activeSources = [...(manualSource === undefined ? [] : [manualSource]), ...sources];
      await Promise.all(activeSources.map(async (source) => source.start(workflowDispatcher)));
    },
    async stop() {
      try {
        await Promise.all(activeSources.map(async (source) => source.stop()));
        activeSources = [];
        await Promise.all([workflowEngine.stop(), daemonModule?.lifecycle.stop(), daemons?.stop()]);
      } finally {
        await options.executionAuthority?.stop();
      }
    },
  };
  const publicOperations = createAppPublicOperations(
    options,
    manualSource,
    storeForProject,
    daemons,
  );
  const publicApi = createPublicApi(options.publicApi, publicOperations);
  const operations: HubOperations = {
    handleDaemonEnrollment: (request) =>
      options.database === null
        ? databaseUnavailable()
        : enrollDaemon(request, options.database, options.publicBaseUrl, options.daemonClock),
    handleDaemonRevocation: (request, daemonId) =>
      options.database === null || daemons === null
        ? databaseUnavailable()
        : revokeDaemon(request, daemonId, options.database, daemons),
    handleCliAuthorizationStart: (request) =>
      cliAuthorizations === null ? databaseUnavailable() : cliAuthorizations.start(request),
    handleCliAuthorizationPoll: (request) =>
      cliAuthorizations === null ? databaseUnavailable() : cliAuthorizations.poll(request),
    handleCliAuthorizationInspect: (request) =>
      cliAuthorizations === null ? databaseUnavailable() : cliAuthorizations.inspect(request),
    handleCliAuthorizationDecision: (request) =>
      cliAuthorizations === null ? databaseUnavailable() : cliAuthorizations.decide(request),
    handleOrganizationDaemons: (request) =>
      registration === null ? databaseUnavailable() : registration.list(request),
    handleOrganizationDaemonRename: (request, daemonId) =>
      registration === null ? databaseUnavailable() : registration.rename(request, daemonId),
    handleOrganizationDaemonRevocation: (request, daemonId) =>
      registration === null ? databaseUnavailable() : registration.revoke(request, daemonId),
    handleExecutionCapabilities: (request, executionId) =>
      capabilityServer === null
        ? databaseUnavailable()
        : capabilityServer.handle(request, executionId),
    handleAttachmentDownload: (request, executionId, attachmentId) =>
      attachments === undefined
        ? databaseUnavailable()
        : attachments.handle(request, executionId, attachmentId),
    handleManualTrigger: (request, entrypoint) =>
      manualSource === undefined
        ? databaseUnavailable()
        : handleManualTriggerRequest(request, manualSource, entrypoint),
  };
  return { hub, operations, publicApi, configurationForProject: storeForProject };
}

function createAppPublicOperations(
  options: HubRuntimeOptions,
  manualSource: ReturnType<typeof createManualTriggerSource> | undefined,
  configurationForProject: (projectId: string) => ProjectConfigurationStore,
  daemonAgentValidator: ActiveDaemonRegistry | null,
) {
  if (options.database === null || manualSource === undefined) return null;
  const database = options.database;
  return createPublicOperations(
    createDatabasePublicOperationRepository(database),
    {
      configurationForProject,
      validateBundleForOrganization: (organizationId, files) =>
        validateHubBundleForOrganization(
          database,
          organizationId,
          files,
          daemonAgentValidator ?? undefined,
        ),
      dispatchManualEvent: (input) => dispatchManualTrigger(manualSource, input),
    },
    options.daemonClock,
  );
}

function createAppExecutionCapabilityServer(
  options: HubRuntimeOptions,
  daemonModule: DaemonModule | null,
  outputRegistry: OutputExecutorRegistry,
) {
  if (options.database === null || daemonModule === null) {
    return null;
  }
  return createExecutionCapabilityServer({
    database: options.database,
    outputs: outputRegistry,
    completeExecution: (input) =>
      daemonModule.lifecycle.completeAgentExecutionFromCallback(input, { deferHubAction: true }),
  });
}

function createAttachmentRegistry(
  options: HubRuntimeOptions,
): AttachmentCapabilityRegistry | undefined {
  if (
    options.database === null ||
    options.publicBaseUrl === undefined ||
    options.completionTokenSecret === undefined
  ) {
    return undefined;
  }
  return createAttachmentCapabilityRegistry({
    database: options.database,
    publicBaseUrl: options.publicBaseUrl,
    authoritySecret: options.completionTokenSecret,
    resolvers: options.attachmentResolvers ?? {},
  });
}

function databaseUnavailable(): Promise<Response> {
  return Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 }));
}

function connectDaemonLifecycle(
  daemons: ActiveDaemonRegistry | null,
  daemonModule: DaemonModule | null,
): void {
  daemons?.onConnected((daemon) => daemonModule?.lifecycle.recoverDaemon(daemon));
  daemons?.onRevoked((daemon) =>
    daemonModule?.lifecycle.failPendingExecutionsForDisconnectedMachine(
      daemon.machineId,
      "daemon_revoked",
    ),
  );
}

function createAppDaemonModule(
  options: HubRuntimeOptions,
  daemons: ActiveDaemonRegistry | null,
  providers: readonly TriggerProvider[],
  outputRegistry: OutputExecutorRegistry,
): DaemonModule | null {
  if (options.database === null) {
    return null;
  }

  const usesTestTiming =
    options.executionDeadlineClock !== undefined || options.dispatchTimeoutMs !== undefined;
  return createDaemonModule({
    database: options.database,
    connectionForDaemon: options.daemonConnectionForId ?? ((id) => daemons?.connection(id)),
    executionCapabilities: outputRegistry,
    ...(options.completionTokenSecret === undefined
      ? {}
      : { completionTokenSecret: options.completionTokenSecret }),
    providers,
    ...(options.executionAuthority === undefined
      ? {}
      : { executionAuthority: options.executionAuthority }),
    ...(options.publicBaseUrl === undefined ? {} : { publicBaseUrl: options.publicBaseUrl }),
    ...(usesTestTiming
      ? {
          test: {
            ...(options.executionDeadlineClock === undefined
              ? {}
              : { deadlineClock: options.executionDeadlineClock }),
            ...(options.dispatchTimeoutMs === undefined
              ? {}
              : { dispatchTimeoutMs: options.dispatchTimeoutMs }),
          },
        }
      : {}),
  });
}
