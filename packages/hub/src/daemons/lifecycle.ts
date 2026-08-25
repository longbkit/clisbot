import {
  buildExecutionCapabilityMcpServer,
  deriveAgentExecutionCompletionToken,
  hashAgentExecutionCompletionToken,
  verifyAgentExecutionCompletionToken,
} from "../agent-executions/completion-token.js";
import { createHash, randomUUID } from "node:crypto";
import type {
  AgentExecutionRecord,
  AgentExecutionHubFinishExecutionStatus,
  Database,
  DaemonRecord,
  HubAction,
  TransitionAgentExecutionFields,
  TransitionAgentExecutionResult,
  AcceptedTriggerRunRecord,
  TriggerRunRecord,
  WorkflowDeadlineKind,
  WorkflowAgentCompletionInput,
} from "../db/types.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import { logger as defaultLogger } from "../logger.js";
import { reportFailure } from "../failures/index.js";
import type { TriggerProvider } from "../triggers/index.js";
import type { ExecutionAuthority } from "../execution-authority/index.js";
import { OutputExecutorRegistry } from "../execution-capabilities/outputs.js";
import { executionToolPolicy } from "../execution-capabilities/tool-policy.js";
import {
  notifyAgentExecutionCompleted,
  notifyAgentExecutionFailed,
  notifyAgentExecutionStarted,
  notifyAgentExecutionTerminal,
  notifyDispatchAccepted,
  notifyMachineTerminated,
} from "../triggers/lifecycle.js";
import type { TriggerProviderReactionState } from "../triggers/index.js";
import {
  DaemonCreateRejectedError,
  DaemonCreateResponseLostError,
  type DaemonAgentSnapshot,
  type DaemonAgentStreamEvent,
  type DaemonConnection,
  type DaemonCreateAgentOptions,
  type DaemonEvent,
} from "./protocol.js";
import type { JsonValue } from "../config/compiler.js";
import { compileJsonSchema, formatJsonSchemaErrors } from "../workflows/json-schema.js";
import type { Logger } from "pino";
import { isHubFinishExecutionToolName } from "../hub/protocol.js";

export interface DaemonDispatchResult {
  execution: AgentExecutionRecord;
  agentId: string;
}

interface PreparedDaemonDispatch {
  intent: LaunchMachineIntent;
  daemon: DaemonRecord;
  execution: AgentExecutionRecord;
  completionToken: string;
  deadlineAt: Date;
  publicBaseUrl: string;
}

interface HubExecutionEnv {
  executionId: string;
  completionToken: string;
  publicBaseUrl: string;
}

const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;
const DEFAULT_AGENT_EXECUTION_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 5 * 60_000;

type AgentStatus = NonNullable<DaemonAgentSnapshot["state"]>["status"];
interface ExecutionDeadline {
  kind: "hard" | "idle";
  at: Date;
}

export interface ExecutionDeadlineClock {
  now(): number;
  schedule(callback: () => Promise<void>, delayMs: number): () => void;
}

const systemExecutionDeadlineClock: ExecutionDeadlineClock = {
  now: Date.now,
  schedule(callback, delayMs) {
    const timer = setTimeout(() => {
      void callback();
    }, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export interface DaemonDispatchLifecycleOptions {
  database: Database;
  connectionForDaemon(daemonId: string): DaemonConnection | undefined;
  executionCapabilities?: OutputExecutorRegistry;
  providers?: readonly TriggerProvider[];
  executionAuthority?: ExecutionAuthority;
  publicBaseUrl?: string;
  completionTokenSecret?: string;
  test?: {
    logger?: Logger;
    dispatchTimeoutMs?: number;
    deadlineClock?: ExecutionDeadlineClock;
  };
}

export class DaemonDispatchFailure extends Error {
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`daemon dispatch failed: ${reason}`);
    this.name = "DaemonDispatchFailure";
    this.cause = options?.cause;
  }
}

export class DaemonSpawnAckTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("timed out waiting for daemon spawn ack");
    this.name = "DaemonSpawnAckTimeoutError";
  }
}

export class AgentExecutionCompletionFailure extends Error {
  constructor(readonly reason: "not_found" | "unauthorized" | "expired") {
    super(`agent execution completion failed: ${reason}`);
    this.name = "AgentExecutionCompletionFailure";
  }
}

export class AgentExecutionOutputValidationFailure extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`invalid structured output: ${errors.join("; ")}`);
    this.name = "AgentExecutionOutputValidationFailure";
  }
}

export class DaemonDispatchLifecycle {
  private readonly providersByName: Map<string, TriggerProvider>;
  private readonly executionCapabilities: OutputExecutorRegistry;
  private readonly startedExecutions = new Set<string>();
  private readonly pendingStreamHandlersByExecution = new Map<string, Promise<void>>();
  private readonly completionWatchersByExecution = new Map<
    string,
    (failure?: DaemonDispatchFailure) => void
  >();
  private readonly deadlineTimersByExecution = new Map<string, () => void>();
  private readonly activeExecutionDispatches = new Map<string, Promise<unknown>>();
  private readonly reconcilingHubActions = new Map<string, Promise<void>>();
  private readonly daemonRecoveries = new Set<Promise<void>>();
  private readonly recoveredSubscriptions = new Map<string, () => void>();
  private stopping = false;

  constructor(private readonly options: DaemonDispatchLifecycleOptions) {
    this.executionCapabilities = options.executionCapabilities ?? new OutputExecutorRegistry();
    this.providersByName = new Map(
      (options.providers ?? []).map((provider) => [provider.name, provider]),
    );
  }

  activeRecoveryObservationCount(): number {
    return this.recoveredSubscriptions.size;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const unsubscribe of this.recoveredSubscriptions.values()) unsubscribe();
    this.recoveredSubscriptions.clear();
    for (const clear of this.deadlineTimersByExecution.values()) clear();
    this.deadlineTimersByExecution.clear();
    this.startedExecutions.clear();
    await Promise.allSettled([
      ...this.daemonRecoveries,
      ...this.reconcilingHubActions.values(),
      ...this.pendingStreamHandlersByExecution.values(),
      ...this.activeExecutionDispatches.values(),
    ]);
  }

  async dispatchLaunchMachineIntent(intent: LaunchMachineIntent): Promise<DaemonDispatchResult> {
    const prepared = await this.prepareDispatch(intent);
    if (prepared === undefined) throw new Error("synchronous dispatch was not prepared");
    return this.spawnPreparedDispatch(prepared);
  }

  async handoffLaunchMachineIntent(
    intent: LaunchMachineIntent,
  ): Promise<{ execution: AgentExecutionRecord }> {
    const executionId = durableExecutionId(intent);
    let prepared: PreparedDaemonDispatch | undefined;
    try {
      prepared = await this.prepareDispatch(intent, executionId);
    } catch (error) {
      if (!isDurablePrelaunchFailure(error)) throw error;
      const failure = await this.claimFailedDurableDispatch(intent, executionId, error.reason);
      this.notifyPrelaunchFailure(failure, this.notifyDispatchAccepted(intent));
      return { execution: failure.execution };
    }
    if (prepared === undefined) {
      const execution = await this.options.database.findAgentExecutionById(executionId);
      if (execution === undefined) {
        throw new Error(`claimed durable execution not found: ${executionId}`);
      }
      const resumable = await this.prepareClaimedDurableDispatch(execution);
      if (resumable !== undefined) {
        this.startDurableDispatch(resumable, this.notifyDispatchAccepted(intent, true));
      }
      return { execution };
    }
    this.startDurableDispatch(prepared, this.notifyDispatchAccepted(intent, true));
    return { execution: prepared.execution };
  }

  async notifyWorkflowRunAccepted(
    run: AcceptedTriggerRunRecord,
  ): Promise<TriggerProviderReactionState> {
    const provider = this.findProviderForTriggerContext(run.triggerContext);
    if (provider === undefined) return run.reactionState;
    return notifyDispatchAccepted({
      provider,
      triggerContext: run.triggerContext,
      outputContext: run.outputContext,
      reactionState: run.reactionState,
    });
  }

  async notifyWorkflowRunStarted(
    run: AcceptedTriggerRunRecord,
  ): Promise<TriggerProviderReactionState> {
    const provider = this.findProviderForTriggerContext(run.triggerContext);
    if (provider === undefined) return run.reactionState;
    return notifyAgentExecutionStarted({
      provider,
      triggerContext: run.triggerContext,
      outputContext: run.outputContext,
      reactionState: run.reactionState,
    });
  }

  async notifyWorkflowRunTerminal(run: TriggerRunRecord): Promise<TriggerProviderReactionState> {
    if (run.outcome !== "accepted" || run.status === "running") return null;
    const provider = this.findProviderForTriggerContext(run.triggerContext);
    if (provider === undefined) return run.reactionState;
    if (run.status === "succeeded") {
      return notifyAgentExecutionCompleted({
        provider,
        triggerContext: run.triggerContext,
        outputContext: run.outputContext,
        result: { status: "succeeded" },
        reactionState: run.reactionState,
      });
    }
    return notifyAgentExecutionFailed({
      provider,
      triggerContext: run.triggerContext,
      outputContext: run.outputContext,
      reason:
        run.failureReason ??
        (run.status === "timed_out" ? "workflow_timed_out" : "workflow_failed"),
      reactionState: run.reactionState,
    });
  }

  private async claimFailedDurableDispatch(
    intent: LaunchMachineIntent,
    executionId: string,
    reason: string,
  ): Promise<TransitionAgentExecutionResult> {
    const inserted = await this.options.database.insertAgentExecutionIfAbsent({
      id: executionId,
      organizationId: intent.organizationId,
      projectId: intent.projectId,
      machineId: null,
      daemonId: null,
      triggerContext: intent.triggerContext,
      outputContext: intent.outputContext,
      configurationRevisionId: intent.configurationRevisionId,
      launchIntent: intent,
      workflowStepRunId: intent.workflowStepRunId ?? null,
    });
    if (inserted !== undefined) {
      return this.options.database.completeWorkflowAgentExecution({
        executionId,
        executionStatus: "failed",
        stepStatus: "failed",
        result: { status: "failed", reason },
        stepOutput: { status: "failed", reason },
        failureReason: reason,
        observedAt: new Date(this.now()),
        hubAction: null,
      });
    }

    const existing = await this.options.database.findAgentExecutionById(executionId);
    if (existing === undefined) {
      throw new Error(`claimed durable execution not found: ${executionId}`);
    }
    if (existing.status === "spawning") {
      if (existing.workflowStepRunId !== null) {
        return this.options.database.completeWorkflowAgentExecution({
          executionId,
          executionStatus: "failed",
          stepStatus: "failed",
          result: { status: "failed", reason },
          stepOutput: { status: "failed", reason },
          failureReason: reason,
          observedAt: new Date(this.now()),
          hubAction: null,
        });
      }
      return this.options.database.transitionAgentExecution(executionId, "failed", {
        result: { reason },
        hubAction: null,
      });
    }
    return { execution: existing, transitioned: false };
  }

  private notifyPrelaunchFailure(
    failure: TransitionAgentExecutionResult,
    after: Promise<void>,
  ): void {
    const { execution } = failure;
    if (this.activeExecutionDispatches.has(execution.id)) return;
    const tracked = after
      .then(async () => {
        await this.notifyExecutionLifecycle(execution, executionFailureReason(execution));
        return undefined;
      })
      .catch((error: unknown) => {
        this.report(error, "daemon.prelaunch.notification", { executionId: execution.id });
      })
      .finally(() => {
        if (this.activeExecutionDispatches.get(execution.id) === tracked) {
          this.activeExecutionDispatches.delete(execution.id);
        }
      });
    this.activeExecutionDispatches.set(execution.id, tracked);
  }

  private async prepareDispatch(
    intent: LaunchMachineIntent,
    durableId?: string,
  ): Promise<PreparedDaemonDispatch | undefined> {
    if (!this.options.completionTokenSecret) {
      throw new DaemonDispatchFailure("completion_auth_not_configured");
    }
    if (this.options.publicBaseUrl === undefined) {
      throw new DaemonDispatchFailure("completion_url_not_configured");
    }

    const daemon = await this.options.database.findDaemonForOrganization(
      intent.organizationId,
      intent.environment.daemonId,
    );

    if (daemon === undefined) {
      throw new DaemonDispatchFailure("daemon_not_registered", {
        cause: new Error(`Daemon not registered: ${intent.environment.authoredSlug}`),
      });
    }

    const [run, config, daemonMachine] = await Promise.all([
      this.options.database.findTriggerRunById(intent.triggerRunId),
      this.options.database.findProjectConfigurationRevision(
        intent.projectId,
        intent.configurationRevisionId,
      ),
      this.options.database.findMachineForOrganization(intent.organizationId, daemon.machineId),
    ]);
    if (
      run === undefined ||
      run.organizationId !== intent.organizationId ||
      run.projectId !== intent.projectId ||
      config?.projectId !== intent.projectId ||
      daemonMachine?.orgId !== intent.organizationId
    ) {
      throw new DaemonDispatchFailure("tenant_authority_mismatch");
    }

    const executionId = durableId ?? randomUUID();
    const completionToken = this.completionToken(executionId);
    const deadlineAt =
      intent.deadlineAt ??
      new Date(this.now() + (intent.timeoutMs ?? DEFAULT_AGENT_EXECUTION_TIMEOUT_MS));
    const executionInput = {
      id: executionId,
      organizationId: intent.organizationId,
      projectId: intent.projectId,
      machineId: daemon.machineId,
      daemonId: daemon.id,
      triggerContext: intent.triggerContext,
      outputContext: intent.outputContext,
      configurationRevisionId: intent.configurationRevisionId,
      completionTokenHash: hashAgentExecutionCompletionToken(completionToken),
      deadlineAt,
      workflowStepRunId: intent.workflowStepRunId ?? null,
      launchIntent: intent,
    };
    const execution =
      durableId === undefined
        ? await this.options.database.insertAgentExecution(executionInput)
        : await this.options.database.insertAgentExecutionIfAbsent(executionInput);
    if (execution === undefined) return undefined;
    if (execution.workflowStepRunId !== null) {
      await this.options.database.linkWorkflowStepRunExecution(
        execution.workflowStepRunId,
        execution.id,
        intent,
      );
    }

    return {
      intent,
      daemon,
      execution,
      completionToken,
      deadlineAt,
      publicBaseUrl: this.options.publicBaseUrl,
    };
  }

  private async prepareClaimedDurableDispatch(
    execution: AgentExecutionRecord,
  ): Promise<PreparedDaemonDispatch | undefined> {
    if (execution.status !== "spawning" || execution.daemonAgentId !== null) return undefined;
    const intent = execution.launchIntent;
    const daemonId = execution.daemonId ?? intent?.environment.daemonId;
    if (
      intent === null ||
      daemonId === undefined ||
      execution.deadlineAt === null ||
      this.options.publicBaseUrl === undefined
    ) {
      throw new Error(`durable execution cannot be resumed: ${execution.id}`);
    }
    const daemon = await this.options.database.findDaemonForOrganization(
      execution.organizationId,
      daemonId,
    );
    if (daemon === undefined) throw new Error(`daemon not found: ${daemonId}`);
    const completionToken = this.completionToken(execution.id);
    const preparedExecution = await this.options.database.prepareAgentExecutionForDispatch(
      execution.id,
      daemon.id,
      daemon.machineId,
      hashAgentExecutionCompletionToken(completionToken),
    );
    if (preparedExecution.deadlineAt === null) {
      throw new Error(`durable execution has no deadline: ${execution.id}`);
    }
    return {
      intent,
      daemon,
      execution: preparedExecution,
      completionToken,
      deadlineAt: preparedExecution.deadlineAt,
      publicBaseUrl: this.options.publicBaseUrl,
    };
  }

  private startDurableDispatch(
    prepared: PreparedDaemonDispatch,
    accepted: Promise<void> | undefined,
  ): void {
    if (this.activeExecutionDispatches.has(prepared.execution.id)) return;
    const tracked = Promise.resolve(accepted)
      .then(() => this.spawnPreparedDispatch(prepared, false))
      .catch((error: unknown) => {
        this.report(error, "daemon.dispatch.durable", { executionId: prepared.execution.id });
      })
      .finally(() => {
        if (this.activeExecutionDispatches.get(prepared.execution.id) === tracked) {
          this.activeExecutionDispatches.delete(prepared.execution.id);
        }
      });
    this.activeExecutionDispatches.set(prepared.execution.id, tracked);
  }

  private async spawnPreparedDispatch(
    prepared: PreparedDaemonDispatch,
    notifyAccepted = true,
  ): Promise<DaemonDispatchResult> {
    const { intent, daemon, execution, completionToken, deadlineAt, publicBaseUrl } = prepared;
    try {
      if (notifyAccepted) {
        await this.notifyDispatchAccepted(intent, false, execution.id);
      }

      const agentId = await this.acquireAndSpawnAgent(
        {
          daemonId: daemon.id,
          machineId: daemon.machineId,
          executionId: execution.id,
          ...optionalDeliveryId(intent.triggerContext),
          intent,
          hubExecutionEnv: {
            executionId: execution.id,
            completionToken,
            publicBaseUrl,
          },
        },
        deadlineAt,
      );

      return { execution, agentId };
    } catch (error) {
      if (error instanceof DaemonCreateResponseLostError) throw error;
      const failure = toDaemonDispatchFailure(error);
      this.logDispatchFailure(failure, {
        daemonId: intent.environment.daemonId,
        authoredSlug: intent.environment.authoredSlug,
        machineId: daemon.machineId,
        executionId: execution.id,
        ...optionalDeliveryId(intent.triggerContext),
      });
      await this.failAgentExecution(execution.id, failure.reason);
      throw failure;
    }
  }

  private async materializeLaunch(
    intent: LaunchMachineIntent,
    provider: TriggerProvider | undefined,
    executionId: string,
  ): Promise<{ intent: LaunchMachineIntent; env: Record<string, string> }> {
    const persistedWorktree = intent.environment.worktree;
    const materialized =
      provider?.materializeLaunch === undefined
        ? {}
        : await provider.materializeLaunch({
            executionId,
            organizationId: intent.organizationId,
            projectId: intent.projectId,
            ...(intent.environment.env === undefined
              ? {}
              : { environmentEnv: intent.environment.env }),
            ...(persistedWorktree === undefined ? {} : { environmentWorktree: persistedWorktree }),
            triggerContext: intent.triggerContext,
          });
    const {
      env: _persistedEnvironmentEnv,
      worktree: _persistedWorktree,
      ...environment
    } = intent.environment;
    const environmentWorktree = materialized.environmentWorktree ?? persistedWorktree;
    const materializedIntent: LaunchMachineIntent = {
      ...intent,
      environment: {
        ...environment,
        ...(materialized.environmentEnv === undefined ? {} : { env: materialized.environmentEnv }),
        ...(environmentWorktree === undefined ? {} : { worktree: environmentWorktree }),
      },
    };
    if (this.options.executionAuthority === undefined && materializedIntent.github !== undefined) {
      throw new Error("GitHub step authority is unavailable");
    }
    const authoredEnv = {
      ...(materialized.environmentEnv ?? intent.environment.env),
      ...materializedIntent.env,
    };
    let env: Record<string, string>;
    if (
      this.options.executionAuthority === undefined ||
      (Object.keys(authoredEnv).length === 0 && materializedIntent.github === undefined)
    ) {
      env = authoredEnv;
    } else {
      env = (
        await this.options.executionAuthority.materialize({
          executionId,
          projectId: materializedIntent.projectId,
          triggerContext: materializedIntent.triggerContext,
          ...(Object.keys(authoredEnv).length === 0 ? {} : { env: authoredEnv }),
          ...(materializedIntent.github === undefined ? {} : { github: materializedIntent.github }),
        })
      ).env;
    }
    return { intent: materializedIntent, env };
  }

  private async buildCreateAgentOptions(
    intent: LaunchMachineIntent,
    hubExecutionEnv: HubExecutionEnv,
  ): Promise<DaemonCreateAgentOptions> {
    const provider = this.findProviderForTriggerContext(intent.triggerContext);
    const materialized = await this.materializeLaunch(
      intent,
      provider,
      hubExecutionEnv.executionId,
    );
    return buildCreateAgentOptions(
      materialized.intent,
      hubExecutionEnv,
      this.executionCapabilities,
      materialized.env,
    );
  }

  private async createAgent(
    connection: DaemonConnection,
    intent: LaunchMachineIntent,
    hubExecutionEnv: HubExecutionEnv,
  ): Promise<Awaited<ReturnType<DaemonConnection["createAgent"]>>> {
    return connection.createAgent(await this.buildCreateAgentOptions(intent, hubExecutionEnv));
  }

  async handleAgentStreamEvent(
    executionId: string,
    event: DaemonAgentStreamEvent,
    observedAt: Date,
  ): Promise<void> {
    switch (event.type) {
      case "thread_started":
        if (await this.refreshAgentIdleDeadline(executionId, observedAt)) {
          await this.startAgentExecution(executionId);
        }
        return;
      case "timeline":
        await this.refreshAgentIdleDeadline(executionId, observedAt);
        return;
      case "turn_completed":
      case "turn_failed":
      case "turn_canceled":
        await this.refreshAgentIdleDeadline(executionId, observedAt);
        return;
      case "permission_requested":
      case "permission_resolved":
      case "turn_started":
      case "attention_required":
        await this.refreshAgentIdleDeadline(executionId, observedAt);
        return;
    }

    return assertNeverAgentStreamEvent(event);
  }

  private async handleDaemonEvent(
    executionId: string,
    daemonId: string,
    event: DaemonEvent,
  ): Promise<void> {
    if (event.type === "agent_stream") {
      const observedAt = new Date(event.timestamp);
      if (event.event.type === "timeline" && event.event.item.type === "tool_call") {
        const item = event.event.item;
        if (
          typeof item.name === "string" &&
          isHubFinishExecutionToolName(item.name) &&
          typeof item.callId === "string" &&
          isHubFinishExecutionStatus(item.status)
        ) {
          await this.options.database.recordAgentExecutionHubAcknowledgement(executionId, {
            kind: "finish_execution",
            callId: item.callId,
            status: item.status,
            observedAt,
          });
        }
      }
      await this.handleAgentStreamEvent(executionId, event.event, observedAt);
      if (event.event.type === "turn_completed") {
        await this.options.database.recordAgentExecutionHubAcknowledgement(executionId, {
          kind: "terminal",
          observedAt,
        });
        await this.acknowledgeAgentExecutionHubAction(executionId, event.agentId, observedAt);
      } else if (event.event.type === "timeline") {
        await this.acknowledgeAgentExecutionHubAction(executionId, event.agentId, observedAt);
      }
      return;
    }
    if (isInterruptedAgentState(event.agent)) {
      await this.options.database.attachAgentToExecution(executionId, daemonId, event.agentId);
    }
    const observedAt = new Date(event.timestamp);
    await this.handleAgentStatus(executionId, event.agent.status, "live", observedAt);
    if (event.agent.status === "idle") {
      await this.options.database.recordAgentExecutionHubAcknowledgement(executionId, {
        kind: "idle",
        observedAt,
      });
      await this.acknowledgeAgentExecutionHubAction(executionId, event.agentId, observedAt);
    }
  }

  private async acknowledgeAgentExecutionHubAction(
    executionId: string,
    agentId: string,
    observedAt: Date,
  ): Promise<void> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (
      execution === undefined ||
      (execution.daemonAgentId !== null && execution.daemonAgentId !== agentId)
    ) {
      return;
    }
    if (
      execution.status !== "succeeded" ||
      execution.hubAction !== "archive" ||
      execution.completedByAgentAt === null ||
      execution.hubActionCompletedAt !== null
    ) {
      return;
    }
    const ready = await this.options.database.markAgentExecutionHubActionReady(
      executionId,
      observedAt,
    );
    if (ready !== undefined) {
      await this.reconcileHubActionSafely(ready);
      this.releaseExecutionResources(executionId);
      this.completionWatchersByExecution.get(executionId)?.();
    }
  }

  private async handleAgentStatus(
    executionId: string,
    status: AgentStatus,
    source: "live" | "restore",
    observedAt: Date,
  ): Promise<void> {
    if (status === "error" || status === "closed") {
      const failed = await this.failAgentExecution(executionId, "agent_interrupted");
      if (failed !== undefined) {
        this.completionWatchersByExecution.get(executionId)?.(
          new DaemonDispatchFailure("agent_interrupted"),
        );
      }
      return;
    }

    let execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined || isTerminalExecutionStatus(execution.status)) return;
    const processedAt = new Date(this.now());
    if (
      await this.expireIfDaemonEventDeadlineElapsed(executionId, execution, observedAt, processedAt)
    )
      return;
    if ((status === "running" || status === "idle") && execution.status === "spawning") {
      await this.startAgentExecution(executionId);
      execution = await this.options.database.findAgentExecutionById(executionId);
      if (execution === undefined || isTerminalExecutionStatus(execution.status)) return;
    }

    const idleDeadlineAt = this.idleDeadlineForStatus(execution, status, source, observedAt);
    const updated = await this.options.database.setAgentExecutionIdleDeadline(
      executionId,
      idleDeadlineAt,
      observedAt,
      processedAt,
    );
    await this.armOrExpireExecution(executionId, updated, processedAt);
  }

  private async expireIfDaemonEventDeadlineElapsed(
    executionId: string,
    execution: AgentExecutionRecord,
    observedAt: Date,
    processedAt: Date,
  ): Promise<boolean> {
    if (
      (execution.deadlineAt !== null && execution.deadlineAt.getTime() <= processedAt.getTime()) ||
      (execution.idleDeadlineAt !== null &&
        execution.idleDeadlineAt.getTime() <= observedAt.getTime())
    ) {
      await this.expireExecutionAtCurrentDeadline(executionId, false);
      return true;
    }
    return false;
  }

  private idleDeadlineForStatus(
    execution: AgentExecutionRecord,
    status: AgentStatus,
    source: "live" | "restore",
    observedAt: Date,
  ): Date | null {
    if (status === "idle") {
      if (source === "restore" && execution.idleDeadlineAt !== null) {
        return execution.idleDeadlineAt;
      }
      return new Date(
        Math.min(
          observedAt.getTime() +
            (execution.launchIntent?.idleTimeoutMs ?? DEFAULT_AGENT_IDLE_TIMEOUT_MS),
          execution.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY,
        ),
      );
    }
    return null;
  }

  private async armOrExpireExecution(
    executionId: string,
    execution: AgentExecutionRecord,
    processedAt: Date,
  ): Promise<void> {
    const deadline = nextExecutionDeadline(execution);
    if (deadline !== undefined && deadline.at.getTime() <= processedAt.getTime()) {
      await this.expireExecutionAtCurrentDeadline(executionId, false);
      return;
    }
    this.armExecutionDeadline(execution);
  }

  private async refreshAgentIdleDeadline(executionId: string, observedAt: Date): Promise<boolean> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined || isTerminalExecutionStatus(execution.status)) {
      return false;
    }
    const processedAt = new Date(this.now());
    if (
      (execution.deadlineAt !== null && execution.deadlineAt.getTime() <= processedAt.getTime()) ||
      (execution.idleDeadlineAt !== null &&
        execution.idleDeadlineAt.getTime() <= observedAt.getTime())
    ) {
      await this.expireExecutionAtCurrentDeadline(executionId, false);
      return false;
    }
    if (execution.idleDeadlineAt === null) {
      return true;
    }
    const idleTimeoutMs = execution.launchIntent?.idleTimeoutMs ?? DEFAULT_AGENT_IDLE_TIMEOUT_MS;
    const idleDeadlineAt = new Date(
      Math.min(
        observedAt.getTime() + idleTimeoutMs,
        execution.deadlineAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ),
    );
    const updated = await this.options.database.setAgentExecutionIdleDeadline(
      executionId,
      idleDeadlineAt,
      observedAt,
      processedAt,
    );
    if (isTerminalExecutionStatus(updated.status)) return false;
    await this.armOrExpireExecution(executionId, updated, processedAt);
    return true;
  }

  async completeAgentExecutionFromCallback(
    input: {
      executionId: string;
      token: string;
      output?: unknown;
    },
    options: { deferHubAction?: boolean } = {},
  ): Promise<AgentExecutionRecord> {
    const existingExecution = await this.options.database.findAgentExecutionById(input.executionId);
    if (existingExecution === undefined) {
      throw new AgentExecutionCompletionFailure("not_found");
    }

    if (
      existingExecution.completionTokenHash === null ||
      !verifyAgentExecutionCompletionToken(input.token, existingExecution.completionTokenHash)
    ) {
      throw new AgentExecutionCompletionFailure("unauthorized");
    }

    if (isTerminalExecutionStatus(existingExecution.status)) {
      return existingExecution;
    }

    await this.waitForPendingStreamHandlers(input.executionId);
    const currentExecution = await this.options.database.findAgentExecutionById(input.executionId);
    if (currentExecution === undefined) {
      throw new AgentExecutionCompletionFailure("not_found");
    }
    if (isTerminalExecutionStatus(currentExecution.status)) {
      return currentExecution;
    }
    if (await this.expireExecutionIfDeadlineElapsed(currentExecution)) {
      throw new AgentExecutionCompletionFailure("expired");
    }

    if (currentExecution.launchIntent?.outputSchema !== undefined) {
      validateStructuredOutput(currentExecution.launchIntent.outputSchema, input.output);
    }
    this.clearExecutionDeadline(input.executionId);
    const execution = await this.completeAgentExecution(input.executionId, {
      completedByAgent: true,
      ...(options.deferHubAction === undefined ? {} : { deferHubAction: options.deferHubAction }),
      ...(input.output === undefined ? {} : { output: input.output }),
    });
    if (options.deferHubAction === true && execution.hubAction === "archive") {
      await this.reconcileHubActionSafely(execution);
    }
    if (!(options.deferHubAction === true && execution.hubAction === "archive")) {
      this.completionWatchersByExecution.get(input.executionId)?.();
    }
    if (execution.status !== "succeeded") {
      throw new AgentExecutionCompletionFailure("expired");
    }
    return execution;
  }

  async recoverAgentExecutionDeadlines(): Promise<void> {
    const executions = await this.options.database.findPendingAgentExecutions();
    for (const execution of executions) {
      try {
        if (await this.expireExecutionIfDeadlineElapsed(execution)) {
          continue;
        }
        this.armExecutionDeadline(execution);
      } catch (error: unknown) {
        this.report(error, "daemon.execution.deadline.recover", { executionId: execution.id });
      }
    }
  }

  async recoverPendingHubActions(daemonId?: string): Promise<void> {
    const executions = await this.options.database.findPendingHubActions(daemonId);
    for (const execution of executions) {
      if (
        execution.hubAction !== "archive" ||
        execution.completedByAgentAt === null ||
        execution.hubActionReadyAt !== null ||
        execution.daemonId === null
      ) {
        continue;
      }
      const connection = this.options.connectionForDaemon(execution.daemonId);
      if (connection !== undefined) {
        this.subscribeRecoveredExecution(execution.id, execution.daemonId, connection);
      }
    }
    await Promise.all(executions.map((execution) => this.reconcileHubActionSafely(execution)));
  }

  async recoverWorkflowDeadlineExecutions(executionIds: readonly string[]): Promise<void> {
    for (const executionId of executionIds) {
      this.clearExecutionDeadline(executionId);
      this.releaseExecutionResources(executionId);
      this.startedExecutions.delete(executionId);
      this.completionWatchersByExecution.get(executionId)?.(new DaemonDispatchFailure("timeout"));
    }
    await this.recoverPendingHubActions();
  }

  recoverDaemon(daemon: DaemonRecord): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const recovery = Promise.all([
      this.recoverPendingHubActions(daemon.id),
      this.recoverLiveExecutions(daemon),
    ]).then(() => undefined);
    this.daemonRecoveries.add(recovery);
    void recovery.then(
      () => this.daemonRecoveries.delete(recovery),
      () => this.daemonRecoveries.delete(recovery),
    );
    return recovery;
  }

  private async recoverLiveExecutions(daemon: DaemonRecord): Promise<void> {
    const executions = await this.options.database.findPendingAgentExecutions();
    await Promise.all(
      executions
        .filter(
          (execution) =>
            execution.daemonId === daemon.id ||
            (execution.daemonId === null && execution.machineId === daemon.machineId),
        )
        .map((execution) => this.recoverExecutionOnce(daemon, execution)),
    );
  }

  private recoverExecutionOnce(
    daemon: DaemonRecord,
    execution: AgentExecutionRecord,
  ): Promise<void> {
    const active = this.activeExecutionDispatches.get(execution.id);
    if (active) {
      return active.then(async () => {
        const current = await this.options.database.findAgentExecutionById(execution.id);
        if (current !== undefined && isResumableDurableExecution(current)) {
          return this.recoverExecutionOnce(daemon, current);
        }
        return undefined;
      });
    }
    const recovery = this.recoverExecution(daemon, execution)
      .catch((error: unknown) => {
        if (!this.stopping) {
          this.report(error, "daemon.execution.recover", {
            executionId: execution.id,
            daemonId: daemon.id,
          });
        }
      })
      .finally(() => {
        if (this.activeExecutionDispatches.get(execution.id) === recovery)
          this.activeExecutionDispatches.delete(execution.id);
      });
    this.activeExecutionDispatches.set(execution.id, recovery);
    return recovery;
  }

  private async recoverExecution(
    daemon: DaemonRecord,
    execution: AgentExecutionRecord,
  ): Promise<void> {
    const connection = this.options.connectionForDaemon(daemon.id);
    if (connection === undefined) return;

    const current = await this.options.database.findAgentExecutionById(execution.id);
    if (current === undefined || isTerminalExecutionStatus(current.status)) return;
    if (this.stopping) return;

    const intent = current.launchIntent;
    if (intent === null || this.options.publicBaseUrl === undefined)
      throw new Error("execution launch intent cannot be recovered");
    this.subscribeRecoveredExecution(current.id, daemon.id, connection);
    this.armExecutionDeadline(current);
    const agent = await this.createAgent(connection, intent, {
      executionId: current.id,
      completionToken: this.completionToken(current.id),
      publicBaseUrl: this.options.publicBaseUrl,
    });
    if (isInterruptedAgentState(agent.state)) {
      await this.failAgentExecution(current.id, "agent_interrupted");
      return;
    }
    await this.options.database.attachAgentToExecution(current.id, daemon.id, agent.id);
    await this.restoreAgentState(current.id, agent);
  }

  private subscribeRecoveredExecution(
    executionId: string,
    daemonId: string,
    connection: DaemonConnection,
  ): void {
    this.recoveredSubscriptions.get(executionId)?.();
    this.recoveredSubscriptions.set(
      executionId,
      connection.on(async (event) => {
        if (event.executionId !== executionId) return;
        await this.queueDaemonEvent(executionId, daemonId, event);
      }),
    );
  }

  private async restoreAgentState(executionId: string, agent: DaemonAgentSnapshot): Promise<void> {
    if (agent.state === undefined) {
      await this.startAgentExecution(executionId);
      return;
    }
    const observedAt = new Date(this.now());
    await this.handleAgentStatus(executionId, agent.state.status, "restore", observedAt);
  }

  async failPendingExecutionsForDisconnectedMachine(
    machineId: string,
    reason: string,
  ): Promise<void> {
    const executions = (await this.options.database.findPendingAgentExecutions()).filter(
      (execution) => execution.machineId === machineId,
    );

    const failedExecutions = await Promise.all(
      executions.map(async (execution) => {
        const failed = await this.failAgentExecution(execution.id, "daemon_disconnected", {
          notifyProvider: false,
        });
        return failed === undefined ? undefined : execution;
      }),
    );

    await this.options.database.transitionMachine(machineId, "terminated", {
      reason,
    });

    await Promise.all(
      failedExecutions.map((execution) =>
        execution === undefined
          ? Promise.resolve()
          : this.notifyMachineTerminatedForExecution(execution, reason).catch((error: unknown) => {
              this.report(error, "daemon.provider.machine-termination", {
                executionId: execution.id,
              });
            }),
      ),
    );
  }

  private async startAgentExecution(executionId: string): Promise<void> {
    const alreadyStarted = this.startedExecutions.has(executionId);
    this.startedExecutions.add(executionId);
    const transition = await this.options.database.transitionAgentExecution(executionId, "running");

    if (alreadyStarted || !transition.transitioned) {
      return;
    }

    const { execution } = transition;
    await this.notifyExecutionLifecycle(execution).catch((error: unknown) => {
      this.report(error, "daemon.provider.execution-start", { executionId });
    });
  }

  private async completeAgentExecution(
    executionId: string,
    options: { completedByAgent?: boolean; output?: unknown; deferHubAction?: boolean } = {},
  ): Promise<AgentExecutionRecord> {
    const existing = await this.options.database.findAgentExecutionById(executionId);
    if (existing === undefined) throw new Error(`agent execution not found: ${executionId}`);
    const structuredOutput =
      existing.launchIntent?.outputSchema === undefined || options.output === undefined
        ? undefined
        : jsonValue(options.output);
    const transition = await this.transitionTerminalAgentExecution(
      executionId,
      "succeeded",
      {
        result:
          structuredOutput === undefined
            ? { status: "succeeded" }
            : { status: "succeeded", output: options.output },
        completedByAgent: options.completedByAgent === true,
      },
      {
        stepStatus: "succeeded",
        stepOutput: structuredOutput,
      },
    );
    if (!transition.transitioned) {
      if (isTerminalExecutionStatus(transition.execution.status)) {
        this.releaseExecutionResources(executionId);
      }
      return transition.execution;
    }

    this.clearExecutionDeadline(executionId);

    const { execution } = transition;
    const deferArchiveAcknowledgement =
      options.deferHubAction === true && execution.hubAction === "archive";
    if (!deferArchiveAcknowledgement) this.releaseExecutionResources(executionId);
    this.startedExecutions.delete(executionId);
    await this.notifyExecutionTerminal(execution);
    if (options.deferHubAction !== true) await this.reconcileHubActionSafely(execution);
    if (execution.workflowStepRunId === null) {
      await this.notifyExecutionLifecycle(execution).catch((error: unknown) => {
        this.report(error, "daemon.provider.execution-complete", { executionId });
      });
    }
    return execution;
  }

  private async failAgentExecution(
    executionId: string,
    reason: string,
    details: {
      lastInvalidOutput?: unknown;
      notifyProvider?: boolean;
      deadlineCondition?: {
        kind: "hard" | "idle";
        deadlineAt: Date;
        observedAt: Date;
      };
      deadlineKind?: WorkflowDeadlineKind;
    } = {},
  ): Promise<AgentExecutionRecord | undefined> {
    const current = await this.options.database.findAgentExecutionById(executionId);
    if (current === undefined) throw new Error(`agent execution not found: ${executionId}`);
    const result = {
      status: "failed" as const,
      reason,
      ...(details.lastInvalidOutput === undefined
        ? {}
        : { lastInvalidOutput: details.lastInvalidOutput }),
    };
    const workflowDeadline =
      current.workflowStepRunId !== null && details.deadlineCondition !== undefined;
    const stepStatus =
      workflowDeadline ||
      (details.deadlineCondition?.kind === "hard" &&
        current.deadlineAt !== null &&
        current.deadlineAt.getTime() <= this.now())
        ? ("timed_out" as const)
        : ("failed" as const);
    const transition = await this.transitionTerminalAgentExecution(
      executionId,
      "failed",
      {
        result,
        ...(details.deadlineCondition === undefined
          ? {}
          : { deadlineCondition: details.deadlineCondition }),
      },
      {
        stepStatus,
        stepOutput: result,
        failureReason: reason,
        ...(details.deadlineKind === undefined ? {} : { deadlineKind: details.deadlineKind }),
      },
    );
    if (!transition.transitioned) {
      if (isTerminalExecutionStatus(transition.execution.status)) {
        this.releaseExecutionResources(executionId);
      }
      return undefined;
    }

    this.clearExecutionDeadline(executionId);
    this.releaseExecutionResources(executionId);

    const { execution } = transition;
    this.startedExecutions.delete(executionId);
    await this.notifyExecutionTerminal(execution);
    await this.reconcileHubActionSafely(execution);
    if (details.notifyProvider !== false && execution.workflowStepRunId === null) {
      await this.notifyExecutionLifecycle(execution, reason).catch((error: unknown) => {
        this.report(error, "daemon.provider.execution-fail", { executionId });
      });
    }

    return execution;
  }

  private async transitionTerminalAgentExecution(
    executionId: string,
    status: "succeeded" | "failed",
    fields: TransitionAgentExecutionFields,
    workflow: Pick<WorkflowAgentCompletionInput, "stepStatus" | "stepOutput" | "failureReason">,
  ): Promise<TransitionAgentExecutionResult> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined) throw new Error(`agent execution not found: ${executionId}`);
    if (execution.workflowStepRunId !== null) {
      return this.options.database.completeWorkflowAgentExecution({
        executionId,
        executionStatus: status,
        stepStatus: workflow.stepStatus,
        result: fields.result,
        stepOutput: workflow.stepOutput,
        ...(workflow.failureReason === undefined ? {} : { failureReason: workflow.failureReason }),
        ...(fields.completedByAgent === undefined
          ? {}
          : { completedByAgent: fields.completedByAgent }),
        ...(fields.deadlineCondition === undefined
          ? {}
          : { deadlineCondition: fields.deadlineCondition }),
        observedAt: new Date(this.now()),
        hubAction: deriveHubAction(execution, status),
      });
    }
    return this.options.database.transitionAgentExecution(executionId, status, {
      ...fields,
      hubAction: deriveHubAction(execution, status),
    });
  }

  private reconcileHubActionSafely(execution: AgentExecutionRecord): Promise<void> {
    return this.reconcileHubAction(execution).catch((error: unknown) => {
      this.report(error, "daemon.execution.hub-action", {
        executionId: execution.id,
        hubAction: execution.hubAction,
      });
    });
  }

  private reconcileHubAction(execution: AgentExecutionRecord): Promise<void> {
    return this.reconcileHubActionAfterDurableAcknowledgement(execution);
  }

  private async reconcileHubActionAfterDurableAcknowledgement(
    execution: AgentExecutionRecord,
  ): Promise<void> {
    if (
      this.stopping ||
      execution.hubAction === null ||
      execution.hubActionCompletedAt !== null ||
      execution.daemonId === null
    ) {
      return;
    }
    let current = execution;
    if (
      current.hubAction === "archive" &&
      current.completedByAgentAt !== null &&
      current.hubActionReadyAt === null
    ) {
      const ready = await this.options.database.markAgentExecutionHubActionReady(current.id);
      if (ready === undefined) return;
      current = ready;
    }
    const existing = this.reconcilingHubActions.get(current.id);
    if (existing !== undefined) return existing;
    const operation = this.sendPendingHubAction(current.id).finally(() => {
      if (this.reconcilingHubActions.get(current.id) === operation) {
        this.reconcilingHubActions.delete(current.id);
      }
    });
    this.reconcilingHubActions.set(current.id, operation);
    await operation;
  }

  private async sendPendingHubAction(executionId: string): Promise<void> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined || execution.hubActionCompletedAt !== null || this.stopping) return;
    const action = execution.hubAction;
    const daemonId = execution.daemonId;
    if (action === null || daemonId === null) return;
    const connection = this.options.connectionForDaemon(daemonId);
    if (connection === undefined) return;
    await withHubActionTimeout(
      connection.controlExecution({ executionId: execution.id, action }),
      this.dispatchTimeoutMs,
      (callback, delayMs) => this.scheduleDeadline(async () => callback(), delayMs),
    );
    await this.options.database.completeHubAction(execution.id, action);
  }

  private async notifyMachineTerminated(
    triggerContext: unknown,
    reason: string,
    reactionState?: TriggerProviderReactionState,
  ): Promise<TriggerProviderReactionState> {
    const provider = this.findProviderForTriggerContext(triggerContext);
    if (provider === undefined) {
      return reactionState ?? null;
    }

    return notifyMachineTerminated({
      provider,
      triggerContext,
      reason,
      ...(reactionState === undefined ? {} : { reactionState }),
    });
  }

  private async notifyDispatchAccepted(
    intent: LaunchMachineIntent,
    swallowErrors = false,
    executionId = durableExecutionId(intent),
  ): Promise<void> {
    if (intent.workflowStepRunId !== undefined && intent.workflowStepRunId !== null) return;
    const provider = this.findProviderForTriggerContext(intent.triggerContext);
    if (provider === undefined) return;
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined) return;
    try {
      const reactionState = await notifyDispatchAccepted({
        provider,
        triggerContext: intent.triggerContext,
        outputContext: intent.outputContext,
        reactionState: execution.reactionState,
      });
      await this.options.database.setAgentExecutionReactionState(execution.id, reactionState);
    } catch (error: unknown) {
      this.report(error, "daemon.provider.dispatch-accepted", { executionId });
      if (!swallowErrors) throw error;
    }
  }

  private async notifyExecutionLifecycle(
    execution: AgentExecutionRecord,
    failureReason?: string,
  ): Promise<void> {
    const provider = this.findProviderForTriggerContext(execution.triggerContext);
    if (provider === undefined) return;
    if (execution.workflowStepRunId !== null) {
      return;
    }
    const reactionState = await notifyIndividualExecution(provider, execution, failureReason);
    await this.options.database.setAgentExecutionReactionState(execution.id, reactionState);
  }

  private async notifyExecutionTerminal(execution: AgentExecutionRecord): Promise<void> {
    const provider = this.findProviderForTriggerContext(execution.triggerContext);
    if (provider !== undefined) {
      await notifyAgentExecutionTerminal({
        provider,
        executionId: execution.id,
        triggerContext: execution.triggerContext,
      }).catch((error: unknown) => {
        this.report(error, "daemon.provider.terminal-cleanup", { executionId: execution.id });
      });
    }
    await Promise.all(
      this.options.executionAuthority === undefined
        ? []
        : [
            this.options.executionAuthority
              .onExecutionTerminal(execution.id)
              .catch((error: unknown) => {
                this.report(error, "daemon.execution-authority.terminal-cleanup", {
                  executionId: execution.id,
                });
              }),
          ],
    );
  }

  private async notifyMachineTerminatedForExecution(
    execution: AgentExecutionRecord,
    reason: string,
  ): Promise<void> {
    if (execution.workflowStepRunId !== null && execution.workflowStepRunId !== undefined) {
      return;
    }
    const reactionState = await this.notifyMachineTerminated(
      execution.triggerContext,
      reason,
      execution.reactionState,
    );
    await this.options.database.setAgentExecutionReactionState(execution.id, reactionState);
  }

  private findProviderForTriggerContext(triggerContext: unknown): TriggerProvider | undefined {
    if (typeof triggerContext !== "object" || triggerContext === null) {
      return undefined;
    }

    const providerName = hasProviderName(triggerContext) ? triggerContext.provider : undefined;
    return typeof providerName === "string" ? this.providersByName.get(providerName) : undefined;
  }

  private logDispatchFailure(
    failure: DaemonDispatchFailure,
    fields: {
      daemonId: string;
      authoredSlug: string;
      machineId: string;
      executionId: string;
      deliveryId?: string;
    },
  ): void {
    if (failure.cause instanceof DaemonSpawnAckTimeoutError) {
      this.report(
        failure,
        "daemon.dispatch.spawn-ack",
        { ...fields, timeoutMs: failure.cause.timeoutMs },
        "timeout",
      );
      return;
    }

    this.report(failure, "daemon.dispatch", fields);
  }

  private report(
    error: unknown,
    operation: string,
    diagnostic?: Record<string, unknown>,
    kind?: "timeout",
  ): void {
    reportFailure(
      error,
      { operation, component: "daemons" },
      {
        logger: this.logger,
        ...(kind === undefined ? {} : { kind }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
      },
    );
  }

  private get logger(): Logger {
    return this.options.test?.logger ?? defaultLogger;
  }

  private get dispatchTimeoutMs(): number {
    return this.options.test?.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
  }

  private async acquireAndSpawnAgent(
    input: {
      daemonId: string;
      machineId: string;
      executionId: string;
      deliveryId?: string;
      intent: LaunchMachineIntent;
      hubExecutionEnv: HubExecutionEnv;
    },
    deadlineAt: Date,
  ): Promise<string> {
    let canceled = false;
    const cancelHandlers = new Set<() => Promise<void>>();
    const timeoutMs = Math.max(
      0,
      Math.min(this.dispatchTimeoutMs, deadlineAt.getTime() - this.now()),
    );
    try {
      return await withDispatchTimeout(
        this.acquireAndSpawnAgentWithoutTimeout(
          input,
          () => canceled,
          (handler) => {
            cancelHandlers.add(handler);
          },
        ),
        timeoutMs,
        () => {
          canceled = true;
          for (const handler of cancelHandlers) {
            void handler().catch((error: unknown) => {
              this.report(error, "daemon.dispatch.cancel", { executionId: input.executionId });
            });
          }
        },
        (callback, delayMs) => this.scheduleDeadline(async () => callback(), delayMs),
      );
    } catch (error) {
      if (deadlineAt.getTime() <= this.now()) {
        throw new DaemonDispatchFailure("timeout", { cause: error });
      }
      throw error;
    }
  }

  private async acquireAndSpawnAgentWithoutTimeout(
    input: {
      daemonId: string;
      machineId: string;
      executionId: string;
      deliveryId?: string;
      intent: LaunchMachineIntent;
      hubExecutionEnv: HubExecutionEnv;
    },
    isCanceled: () => boolean,
    onCancel: (handler: () => Promise<void>) => void,
  ): Promise<string> {
    const connection = this.options.connectionForDaemon(input.daemonId);
    if (connection === undefined) {
      throw new DaemonDispatchFailure("daemon_unreachable");
    }
    const pendingHandlers = new Set<Promise<void>>();
    let disposed = false;
    let settleTerminal: ((failure?: DaemonDispatchFailure) => void) | undefined;
    const terminal = new Promise<void>((resolve, reject) => {
      settleTerminal = (failure) => {
        if (failure === undefined) {
          resolve();
          return;
        }
        reject(failure);
      };
    });
    void terminal.catch(() => undefined);
    this.completionWatchersByExecution.set(input.executionId, (failure) => {
      settleTerminal?.(failure);
    });
    const cleanup = async (): Promise<void> => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeEvents();
      this.completionWatchersByExecution.delete(input.executionId);
      await Promise.all(Array.from(pendingHandlers));
    };

    const trackHandler = (operation: Promise<void>): Promise<void> => {
      const tracked = operation.catch((error: unknown) => {
        if (!disposed) {
          this.report(error, "daemon.launch.event", { executionId: input.executionId });
        }
      });
      pendingHandlers.add(tracked);
      void tracked.finally(() => {
        pendingHandlers.delete(tracked);
      });
      return tracked;
    };

    const unsubscribeEvents = connection.on((event: DaemonEvent) => {
      if (event.executionId !== input.executionId) {
        return undefined;
      }
      return trackHandler(this.queueDaemonEvent(input.executionId, input.daemonId, event));
    });
    onCancel(cleanup);

    try {
      if (!(await this.armLiveExecutionDeadline(input.executionId))) {
        throw new DaemonDispatchFailure("timeout");
      }

      if (isCanceled()) {
        throw new DaemonSpawnAckTimeoutError(this.dispatchTimeoutMs);
      }
      const agent = await Promise.race([
        this.createAgent(connection, input.intent, input.hubExecutionEnv),
        terminal.then<never>(() => new Promise<never>(() => undefined)),
      ]);
      if (isCanceled()) {
        throw new DaemonSpawnAckTimeoutError(this.dispatchTimeoutMs);
      }
      await this.options.database.attachAgentToExecution(
        input.executionId,
        input.daemonId,
        agent.id,
      );
      await this.startAgentExecution(input.executionId);
      void (async () => {
        try {
          await terminal;
        } catch (error: unknown) {
          const failure = toDaemonDispatchFailure(error);
          this.logDispatchFailure(failure, {
            daemonId: input.daemonId,
            authoredSlug: input.intent.environment.authoredSlug,
            machineId: input.machineId,
            executionId: input.executionId,
            ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }),
          });
          await this.failAgentExecution(input.executionId, failure.reason);
        } finally {
          await cleanup();
        }
      })().catch((error: unknown) => {
        this.report(error, "daemon.dispatch.watch", { executionId: input.executionId });
      });
      return agent.id;
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  private async waitForPendingStreamHandlers(executionId: string): Promise<void> {
    await this.pendingStreamHandlersByExecution.get(executionId)?.catch(() => undefined);
  }

  private queueDaemonEvent(
    executionId: string,
    daemonId: string,
    event: DaemonEvent,
  ): Promise<void> {
    const previous = this.pendingStreamHandlersByExecution.get(executionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => this.handleDaemonEvent(executionId, daemonId, event));
    this.pendingStreamHandlersByExecution.set(executionId, current);
    void current.finally(() => {
      if (this.pendingStreamHandlersByExecution.get(executionId) === current) {
        this.pendingStreamHandlersByExecution.delete(executionId);
      }
    });
    return current;
  }

  private armExecutionDeadline(execution: AgentExecutionRecord): void {
    this.clearExecutionDeadline(execution.id);
    const deadline = nextExecutionDeadline(execution);
    if (deadline === undefined || isTerminalExecutionStatus(execution.status)) return;

    const delayMs = Math.max(0, deadline.at.getTime() - this.now());
    const clear = this.scheduleDeadline(async () => {
      await this.expireExecutionAtCurrentDeadline(execution.id).catch((error: unknown) => {
        this.report(error, "daemon.execution.timeout", { executionId: execution.id });
        void this.retryExecutionDeadline(execution.id).catch((retryError: unknown) => {
          this.report(retryError, "daemon.execution.timeout.retry-schedule", {
            executionId: execution.id,
          });
        });
      });
    }, delayMs);
    this.deadlineTimersByExecution.set(execution.id, clear);
  }

  private async armLiveExecutionDeadline(executionId: string): Promise<boolean> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined) return true;
    if (isTerminalExecutionStatus(execution.status)) return false;

    const deadline = nextExecutionDeadline(execution);
    if (deadline !== undefined && deadline.at.getTime() <= this.now()) {
      return !(await this.expireExecutionAtCurrentDeadline(executionId));
    }

    this.armExecutionDeadline(execution);
    return true;
  }

  private clearExecutionDeadline(executionId: string): void {
    const clear = this.deadlineTimersByExecution.get(executionId);
    if (clear !== undefined) {
      clear();
      this.deadlineTimersByExecution.delete(executionId);
    }
  }

  private releaseExecutionResources(executionId: string): void {
    this.recoveredSubscriptions.get(executionId)?.();
    this.recoveredSubscriptions.delete(executionId);
  }

  private async expireExecutionAtCurrentDeadline(
    executionId: string,
    waitForPendingStreamHandlers = true,
  ): Promise<boolean> {
    if (waitForPendingStreamHandlers) {
      await this.waitForPendingStreamHandlers(executionId);
    }
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined || isTerminalExecutionStatus(execution.status)) return false;
    const deadline = nextExecutionDeadline(execution);
    if (deadline === undefined || deadline.at.getTime() > this.now()) {
      this.armExecutionDeadline(execution);
      return false;
    }

    const wholeRunExpired = await this.isWholeRunDeadlineExpired(execution);
    const failure = deadlineFailure(execution, deadline, wholeRunExpired);
    const failed = await this.failAgentExecution(executionId, failure.reason, {
      deadlineCondition: {
        kind: deadline.kind,
        deadlineAt: deadline.at,
        observedAt: new Date(this.now()),
      },
      ...(failure.deadlineKind === undefined ? {} : { deadlineKind: failure.deadlineKind }),
    });
    if (failed !== undefined) {
      this.completionWatchersByExecution.get(executionId)?.(
        new DaemonDispatchFailure(failure.reason),
      );
      return true;
    }

    const current = await this.options.database.findAgentExecutionById(executionId);
    if (current !== undefined && !isTerminalExecutionStatus(current.status)) {
      this.armExecutionDeadline(current);
    }
    return false;
  }

  private async isWholeRunDeadlineExpired(execution: AgentExecutionRecord): Promise<boolean> {
    if (execution.workflowStepRunId === null) return false;
    const step = await this.options.database.findWorkflowStepRunById(execution.workflowStepRunId);
    if (step === undefined) return false;
    const run = await this.options.database.findTriggerRunById(step.triggerRunId);
    return (
      run?.outcome === "accepted" &&
      run.status === "running" &&
      run.deadlineAt.getTime() <= this.now()
    );
  }

  private async retryExecutionDeadline(executionId: string): Promise<void> {
    const execution = await this.options.database.findAgentExecutionById(executionId);
    if (execution === undefined || isTerminalExecutionStatus(execution.status)) {
      return;
    }

    this.clearExecutionDeadline(executionId);
    const clear = this.scheduleDeadline(async () => {
      await this.expireExecutionAtCurrentDeadline(executionId).catch((error: unknown) => {
        this.report(error, "daemon.execution.timeout.retry", { executionId });
        void this.retryExecutionDeadline(executionId).catch((retryError: unknown) => {
          this.report(retryError, "daemon.execution.timeout.retry-schedule", { executionId });
        });
      });
    }, 1_000);
    this.deadlineTimersByExecution.set(executionId, clear);
  }

  private async expireExecutionIfDeadlineElapsed(
    execution: AgentExecutionRecord,
  ): Promise<boolean> {
    const deadline = nextExecutionDeadline(execution);
    if (deadline === undefined || deadline.at.getTime() > this.now()) {
      return false;
    }

    return this.expireExecutionAtCurrentDeadline(execution.id);
  }

  private now(): number {
    return this.deadlineClock.now();
  }

  private scheduleDeadline(callback: () => Promise<void>, delayMs: number): () => void {
    return this.deadlineClock.schedule(async () => {
      try {
        await callback();
      } catch (error) {
        this.report(error, "daemon.deadline.callback");
      }
    }, delayMs);
  }

  private get deadlineClock(): ExecutionDeadlineClock {
    return this.options.test?.deadlineClock ?? systemExecutionDeadlineClock;
  }

  private completionToken(executionId: string): string {
    if (!this.options.completionTokenSecret) {
      throw new DaemonDispatchFailure("completion_auth_not_configured");
    }
    return deriveAgentExecutionCompletionToken(this.options.completionTokenSecret, executionId);
  }
}

export function durableExecutionId(
  intent: Pick<
    LaunchMachineIntent,
    "triggerRunId" | "configurationRevisionId" | "triggerName" | "workflowStepRunId"
  >,
): string {
  const bytes = createHash("sha256")
    .update("paseo-durable-execution-v1\0")
    .update(intent.triggerRunId)
    .update("\0")
    .update(intent.configurationRevisionId)
    .update("\0")
    .update(intent.triggerName)
    .update("\0")
    .update(intent.workflowStepRunId ?? "")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function notifyIndividualExecution(
  provider: TriggerProvider,
  execution: AgentExecutionRecord,
  failureReason?: string,
): Promise<TriggerProviderReactionState> {
  if (execution.status === "failed") {
    return notifyAgentExecutionFailed({
      provider,
      triggerContext: execution.triggerContext,
      outputContext: execution.outputContext,
      reason: failureReason ?? executionFailureReason(execution) ?? "agent_execution_failed",
      reactionState: execution.reactionState,
    });
  } else if (execution.status === "succeeded") {
    return notifyAgentExecutionCompleted({
      provider,
      triggerContext: execution.triggerContext,
      outputContext: execution.outputContext,
      result: { status: "succeeded" },
      reactionState: execution.reactionState,
    });
  } else {
    return notifyAgentExecutionStarted({
      provider,
      triggerContext: execution.triggerContext,
      outputContext: execution.outputContext,
      reactionState: execution.reactionState,
    });
  }
}

function executionFailureReason(execution: AgentExecutionRecord | undefined): string | undefined {
  if (typeof execution?.result !== "object" || execution.result === null) return undefined;
  const reason = (execution.result as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

function validateStructuredOutput(schema: JsonValue, output: unknown): asserts output is JsonValue {
  const validator = compileJsonSchema(schema).validate;
  if (!isJsonValue(output))
    throw new AgentExecutionOutputValidationFailure(["output must be valid JSON"]);
  if (validator(output)) return;
  const errors = formatJsonSchemaErrors(validator.errors);
  throw new AgentExecutionOutputValidationFailure(
    errors.length === 0 ? ["output is invalid"] : errors,
  );
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  }
  throw new AgentExecutionOutputValidationFailure(["output must be valid JSON"]);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}

export function createDaemonDispatchLifecycle(
  options: DaemonDispatchLifecycleOptions,
): DaemonDispatchLifecycle {
  return new DaemonDispatchLifecycle(options);
}

function isTerminalExecutionStatus(status: AgentExecutionRecord["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

function isHubFinishExecutionStatus(
  value: unknown,
): value is AgentExecutionHubFinishExecutionStatus {
  return value === "running" || value === "completed" || value === "failed" || value === "canceled";
}

function isResumableDurableExecution(execution: AgentExecutionRecord): boolean {
  return execution.status === "spawning" && execution.daemonAgentId === null;
}

function deriveHubAction(
  execution: AgentExecutionRecord,
  status: "succeeded" | "failed",
): HubAction | null {
  if (execution.daemonId === null) return null;
  if (execution.launchIntent?.autoArchive === true) return "archive";
  return status === "failed" ? "interrupt" : null;
}

function isInterruptedAgentState(state: DaemonAgentSnapshot["state"]): boolean {
  return state?.status === "closed" || state?.status === "error";
}

function toDaemonDispatchFailure(error: unknown): DaemonDispatchFailure {
  if (error instanceof DaemonDispatchFailure) {
    return error;
  }

  if (error instanceof DaemonSpawnAckTimeoutError) {
    return new DaemonDispatchFailure("daemon_timeout", { cause: error });
  }

  if (error instanceof DaemonCreateRejectedError) {
    return new DaemonDispatchFailure(daemonCreateFailureReason(error), { cause: error });
  }

  return new DaemonDispatchFailure("daemon_unreachable", { cause: error });
}

function isDurablePrelaunchFailure(error: unknown): error is DaemonDispatchFailure {
  return error instanceof DaemonDispatchFailure && error.reason === "daemon_not_registered";
}

async function buildCreateAgentOptions(
  intent: LaunchMachineIntent,
  hubExecutionEnv: {
    executionId: string;
    completionToken: string;
    publicBaseUrl: string;
  },
  capabilities: OutputExecutorRegistry,
  materializedEnv: Readonly<Record<string, string>>,
): Promise<DaemonCreateAgentOptions> {
  return {
    executionId: hubExecutionEnv.executionId,
    provider: intent.agent.provider,
    ...(intent.agent.mode === undefined ? {} : { mode: intent.agent.mode }),
    ...(intent.agent.model === undefined ? {} : { model: intent.agent.model }),
    ...(intent.agent.thinkingOptionId === undefined
      ? {}
      : { thinkingOptionId: intent.agent.thinkingOptionId }),
    ...(intent.agent.options === undefined
      ? {}
      : { providerOptions: structuredClone(intent.agent.options) }),
    cwd: intent.environment.cwd,
    prompt: intent.prompt,
    env: buildAgentEnv(intent, materializedEnv),
    mcpServers: {
      hub: buildExecutionCapabilityMcpServer(hubExecutionEnv),
    },
    toolPolicy: executionToolPolicy({
      allowOutputs: intent.allowOutputs,
      outputContext: intent.outputContext,
      ...(intent.outputSchema === undefined ? {} : { outputSchema: intent.outputSchema }),
      capabilities,
    }),
    ...(intent.environment.worktree === undefined
      ? {}
      : {
          worktree: intent.environment.worktree,
        }),
  };
}

function buildAgentEnv(
  intent: LaunchMachineIntent,
  materializedEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    ...materializedEnv,
    PASEO_AGENT_PROVIDER: intent.agent.provider,
    ...(intent.agent.mode === undefined ? {} : { PASEO_AGENT_MODE: intent.agent.mode }),
    PASEO_HUB_CONFIG_JSON: JSON.stringify(intent.hubConfig),
  };
}

function daemonCreateFailureReason(error: DaemonCreateRejectedError): string {
  if (error.code === "provider_options_invalid" && error.issues !== undefined) {
    const provider = error.provider === undefined ? "provider" : `provider '${error.provider}'`;
    const issues = error.issues
      .map((issue) => `${yamlProviderOptionPath(issue.path)}: ${issue.message}`)
      .join("; ");
    return `${provider}: ${issues}`;
  }
  return error.code === undefined ? error.message : `${error.code}: ${error.message}`;
}

function yamlProviderOptionPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)
      ? `${formatted}.${segment}`
      : `${formatted}[${JSON.stringify(segment)}]`;
  }, "agent.options");
}

function optionalDeliveryId(triggerContext: unknown): { deliveryId?: string } {
  if (typeof triggerContext !== "object" || triggerContext === null) {
    return {};
  }

  if (!("deliveryId" in triggerContext)) {
    return {};
  }

  const { deliveryId } = triggerContext;
  return typeof deliveryId === "string" ? { deliveryId } : {};
}

function nextExecutionDeadline(execution: AgentExecutionRecord): ExecutionDeadline | undefined {
  if (execution.deadlineAt === null) {
    return execution.idleDeadlineAt === null
      ? undefined
      : { kind: "idle", at: execution.idleDeadlineAt };
  }
  if (
    execution.idleDeadlineAt === null ||
    execution.deadlineAt.getTime() <= execution.idleDeadlineAt.getTime()
  ) {
    return { kind: "hard", at: execution.deadlineAt };
  }
  return { kind: "idle", at: execution.idleDeadlineAt };
}

interface DeadlineFailure {
  reason: string;
  deadlineKind?: WorkflowDeadlineKind;
}

function deadlineFailure(
  execution: AgentExecutionRecord,
  deadline: ExecutionDeadline,
  wholeRunExpired: boolean,
): DeadlineFailure {
  if (wholeRunExpired) {
    return { reason: "whole_run_timeout", deadlineKind: "whole_run" };
  }
  if (execution.workflowStepRunId === null) {
    return { reason: deadline.kind === "idle" ? "idle_timeout" : "timeout" };
  }
  if (deadline.kind === "idle") {
    return { reason: "step_idle_timeout", deadlineKind: "step_idle" };
  }
  return { reason: "step_hard_timeout", deadlineKind: "step_hard" };
}

function hasProviderName(value: object): value is { provider?: unknown } {
  return "provider" in value;
}

function assertNeverAgentStreamEvent(value: never): never {
  throw new Error(`unhandled daemon agent stream event: ${JSON.stringify(value)}`);
}

async function withDispatchTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  schedule: (callback: () => void, delayMs: number) => () => void,
): Promise<T> {
  let clearTimer: (() => void) | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        clearTimer = schedule(() => {
          onTimeout();
          reject(new DaemonSpawnAckTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimer?.();
  }
}

async function withHubActionTimeout(
  operation: Promise<void>,
  timeoutMs: number,
  schedule: (callback: () => void, delayMs: number) => () => void,
): Promise<void> {
  let clearTimer: (() => void) | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<void>((_resolve, reject) => {
        clearTimer = schedule(
          () => reject(new Error("timed out waiting for daemon execution control ack")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimer?.();
  }
}
