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
  replaceDaemonConnectionOffer,
  revokeDaemon,
  updateDaemonPermissions,
  type DaemonClock,
  type DaemonModule,
} from "./daemons/index.js";
import { createDispatcherWithEngine } from "./dispatcher/index.js";
import type {
  DaemonDispatchLifecycleOptions,
  ExecutionDeadlineClock,
} from "./daemons/lifecycle.js";
import type { TriggerProviderFactory } from "./providers/registration.js";
import type { TriggerProvider, TriggerSource } from "./triggers/index.js";
import {
  createManualTriggerSource,
  dispatchManualTrigger,
  handleManualTriggerRequest,
} from "./triggers/manual/source.js";
import { createManualRunProvider } from "./triggers/manual/provider.js";
import { createWorkflowConfigurationResolver } from "./triggers/configuration.js";
import {
  createChannelWorkflowProvider,
  type ChannelWorkflowRequestPayload,
} from "./triggers/channel/provider.js";
import { OrganizationTriggerStore } from "./triggers/store.js";
import { DaemonRegistration } from "./daemons/registration.js";
import { CliAuthorizations } from "./cli-authorizations/index.js";
// COMPAT(clisbot-control-plane): the channel control-plane ops (implementation
// doc §1.4, §3.2) — self-authenticating, gated per request, degraded when the
// composition root did not build a supervisor.
import { createChannelControlPlaneOps } from "./channels/http/operations.js";
import type { ChannelReplyServer } from "./channels/channel-reply.js";
import type { ChannelSupervisor } from "./channels/supervisor/types.js";
import type { DatabaseRuntime } from "./db/runtime/index.js";
import type { BrowserOrganizationAccess } from "./auth/browser-organization-access.js";
import { createPublicApi, type PublicApi, type PublicApiComposition } from "./public-api/index.js";
import { createPublicOperations, type PublicOperations } from "./public-operations/index.js";
import { createDatabasePublicOperationRepository } from "./public-operations/database-adapter.js";
import type { EntitlementsService } from "./entitlements/service.js";
import type { ExecutionAuthority } from "./execution-authority/index.js";
import { replaceDaemonProjects } from "./access/daemon-projects.js";
import { AccessStore } from "./access/store.js";
import { consumeDaemonAccessTicket, refreshDaemonAccessLease } from "./managed-access/http.js";
import { AccessTicketService } from "./managed-access/tickets.js";
import { AccessLeaseRevocation } from "./managed-access/revocation.js";

export interface HubRuntimeOptions {
  database: Database | null;
  /** Required end to end so the executions meter can never be silently skipped. */
  entitlements: EntitlementsService | null;
  providers?: readonly TriggerProvider[];
  providerFactories?: readonly TriggerProviderFactory[];
  executionAuthority?: ExecutionAuthority;
  attachmentResolvers?: Partial<Record<AttachmentProvider, AttachmentResolver>>;
  configurationRevisionId?: string;
  outputRegistry?: OutputExecutorRegistry;
  publicApi: PublicApiComposition;
  completionTokenSecret?: string;
  /**
   * COMPAT(clisbot-control-plane): the database runtime handle, threaded so the
   * control-plane scope can reach runtime-backed channel state; unused by P0 ops.
   */
  databaseRuntime?: DatabaseRuntime;
  /** Shared authority instance used by daemon consumption and the app management API. */
  accessTickets?: AccessTicketService;
  /** Shared Access repository used by management and daemon-owned catalog operations. */
  accessStore?: AccessStore;
  providerApplications?: import("./provider-applications/index.js").ProviderApplications;
  /** COMPAT(clisbot-control-plane): the Hub data directory operator secrets mirror into. */
  hubDataDir?: string;
  /** COMPAT(clisbot-control-plane): the channel supervisor, or null to degrade the transport step. */
  channelSupervisor?: ChannelSupervisor | null;
  /**
   * COMPAT(clisbot-control-plane): the tool-path channel-reply MCP endpoint
   * (E4); null degrades the `/mcp/channel/<opaque-capability>` route to a 503.
   */
  channelReplyServer?: ChannelReplyServer | null;
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
  dispatchChannelWorkflow(input: {
    organizationId: string;
    deliveryId: string;
    payload: ChannelWorkflowRequestPayload;
    receivedAt: Date;
  }): Promise<void>;
  revokeAccessLeases(daemonId: string, leaseIds: readonly string[]): boolean;
  handleUpgrade: ReturnType<typeof createDaemonUpgradeHandler> | null;
  start(sources?: readonly TriggerSource[]): Promise<void>;
  stop(): Promise<void>;
}

export interface HubOperations {
  handleDaemonEnrollment(request: Request): Promise<Response>;
  handleDaemonRevocation(request: Request, daemonId: string): Promise<Response>;
  handleDaemonPermissionUpdate(request: Request, daemonId: string): Promise<Response>;
  handleDaemonAccessTicketConsumption(request: Request): Promise<Response>;
  handleDaemonAccessLeaseRefresh(request: Request): Promise<Response>;
  handleDaemonProjectsReplacement(request: Request, daemonId: string): Promise<Response>;
  handleDaemonConnectionOfferReplacement(request: Request, daemonId: string): Promise<Response>;
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
  // COMPAT(clisbot-control-plane): the channel control-plane ops.
  handleChannelAdd(request: Request): Promise<Response>;
  handleChannelList(request: Request): Promise<Response>;
  handleChannelStatus(request: Request): Promise<Response>;
  handleUsersList(request: Request): Promise<Response>;
  handleUserShow(request: Request, username: string): Promise<Response>;
  handleUserAdd(request: Request): Promise<Response>;
  handleUserEdit(request: Request, username: string): Promise<Response>;
  // COMPAT(clisbot-control-plane): the tool-path channel-reply MCP endpoint.
  handleChannelReplyMcp(request: Request, token: string): Promise<Response>;
}

export interface HubApplication {
  hub: HubRuntime;
  operations: HubOperations;
  publicApi: PublicApi;
  /** Shared domain operations reused by authenticated management adapters. */
  publicOperations: PublicOperations | null;
  configurationForProject(projectId: string): ProjectConfigurationStore;
}

export function createHubRuntime(options: HubRuntimeOptions): HubRuntime {
  return createHubApplication(options).hub;
}

// eslint-disable-next-line complexity -- the composition root wires optional Hub subsystems in one place.
export function createHubApplication(options: HubRuntimeOptions): HubApplication {
  const daemons = createActiveDaemonRegistry(options);
  const storeForProject = (projectId: string) => {
    if (options.database === null) throw new DatabaseUnavailableError();
    return new ProjectConfigurationStore(options.database, projectId, daemons ?? undefined);
  };
  const configurationForWorkflow =
    options.database === null ? undefined : createWorkflowConfigurationResolver(options.database);
  const manualProvider =
    configurationForWorkflow === undefined
      ? undefined
      : createManualRunProvider(configurationForWorkflow);
  const channelProvider = channelWorkflowProviderFor(options);
  const attachments = createAttachmentRegistry(options);
  const configuredProviders =
    options.database === null
      ? []
      : (options.providerFactories ?? []).map((factory) =>
          factory({
            configurationForWorkflow: configurationForWorkflow!,
            ...(attachments === undefined ? {} : { attachments }),
          }),
        );
  const providers = [
    manualProvider,
    channelProvider,
    ...configuredProviders,
    ...(options.providers ?? []),
  ].filter((provider): provider is TriggerProvider => provider !== undefined);
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
  const accessStore =
    options.accessStore ??
    (options.databaseRuntime === undefined ? null : new AccessStore(options.databaseRuntime));
  const accessTickets = createAccessTicketService(options, accessStore);

  // COMPAT(clisbot-control-plane): one ops holder, built synchronously; the
  // kill-switch and database precedence are applied per request inside it.
  const channelControlPlane = createChannelControlPlaneOpsFor(options, accessStore);
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
  connectDaemonLifecycle(daemons, daemonModule, accessTickets, options.database);
  let activeSources: readonly TriggerSource[] = [];

  const hub: HubRuntime = {
    daemonModule,
    resourceCounts: () => ({
      recoveredExecutionSubscriptions:
        daemonModule?.lifecycle.activeRecoveryObservationCount() ?? 0,
    }),
    processWorkflowOutbox: () => workflowEngine.processAvailable(),
    async dispatchChannelWorkflow(input) {
      if (options.database === null) throw new DatabaseUnavailableError();
      const trigger = (await options.database.listOrganizationTriggers(input.organizationId)).find(
        (candidate) => candidate.enabled && candidate.name === input.payload.workflow,
      );
      if (trigger === undefined) {
        throw new Error(`organization workflow ${input.payload.workflow} is unavailable`);
      }
      const persisted = await options.database.persistChannelEvent({
        organizationId: input.organizationId,
        triggerId: trigger.id,
        triggerRevisionId: trigger.activeRevisionId,
        deliveryId: input.deliveryId,
        source: "channel.message",
        payload: {
          ...input.payload,
          workflow_id: trigger.id,
          workflow_revision_id: trigger.activeRevisionId,
        },
        receivedAt: input.receivedAt,
        connectionId: null,
        resourceId: input.payload.channel.binding_key,
      });
      if (persisted.status === "accepted") await workflowDispatcher(persisted.event);
    },
    revokeAccessLeases: (daemonId, leaseIds) =>
      daemons?.revokeAccessLeases(daemonId, leaseIds) ?? false,
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
    handleDaemonPermissionUpdate: (request, daemonId) =>
      options.database === null || daemons === null
        ? databaseUnavailable()
        : updateDaemonPermissions(request, daemonId, options.database, daemons),
    handleDaemonAccessTicketConsumption: (request) =>
      options.database === null || accessTickets === null
        ? databaseUnavailable()
        : consumeDaemonAccessTicket(request, options.database, accessTickets),
    handleDaemonAccessLeaseRefresh: (request) =>
      options.database === null || accessTickets === null
        ? databaseUnavailable()
        : refreshDaemonAccessLease(request, options.database, accessTickets),
    handleDaemonProjectsReplacement: (request, daemonId) =>
      options.database === null || accessStore === null
        ? databaseUnavailable()
        : replaceDaemonProjects(request, daemonId, options.database, accessStore),
    handleDaemonConnectionOfferReplacement: (request, daemonId) =>
      options.database === null
        ? databaseUnavailable()
        : replaceDaemonConnectionOffer(request, daemonId, options.database),
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
    handleChannelAdd: (request) => channelControlPlane.addChannel(request),
    handleChannelList: (request) => channelControlPlane.listChannels(request),
    handleChannelStatus: (request) => channelControlPlane.channelStatus(request),
    handleUsersList: (request) => channelControlPlane.listUsers(request),
    handleUserShow: (request, username) => channelControlPlane.showUser(request, username),
    handleUserAdd: (request) => channelControlPlane.addUser(request),
    handleUserEdit: (request, username) => channelControlPlane.editUser(request, username),
    handleChannelReplyMcp: (request, token) =>
      channelControlPlane.handleChannelReplyMcp(request, token),
  };
  return { hub, operations, publicApi, publicOperations, configurationForProject: storeForProject };
}

function createActiveDaemonRegistry(options: HubRuntimeOptions): ActiveDaemonRegistry | null {
  if (options.database === null) return null;
  return new ActiveDaemonRegistry(options.database, options.daemonClock);
}

function createAccessTicketService(
  options: HubRuntimeOptions,
  accessStore: AccessStore | null,
): AccessTicketService | null {
  if (options.accessTickets !== undefined) return options.accessTickets;
  if (options.databaseRuntime === undefined || accessStore === null) return null;
  return new AccessTicketService(options.databaseRuntime, accessStore);
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
      triggerForOrganization: (organizationId) => {
        const store = new OrganizationTriggerStore(database, organizationId);
        return {
          async list() {
            return Promise.all(
              (await store.list()).map(async (trigger) => ({
                id: trigger.id,
                name: trigger.name,
                enabled: trigger.enabled,
                format: trigger.format,
                yaml: (await store.activeRevision(trigger)).yaml,
              })),
            );
          },
          async validate(yaml) {
            const prepared = await store.validate(yaml);
            return { name: prepared.compiled.authored.name };
          },
          async install(input) {
            const prepared = await store.validate(input.yaml);
            const existing = (await store.list()).find(
              ({ name }) => name === prepared.compiled.authored.name,
            );
            const trigger = await store.save({
              ...(existing === undefined ? {} : { triggerId: existing.id }),
              yaml: input.yaml,
              userId: null,
              sourceEvidence: {
                kind: input.credentialKind === "apiKey" ? "api-key" : "cli-credential",
                credentialId: input.credentialId,
                authoredFormat: "self_contained_trigger_v1",
              },
            });
            const revision = await store.activeRevision(trigger);
            return {
              triggerId: trigger.id,
              name: trigger.name,
              revisionId: revision.id,
              version: revision.version,
            };
          },
        };
      },
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

function channelWorkflowProviderFor(options: HubRuntimeOptions): TriggerProvider | undefined {
  return options.database === null ? undefined : createChannelWorkflowProvider(options.database);
}

// COMPAT(clisbot-control-plane): the ops holder's options, factored out of
// `createHubApplication` so the composition function stays under its complexity
// budget. The kill-switch and database precedence are applied per request
// inside the ops.
function createChannelControlPlaneOpsFor(
  options: HubRuntimeOptions,
  accessStore: AccessStore | null,
): ReturnType<typeof createChannelControlPlaneOps> {
  return createChannelControlPlaneOps({
    database: options.database,
    ...(options.databaseRuntime
      ? {
          onboarding: {
            runtime: options.databaseRuntime,
            ...(options.providerApplications
              ? { providerApplications: options.providerApplications }
              : {}),
            access: accessStore ?? new AccessStore(options.databaseRuntime),
          },
        }
      : {}),
    completionTokenSecret: options.completionTokenSecret,
    supervisor: options.channelSupervisor ?? null,
    channelReplyServer: options.channelReplyServer ?? null,
  });
}

function connectDaemonLifecycle(
  daemons: ActiveDaemonRegistry | null,
  daemonModule: DaemonModule | null,
  accessTickets: AccessTicketService | null,
  database: Database | null,
): void {
  const revocation =
    daemons !== null && accessTickets !== null
      ? new AccessLeaseRevocation(accessTickets, (daemonId, leaseIds) => {
          daemons.revokeAccessLeases(daemonId, leaseIds);
        })
      : null;
  daemons?.onConnected((daemon) => daemonModule?.lifecycle.recoverDaemon(daemon));
  daemons?.onRevoked(async (daemon) => {
    // Canonical revocation already marked the Daemon inactive. Complete lease
    // notifications before execution cleanup can reject and close the socket.
    if (revocation !== null && database !== null) {
      const machine = await database.findMachineById(daemon.machineId);
      if (machine === undefined) throw new Error("Revoked Daemon has no owning machine");
      await revocation.revokeDaemon(machine.orgId, daemon.id);
    }
    await daemonModule?.lifecycle.failPendingExecutionsForDisconnectedMachine(
      daemon.machineId,
      "daemon_revoked",
    );
  });
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
    ...(options.channelSupervisor === null || options.channelSupervisor === undefined
      ? {}
      : {
          ...(options.channelSupervisor.channelReplyCapabilities === undefined
            ? {}
            : {
                channelReplyCapabilities: options.channelSupervisor.channelReplyCapabilities,
              }),
          onWorkflowChannelStream: (
            input: Parameters<NonNullable<ChannelSupervisor["workflowStreamEvent"]>>[0],
          ) => options.channelSupervisor!.workflowStreamEvent?.(input) ?? Promise.resolve(),
        }),
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
