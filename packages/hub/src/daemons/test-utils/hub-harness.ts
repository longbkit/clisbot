import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { createServer } from "node:net";
import type { Duplex } from "node:stream";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createPostgresQueryRuntime } from "../../db/test-utils/runtime.js";
import { dump } from "js-yaml";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import { createHubApplication, type HubRuntime } from "../../app.js";
import { createFetchServer } from "../../http/node-server.js";
import { startApplication, stopApplication } from "../../server/runtime.js";
import {
  HubExecutionAgentCreateRequestSchema,
  HubExecutionAgentValidateRequestSchema,
  HubExecutionControlRequestSchema,
  type HubExecutionControlAction,
  type HubExecutionAgentSnapshot,
} from "../../hub/protocol.js";
import {
  deriveAgentExecutionCompletionToken,
  hashAgentExecutionCompletionToken,
} from "../../agent-executions/completion-token.js";
import { createDatabase } from "../../db/test-utils/runtime.js";
import type { ApiKeyScope } from "../../auth/api-key-contract.js";
import type { OperationAuthenticator } from "../../auth/operation-auth.js";
import type {
  AgentExecutionRecord,
  Database,
  DaemonRecord,
  TriggerRunRecord,
} from "../../db/types.js";
import { dispatchLaunchMachineIntent } from "../../daemons/index.js";
import {
  durableExecutionId,
  type DaemonDispatchResult,
  type ExecutionDeadlineClock,
} from "../../daemons/lifecycle.js";
import type { LaunchMachineIntent } from "../../dispatcher/launch-machine-intent.js";
import type { WorktreeTarget } from "../../config/index.js";
import {
  OutputExecutorRegistry,
  outputContextProvider,
  replyOutputTool,
} from "../../execution-capabilities/outputs.js";
import type { DaemonClock } from "../registry.js";
import { ENROLLMENT_LIFETIME_MS } from "../registration.js";
import { createUnlimitedEntitlementsService } from "../../entitlements/test-utils.js";
import type { TriggerProvider } from "../../triggers/index.js";
import { ProjectConfigurationStore } from "../../configuration/store.js";
import { createSlackAttachmentResolver } from "../../triggers/slack/attachments.js";
import type { SlackBotClient, SlackThreadReadResult } from "../../triggers/slack/client.js";
import { createSlackTriggerProvider } from "../../triggers/slack/provider.js";
import {
  createExecutionAuthority,
  type ExecutionAuthority,
} from "../../execution-authority/index.js";
import type { GitHubAuthorityRegistration } from "../../providers/registration.js";
import { configurationBundleFixture } from "../../test-utils/configuration-bundle.js";
import type { HubBundleFile } from "../../config/bundle.js";

const HUB_ORGANIZATION_ID = "org_1";
const HUB_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const HUB_PROJECT_SLUG = "default";
const HUB_USER_ID = "hub-harness";
const HUB_API_KEY = "paseo_pk_hub-harness_test";
const HUB_API_KEY_ID = "00000000-0000-4000-8000-0000000000aa";
const hubOperationAuth: OperationAuthenticator = {
  async authorize(request: Request, _scope: ApiKeyScope) {
    return request.headers.get("authorization") === `Bearer ${HUB_API_KEY}`
      ? {
          status: "authorized" as const,
          access: {
            kind: "apiKey" as const,
            credentialId: HUB_API_KEY_ID,
            organizationId: HUB_ORGANIZATION_ID,
            scopes: [
              "projects:read",
              "configuration:validate",
              "configuration:install",
              "runs:dispatch",
              "daemons:enroll",
            ] as const,
          },
        }
      : { status: "unauthorized" as const };
  },
};

const IssuedEnrollmentSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
const EnrollmentSchema = z.object({
  daemonId: z.string(),
  slug: z.string(),
  scopes: z.array(z.string()),
  webSocketUrl: z.string(),
});
const ExecutionSessionRequestSchema = z.object({
  type: z.literal("session"),
  message: z.discriminatedUnion("type", [
    HubExecutionAgentCreateRequestSchema,
    HubExecutionAgentValidateRequestSchema,
    HubExecutionControlRequestSchema,
  ]),
});

export class HubHarness {
  private postgres: StartedPostgreSqlContainer | undefined;
  private database: Database | undefined;
  private readonly entitlements = createUnlimitedEntitlementsService();
  private server: Server | undefined;
  private hub: HubRuntime | undefined;
  private connectedDaemon: TestDaemon | undefined;
  private origin = "";
  private configurationRevisionId = "";
  private readonly clock = new HubClock();
  private lastEnrollmentToken: string | undefined;
  private lastEnrollmentExpiresAt: string | undefined;
  private completionHookFails = false;
  private completionGate: { promise: Promise<void>; release(): void } | undefined;
  private failureHookFails = false;
  private acceptanceHookFails = false;
  private acceptanceGate: { promise: Promise<void>; release(): void } | undefined;
  private materializationGate: { promise: Promise<void>; release(): void } | undefined;
  private recoveryRefreshGate:
    | {
        executionId: string;
        reached: Promise<void>;
        markReached(): void;
        released: Promise<void>;
        release(): void;
      }
    | undefined;
  private activityRefreshGate:
    | {
        executionId: string;
        reached: Promise<void>;
        markReached(): void;
        released: Promise<void>;
        release(): void;
      }
    | undefined;
  private materializations = 0;
  private acceptanceExecutionId: string | undefined;
  private failureHooks = 0;
  private resolveFailureNotification!: () => void;
  private readonly failureNotification = new Promise<void>((resolve) => {
    this.resolveFailureNotification = resolve;
  });
  private readonly startedHooks: Array<{
    triggerContext: unknown;
    outputContext: unknown;
  }> = [];
  private readonly completedHooks: Array<{
    triggerContext: unknown;
    outputContext: unknown;
  }> = [];
  private readonly terminalExecutionIds: string[] = [];
  private publicBaseUrlEnabled = true;
  private completionTokenSecretEnabled = true;
  private readonly authorityMints: Array<{
    projectId: string;
    connectionSlug: string;
    repositories: readonly string[];
    permissions: Readonly<Record<string, "read" | "write" | "admin">>;
  }> = [];
  private readonly authorityRevocations: string[] = [];
  private authorityTokenCount = 0;
  private issueAuthorityConnectionLease = false;
  private authorityMintPermanentlyUnresolved = false;
  private executionAuthority!: ExecutionAuthority;

  static async start(): Promise<HubHarness> {
    const harness = new HubHarness();
    try {
      await harness.startResources();
      return harness;
    } catch (error) {
      await harness.stop();
      throw error;
    }
  }

  static async startupFailureRollsBack(): Promise<boolean> {
    const harness = new HubHarness();
    try {
      harness.postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
      harness.database = await createDatabase(harness.postgres.getConnectionUri());
      throw new Error("startup interrupted");
    } catch {
      await harness.stop();
      return harness.postgres === undefined && harness.database === undefined;
    }
  }

  async issueEnrollment(auth: "valid" | "missing" | "wrong" = "valid") {
    let authorization: string | undefined;
    if (auth === "valid") authorization = `Bearer ${HUB_API_KEY}`;
    if (auth === "wrong") authorization = "Bearer wrong";
    const response = await fetch(`${this.origin}/api/v1/daemons/enrollment-tokens`, {
      method: "POST",
      ...(authorization === undefined ? {} : { headers: { authorization } }),
    });
    if (response.status !== 201) return { status: response.status } as const;
    const issued = IssuedEnrollmentSchema.parse(await response.json());
    this.lastEnrollmentToken = issued.token;
    this.lastEnrollmentExpiresAt = issued.expiresAt;
    return {
      status: 201,
      expiresAt: issued.expiresAt,
      token: issued.token,
    } as const;
  }

  async connectDaemon(token?: string): Promise<string> {
    const issued =
      token === undefined ? await this.issueEnrollment() : { status: 201 as const, token };
    if (issued.status !== 201 || !("token" in issued))
      throw new Error("Enrollment token was not issued");
    this.connectedDaemon = TestDaemon.create(this.origin);
    const daemon = await this.connectedDaemon.enroll(issued.token);
    await this.connectedDaemon.connect(daemon);
    return daemon.daemonId;
  }

  async enrollDaemon(hostname: string): Promise<Enrollment> {
    const issued = await this.issueEnrollment();
    if (issued.status !== 201 || !("token" in issued)) {
      throw new Error("Enrollment token was not issued");
    }
    return TestDaemon.create(this.origin).enroll(issued.token, hostname);
  }

  async renameConnectedDaemon(slug: string): Promise<void> {
    const daemon = this.requireDaemon();
    const renamed = await this.requireDatabase().renameDaemonForOrganization(
      HUB_ORGANIZATION_ID,
      daemon.daemonId,
      slug,
    );
    if (renamed === undefined || renamed.status === "slug_conflict") {
      throw new Error(`could not rename daemon to ${slug}`);
    }
  }

  async seedSlackWorkspace(teamId: string, slug = "paseo"): Promise<string> {
    if (this.postgres === undefined) throw new Error("Postgres is unavailable");
    const id = "00000000-0000-4000-8000-0000000000c1";
    const client = await createPostgresQueryRuntime(this.postgres.getConnectionUri());

    await client.query(
      `insert into slack_connections
         (id, organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes)
       values ($1, $2, $3, $4, 'Paseo', 'UBOT', 'xoxb-test', $5)
       on conflict (team_id) do nothing`,
      [id, HUB_ORGANIZATION_ID, teamId, slug, JSON.stringify(["app_mentions:read", "chat:write"])],
    );
    await client.close();
    return id;
  }

  async seedCurrentProjectResources(): Promise<string> {
    const slackId = await this.seedSlackWorkspace("paseo");
    if (this.postgres === undefined) throw new Error("Postgres is unavailable");
    const client = await createPostgresQueryRuntime(this.postgres.getConnectionUri());

    const githubId = "00000000-0000-4000-8000-0000000000c2";
    await client.query(
      `insert into discord_connections
         (id, organization_id, guild_id, slug, guild_name)
       values ('00000000-0000-4000-8000-0000000000c3', $1, 'paseo', 'paseo', 'Paseo')
       on conflict (guild_id) do nothing`,
      [HUB_ORGANIZATION_ID],
    );
    await client.query(
      `insert into github_connections
         (id, organization_id, installation_id, slug, account_id, account_login, account_type, status)
       values ($1, $2, 9001, 'getpaseo', 'getpaseo', 'getpaseo', 'Organization', 'active')
       on conflict (installation_id) do nothing`,
      [githubId, HUB_ORGANIZATION_ID],
    );
    await client.query(
      `insert into github_repositories
         (organization_id, connection_id, repository_id, full_name, default_branch)
       values
         ($1, $2, 9101, 'getpaseo/hub', 'main'),
         ($1, $2, 9102, 'getpaseo/paseo', 'main')
       on conflict (connection_id, repository_id) do nothing`,
      [HUB_ORGANIZATION_ID, githubId],
    );
    await client.close();
    return slackId;
  }

  async connectWithEnrollmentReplay(): Promise<{
    firstDaemonId: string;
    firstSlug: string;
    replayedDaemonId: string;
    replayedSlug: string;
    consumedTokenStatus: number;
    persistedDaemons: number;
  }> {
    const issued = await this.issueEnrollment();
    if (issued.status !== 201 || !("token" in issued))
      throw new Error("Enrollment token was not issued");
    this.connectedDaemon = TestDaemon.create(this.origin);
    const first = await this.connectedDaemon.enroll(issued.token, "Replay Host.local");
    const replay = await this.connectedDaemon.enroll(issued.token, "Replay Host.local");
    await this.connectedDaemon.connect(replay);
    const contender = TestDaemon.create(this.origin);
    const consumedTokenStatus = await contender.enrollmentStatus(issued.token);
    const persisted = await Promise.all([
      this.requireDatabase().findDaemonById(first.daemonId),
      this.requireDatabase().findDaemonById(contender.daemonId),
    ]);
    return {
      firstDaemonId: first.daemonId,
      firstSlug: first.slug,
      replayedDaemonId: replay.daemonId,
      replayedSlug: replay.slug,
      consumedTokenStatus,
      persistedDaemons: persisted.filter((daemon) => daemon !== undefined).length,
    };
  }

  async replaceDaemon(options: { acceptSpawns?: boolean } = {}): Promise<void> {
    const daemon = this.requireDaemon();
    const replacement = daemon.replacement();
    if (options.acceptSpawns === true) replacement.acceptSpawn();
    await replacement.connectExisting();
    await daemon.closed();
    this.connectedDaemon = replacement;
  }

  async revokeDaemon(): Promise<number> {
    const daemon = this.requireDaemon();
    const closed = daemon.closedCode();
    const response = await daemon.revoke();
    assert.equal(response, 204);
    return closed;
  }
  invalidCredentialReconnectStatus(): Promise<number> {
    return this.requireDaemon().reconnectStatus("invalid");
  }
  revokedCredentialReconnectStatus(): Promise<number> {
    return this.requireDaemon().reconnectStatus("valid");
  }

  async disconnectDaemon(): Promise<void> {
    await this.requireDaemon().disconnect();
  }

  async reconnectDaemon(): Promise<void> {
    const replacement = this.requireDaemon().replacement(this.origin);
    await replacement.connectExisting();
    this.connectedDaemon = replacement;
  }

  async reconnectDaemonAndCompleteHubAction(
    executionId: string,
  ): Promise<HubExecutionControlAction> {
    const replacement = this.requireDaemon().replacement(this.origin);
    const action = replacement.nextControlAction(executionId);
    await replacement.connectExisting();
    this.connectedDaemon = replacement;
    const acknowledged = await action;
    await this.completePendingCleanup(replacement.daemonId);
    return acknowledged;
  }

  async observeOfflinePresence(): Promise<void> {
    const daemonId = this.requireDaemon().daemonId;
    await waitFor(async () => (await this.daemon(daemonId)).presence === "offline");
  }

  async daemon(id?: string): Promise<DaemonRecord> {
    const daemon = await this.requireDatabase().findDaemonById(id ?? this.requireDaemon().daemonId);
    if (!daemon) throw new Error("Daemon does not exist");
    return daemon;
  }

  async enrollmentPrivacy(): Promise<{
    daemonHasCredential: boolean;
    databaseHasVerifierOnly: boolean;
  }> {
    const connectedDaemon = this.requireDaemon();
    const daemon = await this.daemon();
    return {
      daemonHasCredential: connectedDaemon.hasCredential(),
      databaseHasVerifierOnly: connectedDaemon.matchesStoredVerifier(daemon.credentialVerifier),
    };
  }

  async advanceEnrollmentBeyondExpiry(): Promise<void> {
    await this.clock.advanceBy(ENROLLMENT_LIFETIME_MS + 1);
  }

  async consumeLastEnrollment(): Promise<number> {
    if (!this.lastEnrollmentToken) throw new Error("No enrollment was issued");
    return this.consumeEnrollment(this.lastEnrollmentToken);
  }

  issuedEnrollmentLifetime(): number {
    if (!this.lastEnrollmentExpiresAt) throw new Error("No enrollment was issued");
    return Date.parse(this.lastEnrollmentExpiresAt) - Date.parse("2026-01-01T00:00:00.000Z");
  }

  async consumeEnrollment(token: string): Promise<number> {
    const daemon = TestDaemon.create(this.origin);
    return daemon.enrollmentStatus(token);
  }

  async dispatch(overrides: Partial<LaunchMachineIntent> = {}): Promise<DaemonDispatchResult> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    const requested = { ...this.intent(), ...overrides };
    const run = await this.requireDatabase().createRejectedTriggerRun({
      organizationId: requested.organizationId,
      projectId: requested.projectId,
      configurationRevisionId: requested.configurationRevisionId,
      providerEventReceiptId: await this.insertTestReceipt(requested),
      configuredTriggerName: requested.triggerName,
      prompt: requested.prompt,
      inputs: {},
      triggerContext: requested.triggerContext,
      outputContext: requested.outputContext,
      rejection: { code: "invalid_type", inputName: "individual", expectedType: "string" },
    });
    const { workflowStepRunId: _workflowStepRunId, ...intent } = {
      ...requested,
      triggerRunId: run.run.id,
    };
    return dispatchLaunchMachineIntent(module, intent);
  }
  async handoff(
    overrides: Partial<LaunchMachineIntent> = {},
    existingProviderEventReceiptId?: string,
  ): Promise<{ execution: AgentExecutionRecord; providerEventReceiptId: string }> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    const requested = { ...this.intent(), ...overrides };
    const providerEventReceiptId =
      existingProviderEventReceiptId ?? (await this.insertTestReceipt(requested));
    const intent = await this.attachDispatchRun(requested, providerEventReceiptId);
    const result = await module.lifecycle.handoffLaunchMachineIntent(intent);
    return { ...result, providerEventReceiptId };
  }
  async handoffBatch(
    triggerNames: readonly string[],
    existingProviderEventReceiptId?: string,
  ): Promise<{ executions: AgentExecutionRecord[]; providerEventReceiptId: string }> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    const first = this.intent(triggerNames[0]);
    const providerEventReceiptId =
      existingProviderEventReceiptId ?? (await this.insertTestReceipt(first));
    const intents = await Promise.all(
      this.batchIntents(providerEventReceiptId, triggerNames).map((intent) =>
        this.attachDispatchRun(intent, providerEventReceiptId),
      ),
    );
    const executions = await Promise.all(
      intents.map(
        async (intent) => (await module.lifecycle.handoffLaunchMachineIntent(intent)).execution,
      ),
    );
    return { executions, providerEventReceiptId };
  }
  async handoffAuthoredSlugBatch(
    slugs: readonly string[],
    existingProviderEventReceiptId?: string,
  ): Promise<{ executions: AgentExecutionRecord[]; providerEventReceiptId: string }> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    const first = this.intent(slugs[0] === "<connected>" ? this.requireDaemon().slug : slugs[0]);
    const providerEventReceiptId =
      existingProviderEventReceiptId ?? (await this.insertTestReceipt(first));
    const intents = await Promise.all(
      slugs.map((slug, index) =>
        this.attachDispatchRun(
          {
            ...this.intent(slug === "<connected>" ? this.requireDaemon().slug : slug),
            triggerName: `member-${index}`,
          },
          providerEventReceiptId,
        ),
      ),
    );
    const executions = await Promise.all(
      intents.map(
        async (intent) => (await module.lifecycle.handoffLaunchMachineIntent(intent)).execution,
      ),
    );
    return { executions, providerEventReceiptId };
  }
  async triggerStatus(providerEventReceiptId: string): Promise<string | null> {
    const runs =
      await this.requireDatabase().findTriggerRunsByProviderEventReceiptId(providerEventReceiptId);
    const statuses = runs.map((run) => run.status);
    if (statuses.length === 0) return null;
    if (statuses.some((status) => status === "failed")) return "failed";
    if (statuses.every((status) => status === "succeeded")) return "succeeded";
    return "running";
  }
  async triggerPrompt(providerEventReceiptId: string): Promise<string | undefined> {
    return (
      await this.requireDatabase().findTriggerRunsByProviderEventReceiptId(providerEventReceiptId)
    )[0]?.prompt;
  }
  async drainWorkflowOutbox(): Promise<void> {
    await this.requireHub().processWorkflowOutbox();
  }
  async persistUnlaunchedBatch(
    triggerNames: readonly string[],
    persistedCount = triggerNames.length,
    overrides: Partial<LaunchMachineIntent> = {},
  ): Promise<{ executions: AgentExecutionRecord[]; providerEventReceiptId: string }> {
    const database = this.requireDatabase();
    const first = this.intent();
    const providerEventReceiptId = await this.insertTestReceipt(first);
    const intents = await Promise.all(
      this.batchIntents(providerEventReceiptId, triggerNames).map((intent) =>
        this.attachDispatchRun(Object.assign({}, intent, overrides), providerEventReceiptId),
      ),
    );
    const daemon = await database.findDaemonForOrganization(
      intents[0]!.organizationId,
      intents[0]!.environment.daemonId,
    );
    if (daemon === undefined) throw new Error("Daemon is unavailable");
    const executions = [];
    for (const intent of intents.slice(0, persistedCount)) {
      const id = durableExecutionId(intent);
      const completionToken = deriveAgentExecutionCompletionToken(
        "hub-harness-completion-secret",
        id,
      );
      const execution = await database.insertAgentExecutionIfAbsent({
        id,
        organizationId: intent.organizationId,
        projectId: intent.projectId,
        machineId: daemon.machineId,
        daemonId: daemon.id,
        triggerContext: intent.triggerContext,
        outputContext: intent.outputContext,
        configurationRevisionId: intent.configurationRevisionId,
        completionTokenHash: hashAgentExecutionCompletionToken(completionToken),
        deadlineAt: new Date(this.clock.now() + 60 * 60_000),
        launchIntent: intent,
      });
      if (execution === undefined) throw new Error(`Execution already exists: ${id}`);
      executions.push(execution);
    }
    return { executions, providerEventReceiptId };
  }
  dispatchFrom(provider: "github" | "discord"): Promise<DaemonDispatchResult> {
    return this.dispatch({
      triggerContext: { provider, deliveryId: `${provider}-delivery` },
    });
  }
  dispatchWithWorktree(
    worktree: WorktreeTarget,
    autoArchive: boolean,
  ): Promise<DaemonDispatchResult> {
    return this.dispatch({
      environment: { ...this.intent().environment, worktree },
      autoArchive,
      triggerContext: {
        provider: "manual-discord",
        deliveryId: "delivery-1",
        event: { manual: { delivery_id: "delivery-1" } },
      },
    });
  }

  beginDispatch(overrides: Partial<LaunchMachineIntent> = {}): Promise<DaemonDispatchResult> {
    return this.dispatch(overrides);
  }
  async dispatchMissingDaemon(): Promise<unknown> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    return this.dispatch({
      environment: {
        ...this.intent().environment,
        daemonId: randomUUID(),
        authoredSlug: "missing-daemon",
      },
    });
  }
  handoffMissingDaemon(): Promise<{
    execution: AgentExecutionRecord;
    providerEventReceiptId: string;
  }> {
    return this.handoff({
      environment: {
        ...this.intent().environment,
        daemonId: randomUUID(),
        authoredSlug: "missing-daemon",
      },
    });
  }
  holdSpawnAcknowledgement(): void {
    this.requireDaemon().holdSpawnAcknowledgement();
  }
  leaveSpawnUnmaterialized(): void {
    this.requireDaemon().leaveSpawnUnmaterialized();
  }
  spawnBegins(): Promise<void> {
    return this.requireDaemon().spawnBegins();
  }
  acceptSpawn(): void {
    this.requireDaemon().acceptSpawn();
  }
  interruptPendingSpawn(): string {
    return this.requireDaemon().interruptPendingSpawn();
  }
  markPendingSpawnInterrupted(status: "closed" | "error"): string {
    return this.requireDaemon().markPendingSpawnInterrupted(status);
  }
  holdControlAcknowledgements(): void {
    this.requireDaemon().holdControlAcknowledgements();
  }
  pendingControlAction(executionId: string): Promise<HubExecutionControlAction> {
    return this.requireDaemon().nextControlAction(executionId);
  }
  releaseControl(executionId: string): void {
    this.requireDaemon().releaseControl(executionId);
  }
  interruptAgent(agentId: string): void {
    this.requireDaemon().changesStatus(agentId, "closed");
  }
  failureNotified(): Promise<void> {
    return this.failureNotification;
  }
  async acceptSpawnAndObserveControl(executionId: string): Promise<HubExecutionControlAction> {
    const action = this.requireDaemon().nextControlAction(executionId);
    this.acceptSpawn();
    const acknowledged = await action;
    await this.completePendingCleanup();
    return acknowledged;
  }
  async completePendingCleanup(daemonId = this.requireDaemon().daemonId): Promise<void> {
    const module = this.requireHub().daemonModule;
    if (!module) throw new Error("Daemon module is unavailable");
    await module.lifecycle.recoverPendingHubActions(daemonId);
  }
  async pendingExecution(): Promise<AgentExecutionRecord> {
    const execution = (await this.requireDatabase().findPendingAgentExecutions())[0];
    if (!execution) throw new Error("Pending execution does not exist");
    return execution;
  }
  async waitForPendingExecution(): Promise<AgentExecutionRecord> {
    await waitFor(async () => (await this.pendingExecutionCount()) > 0);
    return this.pendingExecution();
  }
  async pendingExecutionCount(): Promise<number> {
    return (await this.requireDatabase().findPendingAgentExecutions()).length;
  }
  async waitForRecoveredExecution(id: string): Promise<AgentExecutionRecord> {
    await waitFor(async () => (await this.execution(id)).daemonAgentId !== null);
    return this.execution(id);
  }
  async waitForExecutionStatus(
    id: string,
    status: AgentExecutionRecord["status"],
  ): Promise<AgentExecutionRecord> {
    await waitFor(async () => (await this.execution(id)).status === status);
    return this.execution(id);
  }
  rejectNextCreate(error: HubCreateError): void {
    this.requireDaemon().rejectNextCreate(error);
  }
  advanceDispatchTime(ms: number): Promise<void> {
    return this.clock.advanceBy(ms);
  }
  advanceDispatchClock(ms: number): void {
    this.clock.advanceClockBy(ms);
  }

  createdAgent() {
    return this.requireDaemon().createdAgent();
  }
  createdAgentLaunch() {
    const agent = this.createdAgent();
    const mcpServers = structuredClone(agent["mcpServers"]);
    if (isRecord(mcpServers) && isRecord(mcpServers["hub"])) {
      mcpServers["hub"]["headers"] = { Authorization: "Bearer <private>" };
    }
    return {
      provider: agent["provider"],
      modeId: agent["modeId"],
      cwd: agent["cwd"],
      prompt: agent["prompt"],
      thinkingOptionId: agent["thinkingOptionId"],
      providerOptions: agent["providerOptions"],
      toolPolicy: agent["toolPolicy"],
      env: agent["env"],
      mcpServers,
      worktree: agent["worktree"],
    };
  }
  async waitForCreatedAgentLaunch() {
    await waitFor(async () => this.requireDaemon().createdAgentCount() > 0);
    return this.createdAgentLaunch();
  }
  async waitForCreatedAgentRequests(count: number): Promise<void> {
    await waitFor(async () => this.requireDaemon().createdAgentRequestCount() >= count);
  }
  connectedDaemonSlug(): string {
    return this.requireDaemon().slug;
  }
  controlActions(): readonly HubExecutionControlAction[] {
    return this.requireDaemon().controlActions();
  }
  originUrl(): string {
    return this.origin;
  }
  async startExecution(agentId: string): Promise<void> {
    await this.requireDaemon().starts(agentId);
  }
  async beginReplacementTurn(agentId: string): Promise<void> {
    const execution = (await this.requireDatabase().findPendingAgentExecutions()).find(
      (candidate) => candidate.daemonAgentId === agentId,
    );
    if (execution === undefined) throw new Error("Replacement execution does not exist");
    const previousIdleDeadline = execution.idleDeadlineAt?.getTime() ?? null;
    await this.requireDaemon().startsTurn(agentId);
    if (previousIdleDeadline === null) return;
    await waitFor(async () => {
      const current = await this.execution(execution.id);
      return (
        current.idleDeadlineAt !== null && current.idleDeadlineAt.getTime() !== previousIdleDeadline
      );
    });
  }
  async emitReplacementTurn(agentId: string): Promise<void> {
    await this.requireDaemon().startsTurn(agentId);
  }
  async completeCurrentTurn(agentId: string): Promise<void> {
    await this.requireDaemon().completesTurn(agentId);
  }
  async completeCurrentTurnWithoutFinishTimeline(agentId: string): Promise<void> {
    await this.requireDaemon().completesTurnWithoutFinishTimeline(agentId);
  }
  async failCurrentTurn(agentId: string): Promise<void> {
    await this.requireDaemon().failsTurn(agentId);
  }
  failCompletionHook(): void {
    this.completionHookFails = true;
  }
  holdCompletionHook(): void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.completionGate = { promise, release };
  }
  completionHookBegins(): Promise<void> {
    return waitFor(async () => this.completedHooks.length > 0);
  }
  waitForCompletionHookCount(count: number): Promise<void> {
    return waitFor(async () => this.completedHooks.length === count);
  }
  releaseCompletionHook(): void {
    this.completionGate?.release();
    this.completionGate = undefined;
  }
  failTimeoutHook(): void {
    this.failureHookFails = true;
  }
  failAcceptanceHook(): void {
    this.acceptanceHookFails = true;
  }
  holdAcceptanceHook(): void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.acceptanceGate = { promise, release };
  }
  releaseAcceptanceHook(): void {
    this.acceptanceGate?.release();
    this.acceptanceGate = undefined;
  }
  holdLaunchMaterialization(): void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.materializationGate = { promise, release };
  }
  releaseLaunchMaterialization(): void {
    this.materializationGate?.release();
    this.materializationGate = undefined;
  }
  launchMaterializationCount(): number {
    return this.materializations;
  }
  holdRecoveryRefresh(executionId: string): void {
    let markReached!: () => void;
    let release!: () => void;
    this.recoveryRefreshGate = {
      executionId,
      reached: new Promise<void>((resolve) => {
        markReached = resolve;
      }),
      markReached,
      released: new Promise<void>((resolve) => {
        release = resolve;
      }),
      release,
    };
  }
  recoveryRefreshBegins(): Promise<void> {
    if (this.recoveryRefreshGate === undefined) throw new Error("Recovery refresh is not held");
    return this.recoveryRefreshGate.reached;
  }
  releaseRecoveryRefresh(): void {
    this.recoveryRefreshGate?.release();
    this.recoveryRefreshGate = undefined;
  }
  holdActivityRefresh(executionId: string): void {
    let markReached!: () => void;
    let release!: () => void;
    this.activityRefreshGate = {
      executionId,
      reached: new Promise<void>((resolve) => {
        markReached = resolve;
      }),
      markReached,
      released: new Promise<void>((resolve) => {
        release = resolve;
      }),
      release,
    };
  }
  activityRefreshBegins(): Promise<void> {
    if (this.activityRefreshGate === undefined) throw new Error("Activity refresh is not held");
    return this.activityRefreshGate.reached;
  }
  releaseActivityRefresh(): void {
    this.activityRefreshGate?.release();
    this.activityRefreshGate = undefined;
  }
  async terminateExecutionDirectly(executionId: string): Promise<void> {
    const transition = await this.requireDatabase().transitionAgentExecution(
      executionId,
      "failed",
      { result: { status: "failed", reason: "test_terminal_race" } },
    );
    assert.equal(transition.transitioned, true);
  }
  async acceptanceExecution(): Promise<AgentExecutionRecord> {
    if (this.acceptanceExecutionId === undefined) {
      throw new Error("acceptance hook did not observe an execution");
    }
    return this.execution(this.acceptanceExecutionId);
  }
  failureHookCount(): number {
    return this.failureHooks;
  }
  terminalHookCount(): number {
    return this.terminalExecutionIds.length;
  }
  authorityMintInputs() {
    return this.authorityMints;
  }
  authorityRevokedTokens(): readonly string[] {
    return this.authorityRevocations;
  }
  issueConnectionLeaseOnAuthorityMaterialization(): void {
    this.issueAuthorityConnectionLease = true;
  }
  hangAuthorityMintPermanently(): void {
    this.authorityMintPermanentlyUnresolved = true;
  }
  async waitForAuthorityMint(): Promise<void> {
    await waitFor(async () => this.authorityMints.length > 0);
  }
  async waitForAuthorityRevocation(): Promise<void> {
    await waitFor(async () => this.authorityRevocations.length > 0);
  }
  authorityStopResult(): ReturnType<ExecutionAuthority["stop"]> {
    return this.executionAuthority.stop();
  }
  hookContexts() {
    return { started: this.startedHooks, completed: this.completedHooks };
  }
  createdAgentCount(): number {
    return this.requireDaemon().createdAgentCount();
  }
  createdAgentRequestCount(): number {
    return this.requireDaemon().createdAgentRequestCount();
  }
  async runtimeResources(expected?: { recoveredExecutionSubscriptions: number }) {
    if (expected !== undefined) {
      try {
        await waitFor(async () => deepEqual(this.requireHub().resourceCounts(), expected));
      } catch (error) {
        throw new Error(
          `Runtime resources did not reach ${JSON.stringify(expected)}; observed ${JSON.stringify(this.requireHub().resourceCounts())}`,
          { cause: error },
        );
      }
    }
    return this.requireHub().resourceCounts();
  }

  async stopRuntimeResources() {
    const hub = this.requireHub();
    await hub.stop();
    return hub.resourceCounts();
  }

  async execution(id: string): Promise<AgentExecutionRecord> {
    const execution = await this.requireDatabase().findAgentExecutionById(id);
    if (!execution) throw new Error("Execution does not exist");
    return execution;
  }

  async workflowExecutionState(id: string) {
    const execution = await this.execution(id);
    const step =
      execution.workflowStepRunId === null
        ? undefined
        : await this.requireDatabase().findWorkflowStepRunById(execution.workflowStepRunId);
    const run =
      step === undefined
        ? undefined
        : await this.requireDatabase().findTriggerRunById(step.triggerRunId);
    return {
      executionStatus: execution.status,
      stepStatus: step?.status,
      stepOutput: step?.output,
      stepFailure: step?.failureReason,
      runStatus: run?.status,
      runFailure: run?.outcome === "accepted" ? run.failureReason : undefined,
    };
  }

  async agentBecomesIdle(executionId: string, agentId: string): Promise<Date> {
    const previousDeadline = (await this.execution(executionId)).idleDeadlineAt;
    this.requireDaemon().changesStatus(agentId, "idle");
    await waitFor(async () => {
      const deadline = (await this.execution(executionId)).idleDeadlineAt;
      return deadline !== null && deadline.getTime() !== previousDeadline?.getTime();
    });
    return (await this.execution(executionId)).idleDeadlineAt!;
  }

  async agentBecomesRunning(executionId: string, agentId: string): Promise<void> {
    this.requireDaemon().changesStatus(agentId, "running");
    await waitFor(async () => (await this.execution(executionId)).idleDeadlineAt === null);
  }

  async agentBeginsInitializing(executionId: string, agentId: string): Promise<void> {
    this.requireDaemon().changesStatus(agentId, "initializing");
    await waitFor(async () => (await this.execution(executionId)).idleDeadlineAt === null);
  }

  async agentTerminates(
    executionId: string,
    agentId: string,
    status: "error" | "closed",
  ): Promise<AgentExecutionRecord> {
    const previousFailureHooks = this.failureHooks;
    const previousControls = this.controlActions().length;
    this.requireDaemon().changesStatus(agentId, status);
    await waitFor(
      async () =>
        (await this.execution(executionId)).status === "failed" &&
        this.failureHooks > previousFailureHooks &&
        this.controlActions().length > previousControls,
    );
    return this.execution(executionId);
  }

  async staleIdleDeadlineAttemptsExpiry(
    executionId: string,
    staleDeadline: Date,
  ): Promise<boolean> {
    const transition = await this.requireDatabase().transitionAgentExecution(
      executionId,
      "failed",
      {
        result: { status: "failed", reason: "idle_timeout" },
        deadlineCondition: {
          kind: "idle",
          deadlineAt: staleDeadline,
          observedAt: staleDeadline,
        },
      },
    );
    return transition.transitioned;
  }

  async completeExecution(
    id: string,
    credential: "valid" | "missing" | "wrong" = "valid",
  ): Promise<number> {
    let token: string | undefined;
    if (credential === "valid") token = this.requireDaemon().completionToken(id);
    if (credential === "wrong") token = "wrong";
    const response = await fetch(`${this.origin}/agent-executions/${id}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "finish_execution", arguments: {} },
      }),
    });
    return response.status;
  }

  async callExecutionTool(
    executionId: string,
    name: "finish_execution" | "reply",
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = this.requireDaemon().completionToken(executionId);
    const response = await fetch(`${this.origin}/agent-executions/${executionId}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.ok(isRecord(body));
    return body;
  }

  async listExecutionTools(
    executionId: string,
  ): Promise<readonly { name: string; description: string; inputSchema: unknown }[]> {
    const token = this.requireDaemon().completionToken(executionId);
    const response = await fetch(`${this.origin}/agent-executions/${executionId}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });
    assert.equal(response.status, 200);
    return z
      .object({
        result: z.object({
          tools: z.array(
            z
              .object({
                name: z.string(),
                description: z.string(),
                inputSchema: z.unknown(),
              })
              .passthrough(),
          ),
        }),
      })
      .parse(await response.json()).result.tools;
  }

  async restartApp(): Promise<void> {
    await this.stopApp();
    await this.startApp();
    if (this.connectedDaemon) {
      const replacement = this.connectedDaemon.replacement(this.origin);
      await replacement.connectExisting();
      this.connectedDaemon = replacement;
    }
  }
  async restartAppWithoutDaemonReconnect(): Promise<void> {
    await this.stopApp();
    await this.startApp();
  }
  omitAgentSnapshotOnReconnect(): void {
    this.requireDaemon().omitAgentSnapshotOnReconnect();
  }
  async reconnectInterruptedAgent(agentId: string): Promise<void> {
    this.requireDaemon().interrupt(agentId);
    await this.restartApp();
  }
  async interruptedExecution(id: string): Promise<AgentExecutionRecord> {
    await waitFor(async () => (await this.execution(id)).status === "failed");
    return this.execution(id);
  }
  async restartWithoutCompletionUrl(): Promise<void> {
    this.publicBaseUrlEnabled = false;
    await this.restartApp();
  }
  async restartWithoutCompletionTokenSecret(): Promise<void> {
    this.completionTokenSecretEnabled = false;
    await this.restartApp();
  }

  async stop(): Promise<void> {
    await this.stopApp();
    if (this.database) {
      await this.database.close();
      this.database = undefined;
    }
    if (this.postgres) {
      await this.postgres.stop();
      this.postgres = undefined;
    }
  }

  manualConfigurationYaml(): string {
    return [
      "environments:",
      "  - name: production",
      "    kind: daemon",
      `    daemon: ${this.requireDaemon().slug}`,
      "    cwd: /workspace/manual",
      "    worktree:",
      "      mode: branch-off",
      '      newBranch: "manual-branch"',
      "      base: main",
      "triggers:",
      "  - name: deploy",
      "    on: manual.run",
      "    max_runtime: 2h",
      "    filters:",
      "      from_users: [alice]",
      "    steps:",
      "      - id: deploy-step",
      "        environment: production",
      "        max_runtime: 1h",
      "        idle_timeout: 5m",
      "        agent:",
      "          provider: opencode",
      "          mode: full-access",
      '        prompt: [{ text: "Deploy the requested service" }] ',
      "  - name: rollback",
      "    on: manual.run",
      "    max_runtime: 2h",
      "    filters:",
      "      from_users: [alice]",
      "    steps:",
      "      - id: rollback-step",
      "        environment: production",
      "        max_runtime: 1h",
      "        idle_timeout: 5m",
      "        agent:",
      "          provider: opencode",
      "          mode: full-access",
      '        prompt: [{ text: "Rollback the requested service" }] ',
    ].join("\n");
  }

  async installConfiguration(input: {
    yaml: string;
    auth?: "valid" | "missing" | "wrong";
  }): Promise<{ status: number; versionId?: string; validationErrors?: unknown }> {
    return this.installBundle({
      files: configurationBundleFixture(input.yaml),
      ...(input.auth === undefined ? {} : { auth: input.auth }),
    });
  }

  async installBundle(input: {
    files: readonly HubBundleFile[];
    auth?: "valid" | "missing" | "wrong";
  }): Promise<{ status: number; versionId?: string; validationErrors?: unknown }> {
    const headers = machineHeaders(input.auth ?? "valid");
    const response = await fetch(`${this.origin}/api/v1/configurations/install`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        projectSlug: HUB_PROJECT_SLUG,
        files: input.files,
      }),
    });
    const body = z
      .object({
        versionId: z.string().optional(),
        error: z.string().optional(),
        code: z.string().optional(),
        issues: z.unknown().optional(),
      })
      .passthrough()
      .parse(await response.json());
    const validationErrors =
      body.versionId === undefined
        ? undefined
        : (
            await this.requireDatabase().findProjectConfigurationRevision(
              HUB_PROJECT_ID,
              body.versionId,
            )
          )?.validationErrors;
    const errorCode = body.error ?? body.code;
    return {
      status: response.status,
      ...(body.versionId === undefined ? {} : { versionId: body.versionId }),
      ...(errorCode === undefined ? {} : { error: errorCode }),
      ...(body.issues === undefined ? {} : { issues: body.issues }),
      ...(validationErrors === undefined || validationErrors === null ? {} : { validationErrors }),
    };
  }

  slackConfigurationYaml(): string {
    return [
      "environments:",
      "  - name: production",
      "    kind: daemon",
      `    daemon: ${this.requireDaemon().slug}`,
      "    cwd: /workspace/slack",
      "triggers:",
      "  - name: slack-mention",
      "    on: slack.mention",
      "    max_runtime: 2h",
      "    filters:",
      "      from_users: [U1]",
      "    steps:",
      "      - id: inspect",
      "        environment: production",
      "        max_runtime: 1h",
      "        idle_timeout: 5m",
      "        auto_archive: true",
      "        agent:",
      "          provider: opencode",
      "          mode: full-access",
      '        prompt: [{ text: "Review ${{ paseo.prompt }}\\nContext: ${{ paseo.context }}" }]',
    ].join("\n");
  }

  async deliverSlackMention(): Promise<Response> {
    return fetch(`${this.origin}/test/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: HUB_ORGANIZATION_ID,
        projectId: HUB_PROJECT_ID,
        connectionId: "00000000-0000-4000-8000-000000000002",
        resourceId: "T1",
        source: "slack.mention",
        deliveryId: "slack-harness-image-1",
        receivedAt: "2026-08-05T10:00:00.000Z",
        payload: {
          type: "mention",
          id: "Ev-harness-image-1",
          teamId: "T1",
          appId: "A1",
          channelId: "C1",
          messageTs: "1700000000.000100",
          threadTs: "1700000000.000001",
          eventTs: "1700000000.000100",
          eventTime: 1_700_000_001,
          content: "<@UBOT> inspect this image",
          author: { id: "U1" },
          createdAt: "2023-11-14T22:13:20.100Z",
          attachments: [],
        },
      }),
    });
  }

  async deliverCurrentProjectSlackMention(connectionId: string): Promise<Response> {
    return fetch(`${this.origin}/test/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: HUB_ORGANIZATION_ID,
        projectId: HUB_PROJECT_ID,
        connectionId,
        resourceId: "paseo",
        source: "slack.mention",
        deliveryId: "current-project-slack-1",
        receivedAt: "2026-08-10T10:00:00.000Z",
        payload: {
          type: "mention",
          id: "Ev-current-project-1",
          teamId: "paseo",
          appId: "A1",
          channelId: "C1",
          messageTs: "1700000000.000100",
          threadTs: "1700000000.000001",
          eventTs: "1700000000.000100",
          eventTime: 1_700_000_001,
          content: "<@UBOT> investigate the routing failure",
          author: { id: "maintainer" },
          createdAt: "2023-11-14T22:13:20.100Z",
          attachments: [],
        },
      }),
    });
  }

  async activeConfiguration() {
    const current = await this.requireDatabase().findActiveProjectConfiguration(HUB_PROJECT_ID);
    return current === undefined ? null : { id: current.id, version: current.version };
  }

  async attemptOperatorOrganizationOverride(organizationId: string): Promise<{
    configurationStatus: number;
    manualStatus: number;
  }> {
    const headers = {
      "content-type": "application/json",
      ...machineHeaders("valid"),
    };
    const [configuration, manual] = await Promise.all([
      fetch(`${this.origin}/api/v1/configurations/install`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          projectSlug: HUB_PROJECT_SLUG,
          files: configurationBundleFixture(this.manualConfigurationYaml()),
        }),
      }),
      fetch(`${this.origin}/api/v1/manual-runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          config: "manual-production",
          trigger: "deploy",
          actor: "alice",
          deliveryKey: "override-delivery",
          input: { service: "api" },
        }),
      }),
    ]);
    return {
      configurationStatus: configuration.status,
      manualStatus: manual.status,
    };
  }

  async runManual(input: {
    actor?: string;
    deliveryKey?: string;
    service?: string;
    auth?: "valid" | "missing" | "wrong";
    projectSlug?: string;
    trigger?: string;
    expectedVersionId?: string | undefined;
  }): Promise<{
    status: number;
    error?: string;
    providerEventReceiptId?: string;
    triggerRunId?: string;
    configuredTriggerName?: string;
    workflowStatus?: string;
  }> {
    const response = await fetch(`${this.origin}/api/v1/manual-runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...machineHeaders(input.auth ?? "valid"),
      },
      body: JSON.stringify({
        projectSlug: input.projectSlug ?? HUB_PROJECT_SLUG,
        ...(input.expectedVersionId === undefined
          ? {}
          : { expectedVersionId: input.expectedVersionId }),
        trigger: input.trigger ?? "deploy",
        actor: input.actor ?? "alice",
        deliveryKey: input.deliveryKey ?? "manual-delivery-1",
        input: { service: input.service ?? "api" },
      }),
    });
    if (response.status >= 500)
      throw new Error("manual run was interrupted by application restart");
    const body = z
      .object({
        providerEventReceiptId: z.string().optional(),
        triggerRunId: z.string().optional(),
        configuredTriggerName: z.string().optional(),
        workflowStatus: z.string().optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      })
      .passthrough()
      .parse(await response.json());
    const errorCode = body.error ?? body.code;
    return {
      status: response.status,
      ...(errorCode === undefined ? {} : { error: errorCode }),
      ...(body.providerEventReceiptId === undefined
        ? {}
        : { providerEventReceiptId: body.providerEventReceiptId }),
      ...(body.triggerRunId === undefined ? {} : { triggerRunId: body.triggerRunId }),
      ...(body.configuredTriggerName === undefined
        ? {}
        : { configuredTriggerName: body.configuredTriggerName }),
      ...(body.workflowStatus === undefined ? {} : { workflowStatus: body.workflowStatus }),
    };
  }

  async runCanonicalManual(input: {
    deliveryKey: string;
  }): Promise<{ status: number; triggerRunId?: string }> {
    const response = await fetch(`${this.origin}/api/v1/manual-runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...machineHeaders("valid") },
      body: JSON.stringify({
        projectSlug: HUB_PROJECT_SLUG,
        trigger: "deploy",
        actor: "alice",
        deliveryKey: input.deliveryKey,
        input: {},
      }),
    });
    const body = z
      .object({ triggerRunId: z.string().optional() })
      .passthrough()
      .parse(await response.json());
    return {
      status: response.status,
      ...(body.triggerRunId === undefined ? {} : { triggerRunId: body.triggerRunId }),
    };
  }

  async failedTriggerRun(id: string): Promise<TriggerRunRecord> {
    await waitFor(
      async () => (await this.requireDatabase().findTriggerRunById(id))?.status === "failed",
    );
    const run = await this.requireDatabase().findTriggerRunById(id);
    if (run === undefined) throw new Error("Trigger run does not exist");
    return run;
  }

  beginManual(
    input: {
      projectSlug?: string;
      trigger?: string;
      actor?: string;
      deliveryKey?: string;
      service?: string;
      auth?: "valid" | "missing" | "wrong";
      expectedVersionId?: string;
    } = {},
  ) {
    return this.runManual(input);
  }

  async runOverlappingManualDelivery(deliveryKey: string) {
    this.holdSpawnAcknowledgement();
    const firstRequest = this.runManual({ deliveryKey });
    await this.spawnBegins();
    const secondRequest = this.runManual({ deliveryKey });
    this.acceptSpawn();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    return { first, second };
  }

  private async startResources(): Promise<void> {
    this.postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    this.database = await createDatabase(this.postgres.getConnectionUri());
    const client = await createPostgresQueryRuntime(this.postgres.getConnectionUri());

    await client.query(
      `insert into organization (id, name, slug) values ('org_1', 'Hub harness', 'hub-harness')`,
    );
    await client.query(
      `insert into "user" (id, name, email, email_verified)
       values ($1, 'Hub harness', 'hub-harness@paseo.test', true)`,
      [HUB_USER_ID],
    );
    await client.query(
      `insert into member (id, organization_id, user_id, role)
       values ($1, $2, $3, 'owner')`,
      [randomUUID(), HUB_ORGANIZATION_ID, HUB_USER_ID],
    );
    await client.query(
      `insert into organization_api_keys
         (id, organization_id, name, prefix, verifier, scopes, created_by_user_id)
       values ($1, $2, 'Hub harness', 'paseo_pk_harness', 'hub-harness-verifier',
               $3, $4)`,
      [
        HUB_API_KEY_ID,
        HUB_ORGANIZATION_ID,
        ["configuration:install", "runs:dispatch", "daemons:enroll"],
        HUB_USER_ID,
      ],
    );
    await client.query(
      `insert into projects (id, organization_id, name, slug, created_by_user_id)
       values ($1, $2, 'Default', $3, $4)`,
      [HUB_PROJECT_ID, HUB_ORGANIZATION_ID, HUB_PROJECT_SLUG, HUB_USER_ID],
    );
    await client.close();
    const store = new ProjectConfigurationStore(this.database, HUB_PROJECT_ID);
    await this.database.issueEnrollmentToken({
      id: "00000000-0000-4000-8000-0000000000ee",
      verifier: "seed-daemon-token",
      organizationId: HUB_ORGANIZATION_ID,
      issuedByApiKeyId: HUB_API_KEY_ID,
      expiresAt: new Date(Date.now() + ENROLLMENT_LIFETIME_MS),
      consumedAt: null,
    });
    await this.database.enrollDaemon({
      tokenVerifier: "seed-daemon-token",
      daemonId: "00000000-0000-4000-8000-0000000000dd",
      idempotencyKey: "seed-daemon-idempotency",
      serverId: "seed-server",
      daemonPublicKey: "seed-public-key",
      credentialVerifier: "seed-credential-verifier",
      scopes: ["hub.execution.*"],
      now: new Date(),
    });
    const config = await store.insertManualBundleRevision({
      files: configurationBundleFixture(
        dump({
          environments: [
            { name: "test", kind: "daemon", daemon: "daemon-00000000", cwd: "/workspace" },
          ],
          triggers: ["discord-ping", "first", "second", "member-0", "member-1"].map((name) => ({
            name,
            on: "discord.mention",
            max_runtime: "2h",
            filters: { from_users: ["test-user"] },
            steps: [
              {
                id: "discord-step",
                environment: "test",
                max_runtime: "1h",
                idle_timeout: "5m",
                agent: { provider: "opencode", mode: "full-access" },
                prompt: [{ text: "Reply pong." }],
              },
            ],
          })),
        }),
      ),
      userId: null,
      sourceEvidence: { kind: "admin-seed", userId: HUB_USER_ID },
    });
    await store.activate(config.id);
    this.configurationRevisionId = config.id;
    await this.startApp();
  }

  private async startApp(): Promise<void> {
    const port = await availablePort();
    this.origin = `http://127.0.0.1:${port}`;
    this.executionAuthority = this.createExecutionAuthority();
    const registry = new OutputExecutorRegistry();
    registry.register({
      type: "discord.reply",
      tool: replyOutputTool,
      available: outputContextProvider("discord"),
      execute: async () => undefined,
    });
    registry.register({
      type: "slack.reply",
      tool: replyOutputTool,
      available: outputContextProvider("slack"),
      execute: async () => undefined,
    });
    const application = createHubApplication({
      database: this.databaseForApplication(),
      entitlements: this.entitlements,
      providers: [this.recordingProvider()],
      providerFactories: [
        ({ configurationStoreForProject, attachments }) =>
          createSlackTriggerProvider({
            configurationStoreForProject,
            botUserIdForWorkspace: () => Promise.resolve("UBOT"),
            client: new HarnessSlackClient(),
            ...(attachments === undefined ? {} : { attachments }),
          }),
      ],
      attachmentResolvers: { slack: createSlackAttachmentResolver(new HarnessSlackClient()) },
      outputRegistry: registry,
      publicApi: { status: "enabled", authenticator: hubOperationAuth },
      ...(this.completionTokenSecretEnabled
        ? { completionTokenSecret: "hub-harness-completion-secret" }
        : {}),
      ...(this.publicBaseUrlEnabled ? { publicBaseUrl: this.origin } : {}),
      daemonClock: this.clock,
      executionDeadlineClock: this.clock,
      executionAuthority: this.executionAuthority,
      dispatchTimeoutMs: 30_000,
    });
    const hub = application.hub;
    await hub.start();
    await startApplication(() => ({
      hub,
      operations: application.operations,
      publicApi: application.publicApi,
      resources: null,
      billing: null,
      projectDashboard: null,
      usageDashboard: null,
      operatorConsole: null,
      providerApplications: null,
      testTriggerRoutes: true,
      auth: () => Promise.resolve(new Response("Not Found", { status: 404 })),
      organizationResources: () => Promise.reject(new Error("organization resources unavailable")),
      connectionStatus: () =>
        Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 })),
      connectionAction: () =>
        Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 })),
      webhook: () => Promise.resolve(new Response("Not Found", { status: 404 })),
      billingWebhook: () => Promise.resolve(new Response("Not Found", { status: 404 })),
      billingPlans: () => Promise.resolve(null),
      billingConfigured: () => false,
      billingOverview: () => Promise.reject(new Error("billing is not configured")),
      billingCheckout: () => Promise.reject(new Error("billing is not configured")),
      billingPortal: () => Promise.reject(new Error("billing is not configured")),
      providerRequest: () => Promise.resolve(new Response("Not Found", { status: 404 })),
      stop: () => hub.stop(),
    }));
    const server = createFetchServer(createStartHandler(defaultStreamHandler));
    server.on(
      "upgrade",
      (request: IncomingMessage, socket: Duplex, head: Buffer) =>
        void hub?.handleUpgrade?.(request, socket, head),
    );
    server.listen(port, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    this.hub = hub;
    this.server = server;
  }

  private createExecutionAuthority(): ExecutionAuthority {
    return createExecutionAuthority({
      connectionsForProject: () => async (connectionSlug, value, context) => {
        if (connectionSlug !== "some-connection" || value !== "token") {
          throw new Error(`unexpected test connection: ${connectionSlug}.${value}`);
        }
        if (this.issueAuthorityConnectionLease) {
          await context?.registerToken?.("durable-connection-token", async () => {
            this.authorityRevocations.push("durable-connection-token");
          });
        }
        return "resolved-secret";
      },
      githubAuthority: {
        mint: async (input) => {
          this.authorityMints.push(input);
          if (this.authorityMintPermanentlyUnresolved) {
            await new Promise<never>(() => undefined);
          }
          this.authorityTokenCount += 1;
          return {
            token: `durable-scoped-token-${this.authorityTokenCount}`,
            expiresAt: Date.now() + 60 * 60_000,
            botUserId: 1234,
            botLogin: "paseo[bot]",
          };
        },
        revoke: async (token) => {
          this.authorityRevocations.push(token);
        },
      } satisfies GitHubAuthorityRegistration,
      isExecutionActive: async (executionId) => {
        const execution = await this.requireDatabase().findAgentExecutionById(executionId);
        return execution?.status === "spawning" || execution?.status === "running";
      },
    });
  }

  private async stopApp(): Promise<void> {
    const server = this.server;
    this.hub = undefined;
    this.server = undefined;
    await stopApplication();
    if (server) {
      if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private intent(authoredSlug = this.requireDaemon().slug): LaunchMachineIntent {
    return {
      kind: "launch_machine",
      organizationId: HUB_ORGANIZATION_ID,
      projectId: HUB_PROJECT_ID,
      triggerRunId: randomUUID(),
      triggerName: "discord-ping",
      environmentName: "hub-daemon",
      environment: {
        kind: "daemon",
        daemonId: this.requireDaemon().daemonId,
        authoredSlug,
        cwd: "/workspace",
      },
      env: { USER_DEFINED: "yes" },
      prompt: "Reply pong.",
      agent: {
        provider: "opencode",
        mode: "full-access",
        thinkingOptionId: "xhigh",
      },
      allowOutputs: [{ type: "discord.reply", max: 1 }],
      autoArchive: false,
      triggerContext: { provider: "manual-discord", deliveryId: randomUUID() },
      outputContext: { channelId: "channel-1" },
      configurationRevisionId: this.configurationRevisionId,
      hubConfig: { triggers: [{ name: "discord-ping" }] },
    };
  }

  private async insertTestReceipt(intent: LaunchMachineIntent): Promise<string> {
    const result = await this.requireDatabase().persistManualEvent({
      organizationId: intent.organizationId,
      projectId: intent.projectId,
      deliveryId: randomUUID(),
      source: "manual.test_dispatch",
      payload: {},
      receivedAt: new Date(),
    });
    if (result.status !== "accepted") throw new Error("test receipt was not accepted");
    return result.event.providerEventReceiptId;
  }

  private batchIntents(
    _providerEventReceiptId: string,
    triggerNames: readonly string[],
  ): LaunchMachineIntent[] {
    return triggerNames.map((triggerName) => ({
      ...this.intent(),
      triggerName,
    }));
  }

  private async attachDispatchRun(
    intent: LaunchMachineIntent,
    providerEventReceiptId: string,
  ): Promise<LaunchMachineIntent> {
    const database = this.requireDatabase();
    const existing = (
      await database.findTriggerRunsByProviderEventReceiptId(providerEventReceiptId)
    ).find((run) => run.configuredTriggerName === intent.triggerName);
    const run =
      existing ??
      (
        await database.createAcceptedTriggerRun({
          organizationId: intent.organizationId,
          projectId: intent.projectId,
          configurationRevisionId: intent.configurationRevisionId,
          providerEventReceiptId,
          configuredTriggerName: intent.triggerName,
          prompt: intent.prompt,
          inputs: {},
          triggerContext: intent.triggerContext,
          outputContext: intent.outputContext,
          deadlineAt:
            intent.deadlineAt ?? new Date(this.clock.now() + (intent.timeoutMs ?? 30 * 60_000)),
          stepIds: ["dispatch"],
        })
      ).run;
    const step = await database.findWorkflowStepRunByTriggerRun(run.id);
    return {
      ...intent,
      triggerRunId: run.id,
      ...(step === undefined ? {} : { workflowStepRunId: step.id }),
    };
  }

  private requireDatabase(): Database {
    if (!this.database) throw new Error("Database is unavailable");
    return this.database;
  }
  private databaseForApplication(): Database {
    const database = this.requireDatabase();
    return new Proxy(database, {
      get: (target, property) => {
        if (property === "findAgentExecutionById") {
          return async (executionId: string) => {
            const gate = this.recoveryRefreshGate;
            if (gate?.executionId === executionId) {
              gate.markReached();
              await gate.released;
            }
            const activityGate = this.activityRefreshGate;
            if (activityGate?.executionId === executionId) {
              activityGate.markReached();
              await activityGate.released;
            }
            return target.findAgentExecutionById(executionId);
          };
        }
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown;
      },
    });
  }
  private requireHub(): HubRuntime {
    if (!this.hub) throw new Error("Hub is unavailable");
    return this.hub;
  }
  private requireDaemon(): TestDaemon {
    if (!this.connectedDaemon) throw new Error("Daemon is unavailable");
    return this.connectedDaemon;
  }

  private recordingProvider(): TriggerProvider {
    return {
      name: "manual-discord",
      eventNames: ["discord.mention"],
      async match() {
        return [];
      },
      materializeLaunch: async (launch) => {
        this.materializations += 1;
        await this.materializationGate?.promise;
        return {
          ...(launch.environmentEnv === undefined
            ? {}
            : {
                environmentEnv: Object.fromEntries(
                  Object.entries(launch.environmentEnv).map(([key, value]) => [
                    key,
                    value.replace("<secret>", "resolved-secret"),
                  ]),
                ),
              }),
          ...(launch.environmentWorktree === undefined ||
          !JSON.stringify(launch.environmentWorktree).includes("<secret>")
            ? {}
            : {
                environmentWorktree: materializeTestWorktree(launch.environmentWorktree),
              }),
        };
      },
      onDispatchAccepted: async () => {
        this.acceptanceExecutionId = (
          await this.requireDatabase().findPendingAgentExecutions()
        )[0]?.id;
        await this.acceptanceGate?.promise;
        if (this.acceptanceHookFails) throw new Error("acceptance hook failed");
      },
      onAgentExecutionStarted: async (triggerContext, outputContext) => {
        this.startedHooks.push({ triggerContext, outputContext });
      },
      onAgentExecutionCompleted: async (triggerContext, outputContext) => {
        this.completedHooks.push({ triggerContext, outputContext });
        await this.completionGate?.promise;
        if (this.completionHookFails) throw new Error("completion hook failed");
      },
      onAgentExecutionFailed: async () => {
        this.failureHooks += 1;
        this.resolveFailureNotification();
        if (this.failureHookFails) throw new Error("failure hook failed");
      },
      onAgentExecutionTerminal: async (executionId) => {
        this.terminalExecutionIds.push(executionId);
      },
    };
  }
}

class HarnessSlackClient implements SlackBotClient {
  sendMessage(): Promise<void> {
    return Promise.resolve();
  }

  addReaction(): Promise<void> {
    return Promise.resolve();
  }

  removeReaction(): Promise<void> {
    return Promise.resolve();
  }

  readThreadMessages(): Promise<SlackThreadReadResult> {
    return Promise.resolve({
      complete: true,
      messages: [
        {
          ts: "1700000000.000050",
          createdAt: "2023-11-14T22:13:20.050Z",
          content: "Please inspect the latest diagram",
          author: { id: "U2" },
          attachments: [
            {
              id: "F1",
              filename: "diagram.png",
              contentType: "image/png",
              size: 19,
            },
          ],
        },
        {
          ts: "1700000000.000075",
          createdAt: "2023-11-14T22:13:20.075Z",
          content: "I agree, this is the bot follow-up",
          author: { id: "B2" },
          attachments: [],
        },
      ],
    });
  }

  downloadAttachment(input: { fileId: string }): Promise<Response> {
    if (input.fileId !== "F1") return Promise.resolve(new Response("Not Found", { status: 404 }));
    return Promise.resolve(
      new Response("diagram-image-bytes", {
        headers: { "content-type": "image/png", "content-length": "19", etag: '"diagram-1"' },
      }),
    );
  }
}

function materializeTestWorktree(worktree: WorktreeTarget): WorktreeTarget {
  switch (worktree.mode) {
    case "branch-off":
      return {
        mode: "branch-off",
        newBranch: worktree.newBranch.replace("<secret>", "resolved-secret"),
        ...(worktree.base === undefined
          ? {}
          : { base: worktree.base.replace("<secret>", "resolved-secret") }),
      };
    case "checkout-branch":
      return {
        mode: "checkout-branch",
        branch: worktree.branch.replace("<secret>", "resolved-secret"),
      };
    case "checkout-pr":
      return worktree;
  }
  throw new Error(`unhandled worktree mode: ${JSON.stringify(worktree)}`);
}

class HubClock implements DaemonClock, ExecutionDeadlineClock {
  private nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  private nextId = 0;
  private readonly timers = new Map<number, { dueAt: number; callback: () => Promise<void> }>();
  now(): number {
    return this.nowMs;
  }
  nowDate(): Date {
    return new Date(this.nowMs);
  }
  advanceClockBy(ms: number): void {
    this.nowMs += ms;
  }
  schedule(callback: () => Promise<void>, delayMs: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.nowMs + delayMs, callback });
    return () => this.timers.delete(id);
  }
  async advanceBy(ms: number): Promise<void> {
    this.advanceClockBy(ms);
    for (const [id, timer] of this.timers) {
      if (timer.dueAt <= this.nowMs) {
        this.timers.delete(id);
        await timer.callback();
      }
    }
  }
}

interface Enrollment {
  daemonId: string;
  slug: string;
  webSocketUrl: string;
  scopes: string[];
}
class TestDaemon {
  private socket: WebSocket | undefined;
  private readonly agents = new Map<string, Record<string, unknown>>();
  private createRequests = 0;
  private readonly controls: HubExecutionControlAction[] = [];
  private readonly pendingControlActions = new Map<
    string,
    (action: HubExecutionControlAction) => void
  >();
  private readonly controlActionsByExecution = new Map<string, HubExecutionControlAction>();
  private readonly heldControls = new Map<
    string,
    {
      requestId: string;
      executionId: string;
      action: HubExecutionControlAction;
    }
  >();
  private pendingCreate: { requestId: string; executionId: string } | undefined;
  private holdAck = false;
  private holdControlAck = false;
  private materializeSpawn = true;
  private omitSnapshotOnReconnect = false;
  private nextCreateError: HubCreateError | undefined;
  private resolveSpawn!: () => void;
  private readonly spawnObserved = new Promise<void>((resolve) => {
    this.resolveSpawn = resolve;
  });
  private readonly idempotencyKey = randomUUID();
  private constructor(
    private readonly origin: string,
    readonly daemonId: string,
    readonly slug: string,
    private readonly credential: string,
    private readonly webSocketUrl?: string,
  ) {}
  static create(origin: string): TestDaemon {
    const id = randomUUID();
    return new TestDaemon(origin, id, `daemon-${id.slice(0, 8)}`, randomUUID());
  }
  async enroll(token: string, hostname?: string): Promise<Enrollment> {
    const response = await fetch(`${this.origin}/api/daemons/enroll`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        daemonId: this.daemonId,
        idempotencyKey: this.idempotencyKey,
        serverId: randomUUID(),
        daemonPublicKey: "public-key",
        credentialVerifier: createHash("sha256").update(this.credential).digest("base64url"),
        ...(hostname === undefined ? {} : { hostname }),
      }),
    });
    if (response.status !== 200) throw new Error(`Enrollment failed: ${response.status}`);
    const enrollment = EnrollmentSchema.parse(await response.json());
    Object.assign(this, { webSocketUrl: enrollment.webSocketUrl });
    return enrollment;
  }
  async enrollmentStatus(token: string): Promise<number> {
    const response = await fetch(`${this.origin}/api/daemons/enroll`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        daemonId: this.daemonId,
        idempotencyKey: randomUUID(),
        serverId: randomUUID(),
        daemonPublicKey: "public-key",
        credentialVerifier: createHash("sha256").update(this.credential).digest("base64url"),
      }),
    });
    return response.status;
  }
  async connect(enrollment: Enrollment): Promise<void> {
    Object.assign(this, { webSocketUrl: enrollment.webSocketUrl });
    await this.connectExisting();
  }
  async connectExisting(): Promise<void> {
    if (!this.webSocketUrl) throw new Error("Daemon has no socket URL");
    const socket = new WebSocket(this.webSocketUrl, {
      headers: {
        authorization: `Bearer ${this.credential}`,
        "x-paseo-daemon-id": this.daemonId,
      },
    });
    socket.on("message", (data) => this.receive(data));
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
  }
  async reconnectStatus(credential: "valid" | "invalid"): Promise<number> {
    if (!this.webSocketUrl) throw new Error("Daemon has no socket URL");
    const secret = credential === "valid" ? this.credential : "invalid";
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl!, {
        headers: {
          authorization: `Bearer ${secret}`,
          "x-paseo-daemon-id": this.daemonId,
        },
      });
      socket.once("unexpected-response", (_request, response) => {
        if (response.statusCode === undefined) {
          reject(new Error("Upgrade response had no status"));
          return;
        }
        resolve(response.statusCode);
      });
      socket.once("error", reject);
    });
  }
  replacement(origin = this.origin): TestDaemon {
    const webSocketUrl = new URL("/api/daemons/socket", origin);
    webSocketUrl.protocol = "ws:";
    const replacement = new TestDaemon(
      origin,
      this.daemonId,
      this.slug,
      this.credential,
      webSocketUrl.toString(),
    );
    for (const [agentId, agent] of this.agents) replacement.agents.set(agentId, agent);
    replacement.controls.push(...this.controls);
    replacement.createRequests = this.createRequests;
    replacement.omitSnapshotOnReconnect = this.omitSnapshotOnReconnect;
    replacement.holdControlAck = this.holdControlAck;
    replacement.materializeSpawn = this.materializeSpawn;
    return replacement;
  }
  omitAgentSnapshotOnReconnect(): void {
    this.omitSnapshotOnReconnect = true;
  }
  rejectNextCreate(error: HubCreateError): void {
    this.nextCreateError = error;
  }
  holdSpawnAcknowledgement(): void {
    this.holdAck = true;
  }
  leaveSpawnUnmaterialized(): void {
    this.materializeSpawn = false;
  }
  holdControlAcknowledgements(): void {
    this.holdControlAck = true;
  }
  spawnBegins(): Promise<void> {
    return this.spawnObserved;
  }
  controlActions(): readonly HubExecutionControlAction[] {
    return this.controls;
  }
  nextControlAction(executionId: string): Promise<HubExecutionControlAction> {
    const observed = this.controlActionsByExecution.get(executionId);
    if (observed !== undefined) return Promise.resolve(observed);
    return new Promise((resolve) => {
      this.pendingControlActions.set(executionId, resolve);
    });
  }
  releaseControl(executionId: string): void {
    const request = this.heldControls.get(executionId);
    if (request === undefined) throw new Error("No held control request");
    this.heldControls.delete(executionId);
    this.acknowledgeControl(request);
  }
  acceptSpawn(): void {
    this.holdAck = false;
    if (this.pendingCreate) this.acknowledge(this.pendingCreate);
  }
  interruptPendingSpawn(): string {
    if (!this.pendingCreate) throw new Error("No pending create request");
    const agentId = `agent-${this.pendingCreate.executionId}`;
    this.changesStatus(agentId, "closed");
    return agentId;
  }
  markPendingSpawnInterrupted(status: "closed" | "error"): string {
    if (!this.pendingCreate) throw new Error("No pending create request");
    const agentId = `agent-${this.pendingCreate.executionId}`;
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Pending agent was not materialized");
    agent["status"] = status;
    return agentId;
  }
  async emitEarlyActivity(): Promise<void> {
    if (!this.pendingCreate) throw new Error("No pending create request");
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.pendingCreate.executionId,
        agentId: `agent-${this.pendingCreate.executionId}`,
        event: {
          type: "timeline",
          provider: "opencode",
          item: {
            type: "assistant_message",
            text: JSON.stringify({
              actions: [{ type: "discord.reply", args: { content: "before-ack" } }],
            }),
          },
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  createdAgent(): Record<string, unknown> {
    return [...this.agents.values()].at(-1) ?? {};
  }
  createdAgentCount(): number {
    return this.agents.size;
  }
  createdAgentRequestCount(): number {
    return this.createRequests;
  }
  completionToken(id: string): string {
    const agent = [...this.agents.values()].find((value) => value["executionId"] === id);
    const mcpServers = agent?.["mcpServers"];
    const hub = isRecord(mcpServers) ? mcpServers["hub"] : undefined;
    const headers = isRecord(hub) ? hub["headers"] : undefined;
    const authorization = isRecord(headers) ? headers["Authorization"] : undefined;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new Error("Completion token unavailable");
    }
    return authorization.slice("Bearer ".length);
  }
  interrupt(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Unknown agent");
    agent["status"] = "closed";
  }
  changesStatus(agentId: string, status: HubExecutionAgentSnapshot["status"]): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Unknown agent");
    agent["status"] = status;
    this.send({
      type: "hub.execution.agent.update",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        agent: agentSnapshot(agentId, status),
      },
    });
  }
  hasCredential(): boolean {
    return this.credential.length > 0;
  }
  matchesStoredVerifier(verifier: string): boolean {
    return (
      verifier === createHash("sha256").update(this.credential).digest("base64url") &&
      verifier !== this.credential
    );
  }
  async starts(agentId: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: {
          type: "thread_started",
          sessionId: "session-1",
          provider: "opencode",
        },
      },
    });
  }
  async outputs(agentId: string, content: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: {
          type: "timeline",
          provider: "opencode",
          item: {
            type: "assistant_message",
            text: JSON.stringify({
              actions: [{ type: "discord.reply", args: { content } }],
            }),
          },
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  async startsTurn(agentId: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: { type: "turn_started", provider: "opencode" },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  async failsTurn(agentId: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: {
          type: "turn_failed",
          provider: "opencode",
          error: "turn failed",
        },
      },
    });
  }
  async completesTurn(agentId: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: {
          type: "timeline",
          provider: "opencode",
          item: {
            type: "tool_call",
            callId: `finish-${agentId}`,
            name: "hub.finish_execution",
            status: "completed",
          },
        },
      },
    });
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: { type: "turn_completed", provider: "opencode" },
      },
    });
    this.changesStatus(agentId, "idle");
  }
  async completesTurnWithoutFinishTimeline(agentId: string): Promise<void> {
    this.send({
      type: "hub.execution.agent.stream",
      payload: {
        executionId: this.executionId(agentId),
        agentId,
        event: { type: "turn_completed", provider: "opencode" },
      },
    });
    this.changesStatus(agentId, "idle");
  }
  async revoke(): Promise<number> {
    return (
      await fetch(`${this.origin}/api/daemons/${this.daemonId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${this.credential}` },
      })
    ).status;
  }
  async disconnect(): Promise<void> {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return;
    const closed = this.closed();
    this.socket.close();
    await closed;
  }
  closed(): Promise<void> {
    return new Promise((resolve) =>
      !this.socket || this.socket.readyState === WebSocket.CLOSED
        ? resolve()
        : this.socket.once("close", () => resolve()),
    );
  }
  closedCode(): Promise<number> {
    if (!this.socket) throw new Error("Daemon is offline");
    return new Promise((resolve) => this.socket?.once("close", (code) => resolve(code)));
  }
  private receive(data: RawData): void {
    const envelope = ExecutionSessionRequestSchema.safeParse(JSON.parse(readText(data)));
    if (!envelope.success) return;
    const request = envelope.data.message;
    if (request.type === "hub.execution.agent.validate.request") {
      this.send({
        type: "hub.execution.agent.validate.response",
        payload: { requestId: request.requestId, valid: true, issues: [], error: null },
      });
      return;
    }
    if (request.type === "hub.execution.control.request") {
      this.controls.push(request.action);
      this.controlActionsByExecution.set(request.executionId, request.action);
      const pending = this.pendingControlActions.get(request.executionId);
      this.pendingControlActions.delete(request.executionId);
      pending?.(request.action);
      if (this.holdControlAck) {
        this.heldControls.set(request.executionId, request);
      } else {
        this.acknowledgeControl(request);
      }
      return;
    }
    this.createRequests += 1;
    const pending = {
      requestId: request.requestId,
      executionId: request.executionId,
    };
    const agentId = `agent-${request.executionId}`;
    if (this.materializeSpawn && !this.agents.has(agentId)) {
      this.agents.set(agentId, {
        ...request,
        env: request.env,
        executionId: request.executionId,
        status: "running",
      });
    }
    this.resolveSpawn();
    if (this.holdAck) this.pendingCreate = pending;
    else this.acknowledge(pending);
  }
  private acknowledge(pending: { requestId: string; executionId: string }): void {
    const error = this.nextCreateError;
    this.nextCreateError = undefined;
    if (error !== undefined) {
      this.send({
        type: "hub.execution.agent.create.response",
        payload: {
          requestId: pending.requestId,
          executionId: pending.executionId,
          agentId: null,
          agent: null,
          success: false,
          error,
        },
      });
      this.pendingCreate = undefined;
      return;
    }
    const agentId = `agent-${pending.executionId}`;
    const status = readAgentStatus(this.agents.get(agentId)?.["status"]);
    this.send({
      type: "hub.execution.agent.create.response",
      payload: {
        requestId: pending.requestId,
        executionId: pending.executionId,
        agentId,
        agent: this.omitSnapshotOnReconnect ? null : agentSnapshot(agentId, status),
        success: true,
        toolPolicyApplied: true,
        error: null,
      },
    });
    this.pendingCreate = undefined;
  }
  private acknowledgeControl(request: {
    requestId: string;
    executionId: string;
    action: HubExecutionControlAction;
  }): void {
    this.send({
      type: "hub.execution.control.response",
      payload: {
        requestId: request.requestId,
        executionId: request.executionId,
        action: request.action,
        success: true,
        error: null,
      },
    });
  }
  private executionId(agentId: string): string {
    const value = this.agents.get(agentId)?.["executionId"];
    if (typeof value !== "string") throw new Error("Unknown agent");
    return value;
  }
  private send(value: unknown): void {
    this.socket?.send(JSON.stringify({ type: "session", message: value }));
  }
}

type HubCreateError =
  | {
      code: "provider_options_invalid";
      provider: string;
      issues: readonly { path: readonly (string | number)[]; message: string }[];
      message: string;
    }
  | { code: "tool_policy_unsupported"; provider: string; message: string }
  | { code: "create_failed"; message: string };

function agentSnapshot(
  agentId: string,
  status: HubExecutionAgentSnapshot["status"],
): HubExecutionAgentSnapshot {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: agentId,
    provider: "opencode",
    cwd: "/workspace",
    model: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUserMessageAt: null,
    status,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
}

function readAgentStatus(value: unknown): HubExecutionAgentSnapshot["status"] {
  if (
    value === "error" ||
    value === "initializing" ||
    value === "idle" ||
    value === "running" ||
    value === "closed"
  ) {
    return value;
  }
  return "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepEqual(left: unknown, right: unknown): boolean {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}
function readText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not reserve port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function machineHeaders(auth: "valid" | "missing" | "wrong"): Record<string, string> {
  if (auth === "valid") return { authorization: `Bearer ${HUB_API_KEY}` };
  if (auth === "wrong") return { authorization: "Bearer paseo_pk_wrong" };
  return {};
}

async function waitFor(observation: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await observation()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Hub state");
}
