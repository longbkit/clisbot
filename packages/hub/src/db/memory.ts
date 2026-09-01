import { randomUUID } from "node:crypto";
import type { AgentExecutionStatus, MachineStatus } from "./schema.js";
import { parseCompiledHubConfig, type JsonValue } from "../config/compiler.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import { linearConnectionRequiresReauthorization } from "../providers/linear/client.js";
import type {
  AgentExecutionRecord,
  AgentExecutionOutputAttempt,
  AgentExecutionHubAcknowledgementInput,
  AgentExecutionHubAcknowledgements,
  Database,
  InsertAgentExecutionInput,
  InsertMachineInput,
  MachineRecord,
  TerminateMachineFields,
  TransitionAgentExecutionFields,
  TransitionAgentExecutionResult,
  ProviderEventReceiptRecord,
  EnrollDaemonInput,
  EnrollmentTokenRecord,
  DaemonRecord,
  CliAuthorizationRecord,
  CliAuthorizationDecisionInput,
  CliAuthorizationPollResult,
  StartCliAuthorizationInput,
  AdvanceGitHubConnectionAttemptInput,
  BindDiscordConnectionInput,
  BindGitHubConnectionInput,
  BindLinearConnectionInput,
  BindSlackConnectionInput,
  CompleteLinearProviderApplicationInput,
  CompleteSlackProviderApplicationInput,
  ConnectionStartAuthority,
  ConnectionProvider,
  ReadConnectionAttemptInput,
  StartConnectionAttemptInput,
  SwitchProjectConfigurationToManualInput,
  SetProjectGitHubConfigurationSourceInput,
  RecordConfigurationSyncAttemptInput,
  ConfigurationSyncAttemptRecord,
  AcceptDiscordEventInput,
  AcceptGitHubEventInput,
  AcceptLinearEventInput,
  AcceptSlackEventInput,
  DurableProviderEvent,
  GitHubLifecycleReceiptClaim,
  GitHubLifecycleReceiptClaimInput,
  AttachmentProvider,
  AttachmentRecord,
  GitHubLifecycleResult,
  PersistManualEventInput,
  ProviderEventAcceptance,
  CreateProjectInput,
  InsertProjectConfigurationRevisionInput,
  InsertAttachmentInput,
  ProjectConfigurationRevisionRecord,
  ProjectRecord,
  TenantRouteAccess,
  GitHubConnectionRecord,
  GitHubConfigurationTarget,
  DiscordConnectionRecord,
  SlackConnectionRecord,
  LinearConnectionRecord,
  GitHubRepositoryRecord,
  OrganizationConnectionUsage,
  ProjectTriggerRoute,
  MigrateProjectTriggersInput,
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
  PendingProjectTriggerMigration,
  SaveOrganizationTriggerInput,
  OrganizationTriggerRoute,
  CreateAcceptedTriggerRunInput,
  CreateRejectedTriggerRunInput,
  AcceptedTriggerRunRecord,
  RejectedTriggerRunRecord,
  TriggerRunRecord,
  WorkflowStepExecutionInput,
  WorkflowStepRunRecord,
  WorkflowWakeupRecord,
  WorkflowAgentCompletionInput,
  WorkflowDeadlineKind,
  WorkflowDeadlineRecovery,
  ProjectActivityRunListRecord,
  OrganizationEntitlementsRecord,
  OperatorOrganizationRecord,
  StampOrganizationEntitlementsInput,
  OverrideOrganizationEntitlementsInput,
  ClearOrganizationEntitlementsOverrideInput,
  EntitlementChangeRecord,
  OrganizationUsageRecord,
  ConsumeOrganizationUsageInput,
  BillingPlanRecord,
  SyncBillingPlanInput,
  OrganizationBillingCustomerRecord,
  ReconcileOrganizationBillingInput,
  UpdateLinearConnectionTokensInput,
  LinearConnectionRefreshOperation,
} from "./types.js";
import {
  clearOverrideKey,
  entitlementOverridesSchema,
  mergeOverrides,
} from "../entitlements/catalog.js";
import { toProviderEventReceiptRecordSummary } from "./mappers.js";
import {
  isProviderEventDropReasonCode,
  type ProviderEventDropReasonCode,
} from "../triggers/drop-reason.js";

const OUTPUT_ATTEMPT_LEASE_MS = 5 * 60_000;

export interface MemoryDatabaseOptions {
  onInsertAgentExecution?: (execution: AgentExecutionRecord) => void;
  organizationIds?: readonly string[];
  memberships?: readonly {
    userId: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    membershipId: string;
    role: "owner" | "admin" | "member";
  }[];
  now?: () => Date;
  slackConnections?: readonly SlackConnectionRecord[];
}

function usageKey(organizationId: string, meter: string, periodStart: Date): string {
  return `${organizationId}:${meter}:${periodStart.toISOString()}`;
}

/** Audit before/after snapshot carrying plan provenance, mirroring the Postgres store. */
function entitlementSnapshot(record: OrganizationEntitlementsRecord): unknown {
  return {
    granted: record.granted,
    overrides: record.overrides,
    planId: record.planId,
    planVersion: record.planVersion,
  };
}

function transitionWithTerminalRun(
  transition: TransitionAgentExecutionResult,
  run: TriggerRunRecord | undefined,
): TransitionAgentExecutionResult {
  return !transition.transitioned || run === undefined || run.status === "running"
    ? transition
    : { ...transition, terminalRun: run };
}

export function createMemoryDatabase(options: MemoryDatabaseOptions = {}): Database {
  return new MemoryDatabase(options);
}

class MemoryDatabase implements Database {
  private readonly providerEventReceipts = new Map<string, ProviderEventReceiptRecord>();
  private readonly providerEventReceiptIdsByDelivery = new Map<string, string>();
  private readonly providerEventReceiptIdsBySignature = new Map<string, string>();
  private readonly machines = new Map<string, MachineRecord>();
  private readonly agentExecutions = new Map<string, AgentExecutionRecord>();
  private readonly triggerRuns = new Map<string, TriggerRunRecord>();
  private readonly triggerRunIdsByProviderEventReceipt = new Map<
    string,
    Map<string, Map<string, string>>
  >();
  private readonly workflowStepRuns = new Map<string, WorkflowStepRunRecord>();
  private readonly workflowWakeups = new Map<string, WorkflowWakeupRecord>();
  private readonly attachments = new Map<string, AttachmentRecord>();
  private readonly attachmentIdsBySource = new Map<string, string>();
  private readonly enrollmentTokens = new Map<string, EnrollmentTokenRecord>();
  private readonly cliAuthorizations = new Map<string, MemoryCliAuthorization>();
  private readonly daemons = new Map<string, DaemonRecord>();
  private readonly organizationEntitlements = new Map<string, OrganizationEntitlementsRecord>();
  private readonly entitlementChanges: EntitlementChangeRecord[] = [];
  private readonly organizationUsage = new Map<string, OrganizationUsageRecord>();
  private readonly billingPlans = new Map<string, BillingPlanRecord>();
  private readonly organizationBillingCustomers = new Map<
    string,
    OrganizationBillingCustomerRecord
  >();
  private readonly advisoryLocks = new Map<string, Promise<void>>();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly configurationRevisions = new Map<string, ProjectConfigurationRevisionRecord>();
  private readonly configurationAuthorities = new Map<string, "manual" | "github">();
  private readonly githubConfigurationSources = new Map<
    string,
    {
      githubConnectionId: string;
      githubRepositoryId: number;
      githubRepositoryFullName: string;
      githubDefaultBranch: string;
      automaticDeploymentEnabled: boolean;
    }
  >();
  private readonly configurationSyncAttempts = new Map<string, ConfigurationSyncAttemptRecord[]>();
  private readonly projectTriggerRoutes = new Map<string, ProjectTriggerRoute[]>();
  private readonly organizationTriggers = new Map<string, OrganizationTriggerRecord>();
  private readonly organizationTriggerRevisions = new Map<
    string,
    OrganizationTriggerRevisionRecord
  >();
  private readonly migratedProjects = new Set<string>();
  private readonly organizationTriggerRoutes = new Map<string, OrganizationTriggerRoute[]>();
  private readonly githubRepositories = new Map<string, GitHubRepositoryRecord>();
  private readonly githubConnections = new Map<number, GitHubConnectionRecord>();
  private readonly discordConnections = new Map<string, DiscordConnectionRecord>();
  private readonly slackConnections = new Map<string, SlackConnectionRecord>();
  private readonly linearConnections = new Map<string, LinearConnectionRecord>();
  private readonly organizationIds: Set<string>;

  constructor(private readonly options: MemoryDatabaseOptions = {}) {
    this.organizationIds = new Set(options.organizationIds);
    for (const connection of options.slackConnections ?? []) {
      this.slackConnections.set(connection.teamId, connection);
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private pendingTerminalNotification(
    run: AcceptedTriggerRunRecord,
    terminalAt: Date,
  ): AcceptedTriggerRunRecord {
    return {
      ...run,
      terminalNotificationPendingAt: run.terminalNotificationPendingAt ?? terminalAt,
      terminalNotificationLeaseExpiresAt: null,
    };
  }

  async createAcceptedTriggerRun(
    input: CreateAcceptedTriggerRunInput,
  ): Promise<{ run: AcceptedTriggerRunRecord; created: boolean }> {
    const projectRuns =
      this.triggerRunIdsByProviderEventReceipt.get(input.providerEventReceiptId) ??
      new Map<string, Map<string, string>>();
    const triggerRuns = projectRuns.get(input.projectId) ?? new Map<string, string>();
    const existingId = triggerRuns.get(input.configuredTriggerName);
    if (existingId !== undefined) {
      const existing = this.triggerRuns.get(existingId);
      if (existing === undefined)
        throw new Error(`trigger run index points at missing row: ${existingId}`);
      if (existing.outcome !== "accepted") throw new Error("trigger branch outcome conflict");
      return { run: existing, created: false };
    }
    const now = input.createdAt ?? this.options.now?.() ?? new Date();
    const run: AcceptedTriggerRunRecord = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      configurationRevisionId: input.configurationRevisionId,
      providerEventReceiptId: input.providerEventReceiptId,
      configuredTriggerName: input.configuredTriggerName,
      outcome: "accepted",
      status: "running",
      prompt: input.prompt,
      inputs: freezeEvidence(input.inputs),
      values: freezeEvidence(input.values ?? {}),
      triggerContext: freezeEvidence(input.triggerContext),
      outputContext: freezeEvidence(input.outputContext),
      deadlineAt: input.deadlineAt,
      deadlineKind: null,
      failureReason: null,
      reactionState: null,
      terminalNotificationPendingAt: null,
      terminalNotificationDeliveredAt: null,
      terminalNotificationLeaseExpiresAt: null,
      createdAt: now,
      completedAt: null,
    };
    this.triggerRuns.set(run.id, run);
    triggerRuns.set(input.configuredTriggerName, run.id);
    projectRuns.set(input.projectId, triggerRuns);
    this.triggerRunIdsByProviderEventReceipt.set(input.providerEventReceiptId, projectRuns);
    for (const [ordinal, stepId] of input.stepIds.entries()) {
      const step: WorkflowStepRunRecord = {
        id: randomUUID(),
        triggerRunId: run.id,
        stepId,
        ordinal,
        status: "pending",
        agentExecutionId: null,
        output: null,
        failureReason: null,
        deadlineKind: null,
        deadlineAt: null,
        idleDeadlineAt: null,
        startedAt: null,
        completedAt: null,
        dispatchIntent: null,
      };
      this.workflowStepRuns.set(step.id, step);
    }
    this.workflowWakeups.set(run.id, {
      triggerRunId: run.id,
      availableAt: now,
      leaseExpiresAt: null,
      leasedBeforeClaim: false,
    });
    return { run, created: true };
  }

  async createRejectedTriggerRun(
    input: CreateRejectedTriggerRunInput,
  ): Promise<{ run: RejectedTriggerRunRecord; created: boolean }> {
    const projectRuns =
      this.triggerRunIdsByProviderEventReceipt.get(input.providerEventReceiptId) ??
      new Map<string, Map<string, string>>();
    const triggerRuns = projectRuns.get(input.projectId) ?? new Map<string, string>();
    const existingId = triggerRuns.get(input.configuredTriggerName);
    if (existingId !== undefined) {
      const existing = this.triggerRuns.get(existingId);
      if (existing === undefined)
        throw new Error(`trigger run index points at missing row: ${existingId}`);
      if (existing.outcome !== "rejected") throw new Error("trigger branch outcome conflict");
      return { run: existing, created: false };
    }
    const now = input.createdAt ?? this.options.now?.() ?? new Date();
    const run: RejectedTriggerRunRecord = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      configurationRevisionId: input.configurationRevisionId,
      providerEventReceiptId: input.providerEventReceiptId,
      configuredTriggerName: input.configuredTriggerName,
      outcome: "rejected",
      status: "rejected",
      prompt: input.prompt,
      inputs: freezeEvidence(input.inputs),
      values: freezeEvidence(input.values ?? {}),
      triggerContext: freezeEvidence(input.triggerContext),
      outputContext: freezeEvidence(input.outputContext),
      rejection: freezeEvidence(input.rejection),
      createdAt: now,
      completedAt: now,
    };
    this.triggerRuns.set(run.id, run);
    triggerRuns.set(input.configuredTriggerName, run.id);
    projectRuns.set(input.projectId, triggerRuns);
    this.triggerRunIdsByProviderEventReceipt.set(input.providerEventReceiptId, projectRuns);
    return { run, created: true };
  }

  async findTriggerRunById(id: string) {
    return this.triggerRuns.get(id);
  }

  async findTriggerRunsByProviderEventReceiptId(providerEventReceiptId: string) {
    const projectRuns = this.triggerRunIdsByProviderEventReceipt.get(providerEventReceiptId);
    const ids =
      projectRuns === undefined
        ? []
        : Array.from(projectRuns.values()).flatMap((triggerRuns) =>
            Array.from(triggerRuns.values()),
          );
    return ids
      .map((id) => this.triggerRuns.get(id))
      .filter((run): run is TriggerRunRecord => run !== undefined)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.configuredTriggerName.localeCompare(right.configuredTriggerName),
      );
  }

  async listTriggerRunsForProject(projectId: string, limit: number) {
    return [...this.triggerRuns.values()]
      .filter((run) => run.projectId === projectId)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          left.configuredTriggerName.localeCompare(right.configuredTriggerName),
      )
      .slice(0, limit);
  }

  async findWorkflowStepRunById(id: string) {
    return this.workflowStepRuns.get(id);
  }

  async findWorkflowStepRunByTriggerRun(triggerRunId: string) {
    return (await this.listWorkflowStepRunsForTriggerRun(triggerRunId))[0];
  }

  async listWorkflowStepRunsForTriggerRun(triggerRunId: string) {
    return Array.from(this.workflowStepRuns.values())
      .filter((step) => step.triggerRunId === triggerRunId)
      .sort((left, right) => left.ordinal - right.ordinal);
  }

  async findAgentExecutionByWorkflowStepRunId(stepRunId: string) {
    return Array.from(this.agentExecutions.values()).find(
      (execution) => execution.workflowStepRunId === stepRunId,
    );
  }

  async claimWorkflowWakeup(now: Date, leaseMs: number) {
    const candidate = Array.from(this.workflowWakeups.values())
      .filter(
        (wakeup) =>
          wakeup.availableAt <= now &&
          (wakeup.leaseExpiresAt === null || wakeup.leaseExpiresAt <= now),
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];
    if (candidate === undefined) return undefined;
    const claimed = {
      ...candidate,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      leasedBeforeClaim: candidate.leaseExpiresAt !== null,
    };
    this.workflowWakeups.set(candidate.triggerRunId, claimed);
    return claimed;
  }

  async wakeWorkflowRun(triggerRunId: string, availableAt: Date) {
    const current = this.workflowWakeups.get(triggerRunId);
    this.workflowWakeups.set(triggerRunId, {
      triggerRunId,
      availableAt:
        current === undefined || current.availableAt > availableAt
          ? availableAt
          : current.availableAt,
      leaseExpiresAt: null,
      leasedBeforeClaim: false,
    });
  }

  async deleteWorkflowWakeup(triggerRunId: string) {
    this.workflowWakeups.delete(triggerRunId);
  }

  async createWorkflowStepExecution(input: WorkflowStepExecutionInput) {
    let step = (await this.listWorkflowStepRunsForTriggerRun(input.triggerRunId)).find(
      (candidate) => candidate.stepId === input.stepId && candidate.ordinal === input.ordinal,
    );
    if (step === undefined) {
      throw new Error("workflow step run not found");
    }
    if (step.agentExecutionId !== null) {
      return {
        stepRun: step,
        execution: await this.findAgentExecutionById(step.agentExecutionId),
        created: false,
      };
    }
    const run = this.triggerRuns.get(input.triggerRunId);
    const startedAt = input.execution.startedAt;
    if (run === undefined || run.outcome !== "accepted" || run.status !== "running") {
      return { stepRun: step, execution: undefined, created: false };
    }
    if (run.deadlineAt <= startedAt) {
      this.timeoutWorkflowRun(run.id, startedAt);
      return {
        stepRun: this.workflowStepRuns.get(step.id) ?? step,
        execution: undefined,
        created: false,
      };
    }
    // Reserve one meter unit before creating the execution, so a denied reservation creates
    // nothing — the in-memory single-threaded model gives the same atomicity the Postgres
    // transaction does. A replay hits the `agentExecutionId !== null` branch above and never
    // reaches here, so it cannot double-consume.
    if (input.reservation !== undefined) {
      const reserved = await this.consumeOrganizationUsage({
        organizationId: input.execution.organizationId,
        meter: input.reservation.meter,
        periodStart: input.reservation.periodStart,
        amount: 1,
        limit: input.reservation.limit,
      });
      if (reserved === undefined) {
        if (input.reservation.limit === null) {
          throw new Error("unreachable: an unlimited meter reservation cannot be denied");
        }
        const usage = await this.getOrganizationUsage(
          input.execution.organizationId,
          input.reservation.meter,
          input.reservation.periodStart,
        );
        return {
          stepRun: step,
          execution: undefined,
          created: false,
          reservationDenied: {
            meter: input.reservation.meter,
            limit: input.reservation.limit,
            current: usage?.used ?? 0,
          },
        };
      }
    }
    const deadlineAt = new Date(
      Math.min(input.execution.deadlineAt.getTime(), run.deadlineAt.getTime()),
    );
    const idleDeadlineAt = new Date(
      Math.min(input.execution.idleDeadlineAt.getTime(), deadlineAt.getTime()),
    );
    const execution = await this.insertAgentExecution({
      ...input.execution,
      id: input.executionId,
      startedAt,
      deadlineAt,
      idleDeadlineAt,
      workflowStepRunId: step.id,
    });
    step = {
      ...step,
      status: "running",
      agentExecutionId: execution.id,
      deadlineAt: execution.deadlineAt,
      idleDeadlineAt: execution.idleDeadlineAt,
      dispatchIntent: input.execution.launchIntent ?? step.dispatchIntent,
      startedAt: execution.startedAt,
    };
    this.workflowStepRuns.set(step.id, step);
    return { stepRun: step, execution, created: true };
  }

  async linkWorkflowStepRunExecution(
    stepRunId: string,
    executionId: string,
    dispatchIntent?: LaunchMachineIntent,
  ) {
    const step = this.workflowStepRuns.get(stepRunId);
    if (step === undefined) throw new Error(`workflow step run not found: ${stepRunId}`);
    if (step.agentExecutionId !== null && step.agentExecutionId !== executionId) {
      throw new Error(`workflow step run already linked: ${stepRunId}`);
    }
    if (step.agentExecutionId === executionId) return step;
    const execution = await this.findAgentExecutionById(executionId);
    if (execution === undefined) throw new Error(`agent execution not found: ${executionId}`);
    const updated = {
      ...step,
      status:
        step.status === "succeeded" || step.status === "failed" || step.status === "timed_out"
          ? step.status
          : ("running" as const),
      agentExecutionId: executionId,
      startedAt: step.startedAt ?? execution.startedAt,
      ...(dispatchIntent === undefined ? {} : { dispatchIntent }),
    };
    this.workflowStepRuns.set(stepRunId, updated);
    return updated;
  }

  async completeWorkflowStep(
    executionId: string,
    status: "succeeded" | "failed" | "timed_out",
    result: unknown,
    failureReason?: string,
  ) {
    const execution = await this.findAgentExecutionById(executionId);
    if (execution === undefined || execution.workflowStepRunId === null) return undefined;
    await this.completeWorkflowAgentExecution({
      executionId,
      executionStatus: execution.status === "succeeded" ? "succeeded" : "failed",
      stepStatus: status,
      result,
      stepOutput: result,
      ...(failureReason === undefined ? {} : { failureReason }),
    });
    const step = this.workflowStepRuns.get(execution.workflowStepRunId);
    return step === undefined
      ? undefined
      : { stepRun: step, run: this.triggerRuns.get(step.triggerRunId)! };
  }

  async completeWorkflowAgentExecution(input: WorkflowAgentCompletionInput) {
    const execution = this.readAgentExecution(input.executionId);
    if (execution.workflowStepRunId === null) {
      return this.transitionAgentExecution(execution.id, input.executionStatus, {
        result: input.result,
        ...(input.completedByAgent === undefined
          ? {}
          : { completedByAgent: input.completedByAgent }),
        ...(input.deadlineCondition === undefined
          ? {}
          : { deadlineCondition: input.deadlineCondition }),
        ...(input.hubAction === undefined ? {} : { hubAction: input.hubAction }),
      });
    }
    const step = this.workflowStepRuns.get(execution.workflowStepRunId);
    if (step === undefined)
      throw new Error(`workflow step run not found: ${execution.workflowStepRunId}`);
    const run = this.triggerRuns.get(step.triggerRunId);
    if (run === undefined) throw new Error(`workflow trigger run not found: ${step.triggerRunId}`);
    if (run.outcome !== "accepted") throw new Error("rejected trigger run has no workflow step");

    const observedAt = input.observedAt ?? this.now();
    if (execution.status === "spawning" || execution.status === "running") {
      const deadlineKind = workflowDeadlineKind(execution, step, run, observedAt);
      if (deadlineKind === "whole_run") {
        this.timeoutWorkflowRun(run.id, observedAt);
        const terminalRun = this.triggerRuns.get(run.id);
        return transitionWithTerminalRun(
          {
            execution: this.readAgentExecution(execution.id),
            transitioned: true,
            deadlineKind,
          },
          terminalRun,
        );
      }
      if (deadlineKind !== undefined) {
        const timedOut = this.timeoutWorkflowStep(execution.id, deadlineKind, observedAt);
        const terminalRun = this.triggerRuns.get(run.id);
        return transitionWithTerminalRun(timedOut, terminalRun);
      }
    }

    const transitioned =
      execution.status === "spawning" || execution.status === "running"
        ? await this.transitionAgentExecution(execution.id, input.executionStatus, {
            result: input.result,
            ...(input.completedByAgent === undefined
              ? {}
              : { completedByAgent: input.completedByAgent }),
            ...(input.deadlineCondition === undefined
              ? {}
              : { deadlineCondition: input.deadlineCondition }),
            ...(input.hubAction === undefined ? {} : { hubAction: input.hubAction }),
          })
        : { execution, transitioned: false };
    if (transitioned.transitioned || isTerminalAgentExecutionStatus(execution.status)) {
      this.finishWorkflowStep(step, run, input);
    }
    const terminalRun = this.triggerRuns.get(run.id);
    return transitionWithTerminalRun(transitioned, terminalRun);
  }

  private finishWorkflowStep(
    step: WorkflowStepRunRecord,
    run: TriggerRunRecord,
    input: WorkflowAgentCompletionInput,
  ): void {
    if (step.status === "succeeded" || step.status === "failed" || step.status === "timed_out") {
      return;
    }
    if (run.outcome !== "accepted") throw new Error("rejected trigger run has no workflow step");
    const now = this.options.now?.() ?? new Date();
    const updatedStep: WorkflowStepRunRecord = {
      ...step,
      status: input.stepStatus,
      output: freezeEvidence(input.stepOutput !== undefined ? input.stepOutput : input.result),
      failureReason: input.failureReason ?? null,
      deadlineKind: input.deadlineKind ?? step.deadlineKind,
      completedAt: now,
    };
    this.workflowStepRuns.set(step.id, updatedStep);
    if (input.stepStatus === "succeeded") {
      if (run.status === "running") {
        this.workflowWakeups.set(run.id, {
          triggerRunId: run.id,
          availableAt: now,
          leaseExpiresAt: null,
          leasedBeforeClaim: false,
        });
      }
      return;
    }
    if (run.status === "running") {
      let runStatus: TriggerRunRecord["status"] = input.stepStatus;
      if (input.deadlineKind === "whole_run") {
        runStatus = "timed_out";
      } else if (input.deadlineKind !== undefined) {
        runStatus = "failed";
      }
      this.triggerRuns.set(run.id, {
        ...this.pendingTerminalNotification(run, now),
        status: runStatus,
        deadlineKind: input.deadlineKind ?? run.deadlineKind,
        failureReason: input.failureReason ?? null,
        completedAt: now,
      });
    }
    this.workflowWakeups.delete(run.id);
  }

  private timeoutWorkflowStep(
    executionId: string,
    deadlineKind: Exclude<WorkflowDeadlineKind, "whole_run">,
    now: Date,
  ): TransitionAgentExecutionResult {
    const execution = this.readAgentExecution(executionId);
    if (isTerminalAgentExecutionStatus(execution.status)) {
      return { execution, transitioned: false };
    }
    const failureReason = deadlineKind === "step_idle" ? "step_idle_timeout" : "step_hard_timeout";
    let hubAction: "interrupt" | "archive" | null = null;
    if (execution.daemonId !== null) {
      hubAction = execution.launchIntent?.autoArchive === true ? "archive" : "interrupt";
    }
    const updatedExecution: AgentExecutionRecord = {
      ...execution,
      status: "failed",
      completedAt: now,
      result: { status: "failed", reason: failureReason },
      idleDeadlineAt: null,
      hubAction,
      hubActionCompletedAt: hubAction === null ? null : null,
      hubActionReadyAt: null,
      hubActionAcknowledgements: emptyHubActionAcknowledgements(),
    };
    this.agentExecutions.set(execution.id, updatedExecution);
    const step =
      execution.workflowStepRunId === null
        ? undefined
        : this.workflowStepRuns.get(execution.workflowStepRunId);
    if (
      step === undefined ||
      step.status === "succeeded" ||
      step.status === "failed" ||
      step.status === "timed_out"
    ) {
      return { execution: updatedExecution, transitioned: true, deadlineKind };
    }
    const run = this.triggerRuns.get(step.triggerRunId);
    if (run === undefined || run.outcome !== "accepted") {
      return { execution: updatedExecution, transitioned: true, deadlineKind };
    }
    this.workflowStepRuns.set(step.id, {
      ...step,
      status: "timed_out",
      failureReason,
      deadlineKind,
      completedAt: now,
    });
    if (run.status === "running") {
      this.triggerRuns.set(run.id, {
        ...this.pendingTerminalNotification(run, now),
        status: "failed",
        deadlineKind,
        failureReason,
        completedAt: now,
      });
    }
    this.workflowWakeups.delete(run.id);
    return { execution: updatedExecution, transitioned: true, deadlineKind };
  }

  private timeoutWorkflowRun(
    triggerRunId: string,
    now: Date,
  ): WorkflowDeadlineRecovery | undefined {
    const run = this.triggerRuns.get(triggerRunId);
    if (run === undefined || run.outcome !== "accepted" || run.status !== "running") {
      return undefined;
    }
    const executionIds: string[] = [];
    for (const step of this.workflowStepRuns.values()) {
      if (step.triggerRunId !== triggerRunId) continue;
      if (step.agentExecutionId !== null) {
        const execution = this.agentExecutions.get(step.agentExecutionId);
        if (
          execution !== undefined &&
          (execution.status === "spawning" || execution.status === "running")
        ) {
          let hubAction: AgentExecutionRecord["hubAction"] = null;
          if (execution.daemonId !== null) {
            hubAction = execution.launchIntent?.autoArchive === true ? "archive" : "interrupt";
          }
          const updatedExecution: AgentExecutionRecord = {
            ...execution,
            status: "failed",
            completedAt: now,
            result: { status: "failed", reason: "whole_run_timeout" },
            idleDeadlineAt: null,
            hubAction,
            hubActionCompletedAt: null,
            hubActionReadyAt: null,
            hubActionAcknowledgements: emptyHubActionAcknowledgements(),
          };
          this.agentExecutions.set(execution.id, updatedExecution);
          executionIds.push(execution.id);
        }
      }
      if (step.status === "pending" || step.status === "running") {
        this.workflowStepRuns.set(step.id, {
          ...step,
          status: "timed_out",
          failureReason: "whole_run_timeout",
          deadlineKind: "whole_run",
          completedAt: now,
        });
      }
    }
    const updatedRun: AcceptedTriggerRunRecord = {
      ...this.pendingTerminalNotification(run, now),
      status: "timed_out",
      deadlineKind: "whole_run",
      failureReason: "whole_run_timeout",
      completedAt: now,
    };
    this.triggerRuns.set(run.id, updatedRun);
    this.workflowWakeups.delete(run.id);
    return { triggerRunId: run.id, executionIds };
  }

  async recoverWorkflowDeadlines(now: Date): Promise<readonly WorkflowDeadlineRecovery[]> {
    const recoveries: WorkflowDeadlineRecovery[] = [];
    for (const run of this.triggerRuns.values()) {
      if (run.outcome !== "accepted" || run.status !== "running") continue;
      if (run.deadlineAt <= now) {
        const recovery = this.timeoutWorkflowRun(run.id, now);
        if (recovery !== undefined) recoveries.push(recovery);
        continue;
      }
      const steps = await this.listWorkflowStepRunsForTriggerRun(run.id);
      for (const step of steps) {
        if (step.status !== "running") continue;
        const execution =
          step.agentExecutionId === null
            ? undefined
            : this.agentExecutions.get(step.agentExecutionId);
        if (execution !== undefined && isTerminalAgentExecutionStatus(execution.status)) continue;
        const deadlineKind = workflowDeadlineKind(execution, step, run, now);
        if (deadlineKind === undefined || deadlineKind === "whole_run") continue;
        if (execution !== undefined) {
          const recovery = this.timeoutWorkflowStep(execution.id, deadlineKind, now);
          recoveries.push({ triggerRunId: run.id, executionIds: [recovery.execution.id] });
        } else {
          this.workflowStepRuns.set(step.id, {
            ...step,
            status: "timed_out",
            failureReason: deadlineKind === "step_idle" ? "step_idle_timeout" : "step_hard_timeout",
            deadlineKind,
            completedAt: now,
          });
          this.triggerRuns.set(run.id, {
            ...this.pendingTerminalNotification(run, now),
            status: "failed",
            deadlineKind,
            failureReason: deadlineKind === "step_idle" ? "step_idle_timeout" : "step_hard_timeout",
            completedAt: now,
          });
          this.workflowWakeups.delete(run.id);
          recoveries.push({ triggerRunId: run.id, executionIds: [] });
        }
      }
    }
    return recoveries;
  }

  async markWorkflowStepSkipped(triggerRunId: string, stepId: string, reason: string) {
    const run = this.triggerRuns.get(triggerRunId);
    const step = (await this.listWorkflowStepRunsForTriggerRun(triggerRunId)).find(
      (candidate) => candidate.stepId === stepId,
    );
    if (run === undefined || step === undefined || run.outcome !== "accepted") return undefined;
    if (step.status !== "pending") return { stepRun: step, run };
    const now = this.options.now?.() ?? new Date();
    const updatedStep = {
      ...step,
      status: "skipped" as const,
      failureReason: reason,
      completedAt: now,
    };
    this.workflowStepRuns.set(step.id, updatedStep);
    this.workflowWakeups.set(run.id, {
      triggerRunId: run.id,
      availableAt: now,
      leaseExpiresAt: null,
      leasedBeforeClaim: false,
    });
    return { stepRun: updatedStep, run };
  }

  async succeedTriggerRun(triggerRunId: string) {
    const run = this.triggerRuns.get(triggerRunId);
    if (run === undefined || run.outcome !== "accepted") return undefined;
    if (run.status !== "running") return { run, transitioned: false };
    const now = this.options.now?.() ?? new Date();
    const updated = {
      ...this.pendingTerminalNotification(run, now),
      status: "succeeded" as const,
      completedAt: now,
    };
    this.triggerRuns.set(run.id, updated);
    this.workflowWakeups.delete(run.id);
    return { run: updated, transitioned: true };
  }

  async failWorkflowRun(
    triggerRunId: string,
    status: "failed" | "timed_out",
    failureReason: string,
    stepId?: string,
  ) {
    const run = this.triggerRuns.get(triggerRunId);
    const steps = await this.listWorkflowStepRunsForTriggerRun(triggerRunId);
    const step =
      (stepId === undefined
        ? steps.find(
            (candidate) => candidate.status === "pending" || candidate.status === "running",
          )
        : steps.find((candidate) => candidate.stepId === stepId)) ?? steps[0];
    if (run === undefined || step === undefined) return undefined;
    if (run.status !== "running") return { stepRun: step, run, transitioned: false };
    const now = this.options.now?.() ?? new Date();
    const updatedStep =
      step.status === "pending" || step.status === "running"
        ? { ...step, status, failureReason, completedAt: now }
        : step;
    if (run.outcome !== "accepted") throw new Error("rejected trigger run has no workflow step");
    const updatedRun: AcceptedTriggerRunRecord = {
      ...this.pendingTerminalNotification(run, now),
      status,
      failureReason,
      completedAt: now,
    };
    this.workflowStepRuns.set(step.id, updatedStep);
    this.triggerRuns.set(run.id, updatedRun);
    this.workflowWakeups.delete(run.id);
    return { stepRun: updatedStep, run: updatedRun, transitioned: true };
  }

  async recoverWorkflowWakeups(now: Date) {
    for (const run of this.triggerRuns.values()) {
      if (run.status !== "running" || run.deadlineAt <= now) continue;
      const wakeup = this.workflowWakeups.get(run.id);
      const steps = await this.listWorkflowStepRunsForTriggerRun(run.id);
      const execution = (
        await Promise.all(
          steps.map(async (step) =>
            step.agentExecutionId === null
              ? undefined
              : this.findAgentExecutionById(step.agentExecutionId),
          ),
        )
      ).find(
        (candidate) =>
          candidate !== undefined &&
          (candidate.status === "spawning" || candidate.status === "running"),
      );
      if (wakeup === undefined && execution === undefined) {
        this.workflowWakeups.set(run.id, {
          triggerRunId: run.id,
          availableAt: now,
          leaseExpiresAt: null,
          leasedBeforeClaim: false,
        });
      }
    }
  }

  async claimPendingWorkflowRunTerminalNotification(now: Date, leaseMs: number) {
    const candidate = Array.from(this.triggerRuns.values())
      .filter(
        (run): run is AcceptedTriggerRunRecord =>
          run.outcome === "accepted" &&
          run.status !== "running" &&
          run.terminalNotificationPendingAt !== null &&
          run.terminalNotificationDeliveredAt === null &&
          (run.terminalNotificationLeaseExpiresAt === null ||
            run.terminalNotificationLeaseExpiresAt <= now),
      )
      .sort((left, right) => {
        const time =
          left.terminalNotificationPendingAt!.getTime() -
          right.terminalNotificationPendingAt!.getTime();
        return time === 0 ? left.id.localeCompare(right.id) : time;
      })[0];
    if (candidate === undefined) return undefined;
    const updated = {
      ...candidate,
      terminalNotificationLeaseExpiresAt: new Date(now.getTime() + leaseMs),
    };
    this.triggerRuns.set(updated.id, updated);
    return updated;
  }

  async markWorkflowRunTerminalNotificationDelivered(
    triggerRunId: string,
    deliveredAt: Date,
    reactionState: JsonValue | null,
  ) {
    const run = this.triggerRuns.get(triggerRunId);
    if (
      run === undefined ||
      run.outcome !== "accepted" ||
      run.terminalNotificationPendingAt === null ||
      run.terminalNotificationDeliveredAt !== null
    ) {
      return;
    }
    this.triggerRuns.set(run.id, {
      ...run,
      reactionState,
      terminalNotificationDeliveredAt: deliveredAt,
      terminalNotificationLeaseExpiresAt: null,
    });
  }

  async setWorkflowRunReactionState(triggerRunId: string, reactionState: JsonValue | null) {
    const run = this.triggerRuns.get(triggerRunId);
    if (run === undefined || run.outcome !== "accepted") return undefined;
    const updated = { ...run, reactionState };
    this.triggerRuns.set(run.id, updated);
    return updated;
  }

  async markProviderEventDropped(
    providerEventReceiptId: string,
    reason: ProviderEventDropReasonCode,
  ): Promise<void> {
    const receipt = this.providerEventReceipts.get(providerEventReceiptId);
    if (receipt === undefined)
      throw new Error(`provider event receipt not found: ${providerEventReceiptId}`);
    this.providerEventReceipts.set(providerEventReceiptId, {
      ...receipt,
      droppedReason: receipt.droppedReason ?? reason,
    });
  }

  async acceptGitHubEvent(input: AcceptGitHubEventInput): Promise<ProviderEventAcceptance> {
    const binding = await this.findGitHubConnection(input.installationId);
    const reason = githubDropReason(input, binding);
    return this.acceptMemoryEvent(
      input,
      binding?.organizationId,
      binding?.id,
      input.repositoryId === undefined ? null : String(input.repositoryId),
      reason,
    );
  }

  async acceptDiscordEvent(input: AcceptDiscordEventInput): Promise<ProviderEventAcceptance> {
    const binding = await this.findDiscordConnection(input.guildId);
    const reason = discordDropReason(input, binding);
    return this.acceptMemoryEvent(
      input,
      binding?.organizationId,
      binding?.id,
      input.guildId,
      reason,
    );
  }

  async acceptSlackEvent(input: AcceptSlackEventInput): Promise<ProviderEventAcceptance> {
    const binding = await this.findSlackConnection(input.teamId);
    const reason = slackDropReason(input, binding);
    return this.acceptMemoryEvent(
      input,
      binding?.organizationId,
      binding?.id,
      input.teamId,
      reason,
    );
  }

  async acceptLinearEvent(input: AcceptLinearEventInput): Promise<ProviderEventAcceptance> {
    const binding = await this.findLinearConnection(input.linearOrganizationId);
    const reason = linearDropReason(input, binding);
    return this.acceptMemoryEvent(
      input,
      binding?.organizationId,
      binding?.id,
      input.projectId ?? null,
      reason,
    );
  }

  async persistManualEvent(input: PersistManualEventInput) {
    const existing = this.findReceiptId(
      input.organizationId,
      input.deliveryId,
      input.signatureHash,
    );
    if (existing !== undefined) {
      const receipt = this.providerEventReceipts.get(existing);
      const route = receipt?.acceptedRoutes?.[0];
      if (receipt === undefined || route === undefined) {
        return { status: "duplicate" as const, providerEventReceiptId: existing };
      }
      return {
        status: "accepted" as const,
        event: {
          providerEventReceiptId: receipt.id,
          organizationId: receipt.organizationId,
          projectId: route.projectId,
          configurationRevisionId: route.configurationRevisionId,
          deliveryId: receipt.deliveryId,
          source: receipt.source,
          payload: receipt.payload,
          receivedAt: receipt.receivedAt,
          connectionId: route.connectionId,
          resourceId: route.resourceId,
        },
      };
    }
    const project = this.projects.get(input.projectId);
    if (
      project?.organizationId !== input.organizationId ||
      project.activeConfigurationRevisionId === null
    ) {
      throw new Error("manual project configuration unavailable");
    }
    const receipt = this.insertProviderEventReceipt({
      organizationId: input.organizationId,
      provider: "manual",
      connectionId: input.connectionId ?? null,
      resourceId: input.resourceId ?? null,
      input,
    });
    const route = {
      projectId: input.projectId,
      configurationRevisionId: project.activeConfigurationRevisionId,
      connectionId: input.connectionId ?? null,
      resourceId: input.resourceId ?? null,
    };
    this.providerEventReceipts.set(receipt.id, { ...receipt, acceptedRoutes: [route] });
    return {
      status: "accepted" as const,
      event: {
        providerEventReceiptId: receipt.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        configurationRevisionId: route.configurationRevisionId,
        deliveryId: input.deliveryId,
        source: input.source,
        payload: input.payload,
        receivedAt: input.receivedAt,
        connectionId: input.connectionId ?? null,
        resourceId: input.resourceId ?? null,
      },
    };
  }

  async claimGitHubLifecycleReceipt(
    input: GitHubLifecycleReceiptClaimInput,
  ): Promise<GitHubLifecycleReceiptClaim> {
    const connection = await this.findGitHubConnection(input.installationId);
    if (connection === undefined) {
      return { status: "duplicate", providerEventReceiptId: input.deliveryId };
    }
    const existing = this.findReceiptId(
      connection.organizationId,
      input.deliveryId,
      input.signatureHash,
    );
    if (existing !== undefined) {
      return { status: "duplicate", providerEventReceiptId: existing };
    }
    const receipt = this.insertProviderEventReceipt({
      organizationId: connection.organizationId,
      provider: "github",
      connectionId: connection.id,
      resourceId: null,
      input: { ...input, dropReason: "github_lifecycle" },
    });
    return {
      status: "claimed",
      providerEventReceiptId: receipt.id,
      installationId: input.installationId,
    };
  }

  async applyGitHubLifecycle(
    claim: Extract<GitHubLifecycleReceiptClaim, { status: "claimed" }>,
    result: GitHubLifecycleResult,
  ): Promise<void> {
    const evidence = this.providerEventReceipts.get(claim.providerEventReceiptId);
    if (evidence?.droppedReason !== "github_lifecycle") return;
    if (result.status !== "absent" || !result.removeBinding) return;
    const connection = this.githubConnections.get(claim.installationId);
    if (connection === undefined) return;
    this.githubConnections.delete(claim.installationId);
    for (const [projectId, source] of this.githubConfigurationSources) {
      if (source.githubConnectionId !== connection.id) continue;
      this.configurationAuthorities.set(projectId, "manual");
      this.githubConfigurationSources.delete(projectId);
    }
    for (const [projectId, attempts] of this.configurationSyncAttempts) {
      this.configurationSyncAttempts.set(
        projectId,
        attempts.map((attempt) =>
          attempt.githubConnectionId === connection.id
            ? Object.assign({}, attempt, { githubConnectionId: null })
            : attempt,
        ),
      );
    }
    for (const [projectId, routes] of this.projectTriggerRoutes) {
      this.projectTriggerRoutes.set(
        projectId,
        routes.filter((route) => route.connectionId !== connection.id),
      );
    }
  }

  releaseGitHubLifecycleReceipt(providerEventReceiptId: string): Promise<void> {
    const receipt = this.providerEventReceipts.get(providerEventReceiptId);
    if (receipt?.droppedReason !== "github_lifecycle") return Promise.resolve();
    this.providerEventReceipts.delete(providerEventReceiptId);
    this.providerEventReceiptIdsByDelivery.delete(
      triggerDeliveryKey(receipt.organizationId, receipt.deliveryId),
    );
    if (receipt.signatureHash !== null)
      this.providerEventReceiptIdsBySignature.delete(receipt.signatureHash);
    return Promise.resolve();
  }

  async findProviderEventReceiptByDeliveryId(
    deliveryId: string,
    organizationId?: string,
  ): Promise<ProviderEventReceiptRecord | undefined> {
    const id = this.providerEventReceiptIdsByDelivery.get(
      organizationId === undefined ? deliveryId : `${organizationId}:${deliveryId}`,
    );
    return id === undefined ? undefined : this.providerEventReceipts.get(id);
  }

  async findProviderEventReceiptById(id: string): Promise<ProviderEventReceiptRecord | undefined> {
    return this.providerEventReceipts.get(id);
  }

  async insertAttachment(input: InsertAttachmentInput): Promise<AttachmentRecord> {
    const sourceKey = attachmentSourceKey(
      input.providerEventReceiptId,
      input.provider,
      input.sourceId,
    );
    const existingId = this.attachmentIdsBySource.get(sourceKey);
    if (existingId !== undefined) return this.readAttachment(existingId);
    const attachment: AttachmentRecord = {
      id: randomUUID(),
      providerEventReceiptId: input.providerEventReceiptId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      provider: input.provider,
      sourceId: input.sourceId,
      locator: input.locator,
      filename: input.filename,
      contentType: input.contentType ?? null,
      byteSize: input.byteSize ?? null,
      createdAt: new Date(),
    };
    this.attachments.set(attachment.id, attachment);
    this.attachmentIdsBySource.set(sourceKey, attachment.id);
    return attachment;
  }

  async findAttachmentBySource(
    providerEventReceiptId: string,
    provider: AttachmentProvider,
    sourceId: string,
  ): Promise<AttachmentRecord | undefined> {
    const id = this.attachmentIdsBySource.get(
      attachmentSourceKey(providerEventReceiptId, provider, sourceId),
    );
    return id === undefined ? undefined : this.attachments.get(id);
  }

  async findAttachmentForExecution(
    executionId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | undefined> {
    const execution = this.agentExecutions.get(executionId);
    const attachment = this.attachments.get(attachmentId);
    if (execution === undefined || attachment === undefined) return undefined;
    const stepRun =
      execution.workflowStepRunId === null
        ? undefined
        : this.workflowStepRuns.get(execution.workflowStepRunId);
    const triggerRun =
      stepRun === undefined ? undefined : this.triggerRuns.get(stepRun.triggerRunId);
    return execution.organizationId === attachment.organizationId &&
      triggerRun?.providerEventReceiptId === attachment.providerEventReceiptId
      ? attachment
      : undefined;
  }

  async insertMachine(input: InsertMachineInput): Promise<MachineRecord> {
    this.organizationIds.add(input.orgId);
    const machine: MachineRecord = {
      id: randomUUID(),
      orgId: input.orgId,
      source: input.source,
      status: input.status ?? "spawning",
      startedAt: new Date(),
      terminatedAt: null,
      shutdownReason: null,
      triggerName: input.triggerName ?? null,
      triggerContext: input.triggerContext ?? null,
      specs: input.specs ?? null,
    };

    this.machines.set(machine.id, machine);
    return machine;
  }

  async findMachineById(id: string): Promise<MachineRecord | undefined> {
    return this.machines.get(id);
  }

  async findMachineForOrganization(
    organizationId: string,
    id: string,
  ): Promise<MachineRecord | undefined> {
    const machine = this.machines.get(id);
    return machine?.orgId === organizationId ? machine : undefined;
  }

  async transitionMachine(
    id: string,
    toStatus: MachineStatus,
    fields?: TerminateMachineFields,
  ): Promise<MachineRecord> {
    const machine = this.readMachine(id);
    const updated: MachineRecord = {
      ...machine,
      status: toStatus,
      terminatedAt: toStatus === "terminated" ? new Date() : machine.terminatedAt,
      shutdownReason: fields?.reason ?? machine.shutdownReason,
    };

    this.machines.set(id, updated);
    return updated;
  }

  async insertAgentExecution(input: InsertAgentExecutionInput): Promise<AgentExecutionRecord> {
    if (input.machineId !== null && !this.machines.has(input.machineId)) {
      throw new Error(`machine not found: ${input.machineId}`);
    }

    const status = input.status ?? "spawning";
    const completedAt = status === "failed" ? this.now() : null;
    const deadlineAt = input.deadlineAt ?? null;
    const idleDeadlineAt = capIdleDeadline(input.idleDeadlineAt, deadlineAt);

    const execution: AgentExecutionRecord = {
      id: input.id ?? randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      machineId: input.machineId,
      status,
      startedAt: input.startedAt ?? this.now(),
      completedAt,
      completedByAgentAt: null,
      deadlineAt,
      idleDeadlineAt,
      result: input.result ?? null,
      triggerContext: input.triggerContext,
      outputContext: input.outputContext,
      reactionState: input.reactionState ?? null,
      configurationRevisionId: input.configurationRevisionId,
      completionTokenHash: input.completionTokenHash ?? null,
      replyClaimedAt: null,
      replyClaimCount: 0,
      outputEmissions: {},
      outputDeliveryAttempts: {},
      launchIntent: input.launchIntent ?? null,
      daemonId: input.daemonId ?? null,
      daemonAgentId: null,
      workflowStepRunId: input.workflowStepRunId ?? null,
      hubAction: null,
      hubActionCompletedAt: null,
      hubActionReadyAt: null,
      hubActionAcknowledgements: emptyHubActionAcknowledgements(),
    };

    this.agentExecutions.set(execution.id, execution);
    this.options.onInsertAgentExecution?.(execution);
    return execution;
  }

  async insertAgentExecutionIfAbsent(
    input: InsertAgentExecutionInput & { id: string },
  ): Promise<AgentExecutionRecord | undefined> {
    if (this.agentExecutions.has(input.id)) return undefined;
    return this.insertAgentExecution(input);
  }

  async issueEnrollmentToken(input: EnrollmentTokenRecord): Promise<boolean> {
    this.enrollmentTokens.set(input.verifier, input);
    return true;
  }
  async startCliAuthorization(
    input: StartCliAuthorizationInput,
  ): Promise<CliAuthorizationRecord | undefined> {
    const now = this.options.now?.() ?? new Date();
    const active = Array.from(this.cliAuthorizations.values()).filter(
      (authorization) =>
        (authorization.status === "pending" || authorization.status === "approved") &&
        authorization.expiresAt > now,
    );
    const fingerprintCount = active.filter(
      (authorization) => authorization.fingerprintVerifier === input.fingerprintVerifier,
    ).length;
    if (fingerprintCount >= input.perFingerprintLimit || active.length >= input.globalLimit) {
      return undefined;
    }
    const authorization: MemoryCliAuthorization = {
      id: input.id,
      deviceVerifier: input.deviceVerifier,
      userCodeVerifier: input.userCodeVerifier,
      fingerprintVerifier: input.fingerprintVerifier,
      status: "pending",
      pollIntervalSeconds: input.pollIntervalSeconds,
      nextPollAt: now,
      approvedOrganizationId: null,
      approvedByUserId: null,
      credential: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1_000),
    };
    this.cliAuthorizations.set(input.deviceVerifier, authorization);
    return authorization;
  }
  async inspectCliAuthorization(userCodeVerifier: string) {
    const now = this.options.now?.() ?? new Date();
    const authorization = Array.from(this.cliAuthorizations.values()).find(
      (candidate) => candidate.userCodeVerifier === userCodeVerifier,
    );
    if (authorization !== undefined && authorization.expiresAt <= now) {
      authorization.status = "expired";
    }
    if (authorization === undefined || authorization.status !== "pending") {
      return undefined;
    }
    return authorization;
  }
  async decideCliAuthorization(
    input: CliAuthorizationDecisionInput,
  ): Promise<"approved" | "denied" | "unavailable" | "forbidden"> {
    const now = this.options.now?.() ?? new Date();
    const authorization = Array.from(this.cliAuthorizations.values()).find(
      (candidate) => candidate.userCodeVerifier === input.userCodeVerifier,
    );
    if (authorization !== undefined && authorization.expiresAt <= now) {
      authorization.status = "expired";
    }
    if (authorization === undefined || authorization.status !== "pending") {
      return "unavailable";
    }
    const status = input.decision === "approve" ? "approved" : "denied";
    authorization.status = status;
    if (input.decision === "approve") {
      authorization.approvedOrganizationId = input.access.organizationId;
      authorization.approvedByUserId = input.access.userId;
    }
    return status;
  }
  async pollCliAuthorization(input: {
    deviceVerifier: string;
    credential: { id: string; prefix: string; verifier: string };
  }): Promise<CliAuthorizationPollResult> {
    const now = this.options.now?.() ?? new Date();
    const authorization = this.cliAuthorizations.get(input.deviceVerifier);
    if (authorization !== undefined && authorization.expiresAt <= now) {
      authorization.status = "expired";
    }
    if (authorization === undefined || authorization.status === "expired") {
      return {
        status: "expired",
        intervalSeconds: authorization?.pollIntervalSeconds ?? 5,
      };
    }
    if (authorization.status === "denied" || authorization.status === "disclosed") {
      return {
        status: authorization.status,
        intervalSeconds: authorization.pollIntervalSeconds,
      };
    }
    if (authorization.nextPollAt > now) {
      authorization.pollIntervalSeconds += 5;
      authorization.nextPollAt = new Date(
        now.getTime() + authorization.pollIntervalSeconds * 1_000,
      );
      return {
        status: "slow_down",
        intervalSeconds: authorization.pollIntervalSeconds,
      };
    }
    authorization.nextPollAt = new Date(now.getTime() + authorization.pollIntervalSeconds * 1_000);
    if (authorization.status === "approved") {
      authorization.credential = input.credential;
      authorization.status = "disclosed";
      return {
        status: "authorized",
        intervalSeconds: authorization.pollIntervalSeconds,
        organizationId: authorization.approvedOrganizationId!,
      };
    }
    return {
      status: authorization.status,
      intervalSeconds: authorization.pollIntervalSeconds,
    };
  }
  async enrollDaemon(input: EnrollDaemonInput) {
    const replay = Array.from(this.daemons.values()).find((daemon) => daemon.id === input.daemonId);
    if (replay) return replay;
    const token = this.enrollmentTokens.get(input.tokenVerifier);
    if (!token || token.consumedAt || token.expiresAt <= input.now) return undefined;
    const suggestedSlug = input.suggestedSlug ?? `daemon-${input.daemonId.slice(0, 8)}`;
    const suggestedSlugTaken = Array.from(this.daemons.values()).some(
      (daemon) =>
        daemon.slug === suggestedSlug &&
        this.machines.get(daemon.machineId)?.orgId === token.organizationId,
    );
    const slug = suggestedSlugTaken
      ? `${suggestedSlug}-${input.daemonId.slice(0, 8)}`
      : suggestedSlug;
    const slugTaken = Array.from(this.daemons.values()).some(
      (daemon) =>
        daemon.slug === slug && this.machines.get(daemon.machineId)?.orgId === token.organizationId,
    );
    if (slugTaken) return { status: "slug_conflict" as const, slug };
    this.enrollmentTokens.set(input.tokenVerifier, {
      ...token,
      consumedAt: input.now,
    });
    const machine = await this.insertMachine({
      orgId: token.organizationId,
      source: { kind: "daemon", daemonId: input.daemonId },
      status: "alive",
    });
    const daemon: DaemonRecord = {
      id: input.daemonId,
      slug,
      machineId: machine.id,
      serverId: input.serverId,
      daemonPublicKey: input.daemonPublicKey,
      credentialVerifier: input.credentialVerifier,
      permissions: input.permissions,
      registeredByApiKeyId: token.issuedByApiKeyId ?? null,
      registeredByCliCredentialId: token.issuedByCliCredentialId ?? null,
      status: "active",
      presence: "offline",
      connectedAt: null,
      disconnectedAt: null,
      lastSeenAt: input.now,
      createdAt: input.now,
    };
    this.daemons.set(daemon.id, daemon);
    return daemon;
  }
  async findDaemonBySlugForOrganization(organizationId: string, slug: string) {
    return Array.from(this.daemons.values()).find(
      (daemon) =>
        daemon.slug === slug && this.machines.get(daemon.machineId)?.orgId === organizationId,
    );
  }
  async findDaemonById(id: string) {
    return this.daemons.get(id);
  }
  async findDaemonForOrganization(organizationId: string, id: string) {
    const daemon = this.daemons.get(id);
    const machine = daemon === undefined ? undefined : this.machines.get(daemon.machineId);
    return machine?.orgId === organizationId ? daemon : undefined;
  }
  async listDaemonsForOrganization(organizationId: string) {
    return Array.from(this.daemons.values())
      .filter((daemon) => this.machines.get(daemon.machineId)?.orgId === organizationId)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }
  async renameDaemonForOrganization(organizationId: string, id: string, slug: string) {
    const daemon = await this.findDaemonForOrganization(organizationId, id);
    if (daemon === undefined) return undefined;
    const slugTaken = Array.from(this.daemons.values()).some(
      (candidate) =>
        candidate.id !== id &&
        candidate.slug === slug &&
        this.machines.get(candidate.machineId)?.orgId === organizationId,
    );
    if (slugTaken) return { status: "slug_conflict" as const, slug };
    const renamed = { ...daemon, slug };
    this.daemons.set(id, renamed);
    return renamed;
  }
  async touchDaemon(id: string) {
    const value = this.daemons.get(id);
    if (value) this.daemons.set(id, { ...value, lastSeenAt: new Date() });
  }
  async setDaemonPresence(id: string, presence: "offline" | "connected") {
    const value = this.daemons.get(id);
    if (!value) return;
    this.daemons.set(id, {
      ...value,
      presence,
      connectedAt: presence === "connected" ? new Date() : value.connectedAt,
      disconnectedAt: presence === "offline" ? new Date() : value.disconnectedAt,
    });
  }
  async setDaemonPermissions(id: string, permissions: string[]) {
    const value = this.daemons.get(id);
    if (!value) return undefined;
    const updated = { ...value, permissions: [...permissions] };
    this.daemons.set(id, updated);
    return updated;
  }
  async revokeDaemon(id: string) {
    const value = this.daemons.get(id);
    if (!value || value.status === "revoked") return false;
    this.daemons.set(id, { ...value, status: "revoked" });
    return true;
  }
  async attachAgentToExecution(executionId: string, daemonId: string, agentId: string) {
    const value = this.readAgentExecution(executionId);
    const updated = { ...value, daemonId: daemonId, daemonAgentId: agentId };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }

  async setAgentExecutionIdleDeadline(
    executionId: string,
    idleDeadlineAt: Date | null,
    observedAt: Date,
    processedAt: Date,
  ) {
    const execution = this.readAgentExecution(executionId);
    if (isTerminalAgentExecutionStatus(execution.status)) return execution;
    if (
      (execution.deadlineAt !== null && execution.deadlineAt.getTime() <= processedAt.getTime()) ||
      (execution.idleDeadlineAt !== null &&
        execution.idleDeadlineAt.getTime() <= observedAt.getTime())
    ) {
      return execution;
    }
    if (execution.workflowStepRunId !== null) {
      const step = this.workflowStepRuns.get(execution.workflowStepRunId);
      const run = step === undefined ? undefined : this.triggerRuns.get(step.triggerRunId);
      if (
        step === undefined ||
        step.status !== "running" ||
        run === undefined ||
        run.status !== "running" ||
        run.deadlineAt.getTime() <= processedAt.getTime()
      ) {
        return execution;
      }
    }
    const boundedIdleDeadlineAt = capIdleDeadline(idleDeadlineAt, execution.deadlineAt);
    const updated = { ...execution, idleDeadlineAt: boundedIdleDeadlineAt };
    this.agentExecutions.set(executionId, updated);
    if (execution.workflowStepRunId !== null) {
      const step = this.workflowStepRuns.get(execution.workflowStepRunId);
      if (step !== undefined) {
        this.workflowStepRuns.set(step.id, { ...step, idleDeadlineAt: boundedIdleDeadlineAt });
      }
    }
    return updated;
  }

  async prepareAgentExecutionForDispatch(
    executionId: string,
    daemonId: string,
    machineId: string,
    completionTokenHash: string,
  ) {
    const execution = this.readAgentExecution(executionId);
    if (isTerminalAgentExecutionStatus(execution.status)) return execution;
    const updated = {
      ...execution,
      daemonId,
      machineId,
      completionTokenHash: execution.completionTokenHash ?? completionTokenHash,
    };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }

  async findAgentExecutionById(id: string): Promise<AgentExecutionRecord | undefined> {
    return this.agentExecutions.get(id);
  }

  async setAgentExecutionReactionState(
    executionId: string,
    reactionState: JsonValue | null,
  ): Promise<AgentExecutionRecord> {
    const execution = this.readAgentExecution(executionId);
    const updated = { ...execution, reactionState };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }
  async findAgentExecutionForOrganization(
    organizationId: string,
    id: string,
  ): Promise<AgentExecutionRecord | undefined> {
    const execution = this.agentExecutions.get(id);
    if (execution === undefined) return undefined;
    const machine =
      execution.machineId === null ? undefined : this.machines.get(execution.machineId);
    return machine?.orgId === organizationId || execution.organizationId === organizationId
      ? execution
      : undefined;
  }
  async findAgentExecutionForProject(projectId: string, id: string) {
    const execution = this.agentExecutions.get(id);
    return execution?.projectId === projectId ? execution : undefined;
  }
  async updateTriggerRunValues(triggerRunId: string, values: unknown): Promise<TriggerRunRecord> {
    const run = this.triggerRuns.get(triggerRunId);
    if (run === undefined) throw new Error(`trigger run not found: ${triggerRunId}`);
    const updated = { ...run, values: freezeEvidence(values) } as TriggerRunRecord;
    this.triggerRuns.set(triggerRunId, updated);
    return updated;
  }

  async listProjectActivityRuns(
    projectId: string,
    limit: number,
  ): Promise<ProjectActivityRunListRecord[]> {
    return (await this.listTriggerRunsForProject(projectId, limit)).flatMap((run) => {
      const receipt = this.providerEventReceipts.get(run.providerEventReceiptId);
      if (receipt === undefined) return [];
      return [{ run, receipt: toProviderEventReceiptRecordSummary(receipt) }];
    });
  }

  async findProjectActivityRun(projectId: string, runId: string) {
    const run = this.triggerRuns.get(runId);
    if (run === undefined || run.projectId !== projectId) return undefined;
    const receipt = this.providerEventReceipts.get(run.providerEventReceiptId);
    if (receipt === undefined) return undefined;
    return { run, receipt, steps: this.listSteps(run.id) };
  }

  private listSteps(triggerRunId: string): WorkflowStepRunRecord[] {
    return [...this.workflowStepRuns.values()]
      .filter((step) => step.triggerRunId === triggerRunId)
      .sort((left, right) => left.ordinal - right.ordinal);
  }

  async beginAgentExecutionOutput(
    executionId: string,
    outputType: string,
    maxOutputs: number | undefined,
    startedAt: Date,
  ): Promise<AgentExecutionOutputAttempt | undefined> {
    const execution = this.agentExecutions.get(executionId);
    if (
      execution === undefined ||
      (maxOutputs !== undefined && maxOutputs < 1) ||
      (execution.status !== "spawning" && execution.status !== "running")
    ) {
      return undefined;
    }
    const activeAttempts = Object.values(execution.outputDeliveryAttempts).filter(
      (attempt) =>
        attempt.outputType === outputType &&
        attempt.status === "pending" &&
        attempt.leaseExpiresAt > startedAt,
    ).length;
    if (
      maxOutputs !== undefined &&
      (execution.outputEmissions[outputType] ?? 0) + activeAttempts >= maxOutputs
    ) {
      return undefined;
    }
    const attempt: AgentExecutionOutputAttempt = {
      id: randomUUID(),
      outputType,
      status: "pending",
      startedAt,
      leaseExpiresAt: new Date(startedAt.getTime() + OUTPUT_ATTEMPT_LEASE_MS),
      completedAt: null,
    };
    this.agentExecutions.set(executionId, {
      ...execution,
      outputDeliveryAttempts: {
        ...execution.outputDeliveryAttempts,
        [attempt.id]: attempt,
      },
    });
    return attempt;
  }

  async completeAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    completedAt: Date,
  ): Promise<AgentExecutionRecord | undefined> {
    const execution = this.agentExecutions.get(executionId);
    if (execution === undefined) return undefined;
    const attempt = execution.outputDeliveryAttempts[attemptId];
    if (attempt === undefined) return undefined;
    if (attempt.status === "succeeded") return execution;
    if (attempt.status !== "pending" || attempt.leaseExpiresAt <= completedAt) {
      if (attempt.status === "pending" && attempt.leaseExpiresAt <= completedAt) {
        this.agentExecutions.set(executionId, {
          ...execution,
          outputDeliveryAttempts: {
            ...execution.outputDeliveryAttempts,
            [attemptId]: { ...attempt, status: "failed", completedAt: null },
          },
        });
      }
      return undefined;
    }
    const count = execution.outputEmissions[attempt.outputType] ?? 0;
    const updated: AgentExecutionRecord = {
      ...execution,
      outputEmissions: { ...execution.outputEmissions, [attempt.outputType]: count + 1 },
      outputDeliveryAttempts: {
        ...execution.outputDeliveryAttempts,
        [attemptId]: { ...attempt, status: "succeeded", completedAt },
      },
    };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }

  async failAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    _failedAt: Date,
  ): Promise<boolean> {
    const execution = this.agentExecutions.get(executionId);
    const attempt = execution?.outputDeliveryAttempts[attemptId];
    if (execution === undefined || attempt === undefined || attempt.status !== "pending") {
      return false;
    }
    this.agentExecutions.set(executionId, {
      ...execution,
      outputDeliveryAttempts: {
        ...execution.outputDeliveryAttempts,
        [attemptId]: { ...attempt, status: "failed", completedAt: null },
      },
    });
    return true;
  }

  async transitionAgentExecution(
    id: string,
    toStatus: AgentExecutionStatus,
    fields: TransitionAgentExecutionFields = {},
  ): Promise<TransitionAgentExecutionResult> {
    const execution = this.readAgentExecution(id);
    if (isTerminalAgentExecutionStatus(execution.status)) {
      return { execution, transitioned: false };
    }
    if (fields.deadlineCondition !== undefined) {
      const current =
        fields.deadlineCondition.kind === "hard" ? execution.deadlineAt : execution.idleDeadlineAt;
      if (
        current?.getTime() !== fields.deadlineCondition.deadlineAt.getTime() ||
        current.getTime() > fields.deadlineCondition.observedAt.getTime()
      ) {
        return { execution, transitioned: false };
      }
    }

    let hubActionCompletedAt = execution.hubActionCompletedAt;
    let hubActionReadyAt = execution.hubActionReadyAt;
    if (fields.hubAction !== undefined) {
      hubActionCompletedAt = fields.hubAction === null ? this.now() : null;
      hubActionReadyAt = null;
    }
    const updated: AgentExecutionRecord = {
      ...execution,
      status: toStatus,
      completedAt: isTerminalAgentExecutionStatus(toStatus) ? this.now() : execution.completedAt,
      completedByAgentAt:
        fields.completedByAgent === true && toStatus === "succeeded"
          ? this.now()
          : execution.completedByAgentAt,
      result: fields.result !== undefined ? fields.result : execution.result,
      idleDeadlineAt: isTerminalAgentExecutionStatus(toStatus) ? null : execution.idleDeadlineAt,
      hubAction: fields.hubAction === undefined ? execution.hubAction : fields.hubAction,
      hubActionCompletedAt,
      hubActionReadyAt,
    };

    this.agentExecutions.set(id, updated);
    return { execution: updated, transitioned: true };
  }

  async findRunningAgentExecutionsForMachine(machineId: string): Promise<AgentExecutionRecord[]> {
    return Array.from(this.agentExecutions.values()).filter(
      (execution) =>
        execution.machineId === machineId &&
        (execution.status === "spawning" || execution.status === "running"),
    );
  }

  async findPendingAgentExecutions(): Promise<AgentExecutionRecord[]> {
    return Array.from(this.agentExecutions.values()).filter(
      (execution) => execution.status === "spawning" || execution.status === "running",
    );
  }

  async findPendingHubActions(daemonId?: string): Promise<AgentExecutionRecord[]> {
    return Array.from(this.agentExecutions.values()).filter(
      (execution) =>
        execution.hubAction !== null &&
        execution.hubActionCompletedAt === null &&
        (daemonId === undefined || execution.daemonId === daemonId),
    );
  }

  async markAgentExecutionHubActionReady(
    executionId: string,
    observedAt = this.now(),
  ): Promise<AgentExecutionRecord | undefined> {
    const execution = this.agentExecutions.get(executionId);
    if (
      execution === undefined ||
      execution.status !== "succeeded" ||
      execution.completedByAgentAt === null ||
      execution.hubAction !== "archive" ||
      execution.hubActionCompletedAt !== null ||
      execution.hubActionReadyAt !== null ||
      execution.hubActionAcknowledgements.terminalAt === null ||
      execution.hubActionAcknowledgements.idleAt === null ||
      execution.hubActionAcknowledgements.finishExecutionCall === null ||
      execution.hubActionAcknowledgements.finishExecutionCall.status !== "completed"
    ) {
      return undefined;
    }
    const updated = { ...execution, hubActionReadyAt: observedAt };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }

  async recordAgentExecutionHubAcknowledgement(
    executionId: string,
    acknowledgement: AgentExecutionHubAcknowledgementInput,
  ): Promise<AgentExecutionRecord | undefined> {
    const execution = this.agentExecutions.get(executionId);
    if (execution === undefined) return undefined;
    const current = execution.hubActionAcknowledgements;
    const updatedAcknowledgements: AgentExecutionHubAcknowledgements = {
      terminalAt: current.terminalAt,
      idleAt: current.idleAt,
      finishExecutionCall: current.finishExecutionCall,
    };
    if (acknowledgement.kind === "terminal") {
      if (
        updatedAcknowledgements.terminalAt === null ||
        acknowledgement.observedAt.getTime() > updatedAcknowledgements.terminalAt.getTime()
      ) {
        updatedAcknowledgements.terminalAt = acknowledgement.observedAt;
      }
    } else if (acknowledgement.kind === "idle") {
      if (
        updatedAcknowledgements.idleAt === null ||
        acknowledgement.observedAt.getTime() > updatedAcknowledgements.idleAt.getTime()
      ) {
        updatedAcknowledgements.idleAt = acknowledgement.observedAt;
      }
    } else {
      const previous = updatedAcknowledgements.finishExecutionCall;
      if (
        previous === undefined ||
        previous === null ||
        (previous.status !== "completed" &&
          (acknowledgement.status === "completed" ||
            acknowledgement.observedAt.getTime() > previous.observedAt.getTime()))
      ) {
        updatedAcknowledgements.finishExecutionCall = {
          callId: acknowledgement.callId ?? null,
          status: acknowledgement.status,
          observedAt: acknowledgement.observedAt,
        };
      }
    }
    const updated = { ...execution, hubActionAcknowledgements: updatedAcknowledgements };
    this.agentExecutions.set(executionId, updated);
    return updated;
  }

  async completeHubAction(executionId: string, action: "interrupt" | "archive"): Promise<boolean> {
    const execution = this.readAgentExecution(executionId);
    if (execution.hubAction !== action || execution.hubActionCompletedAt !== null) return false;
    this.agentExecutions.set(executionId, {
      ...execution,
      hubActionCompletedAt: new Date(),
    });
    return true;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    if (
      Array.from(this.projects.values()).some(
        (project) => project.organizationId === input.organizationId && project.slug === input.slug,
      )
    ) {
      throw new Error("project slug already exists");
    }
    const now = new Date();
    const project: ProjectRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug,
      status: "active",
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      activeConfigurationRevisionId: null,
    };
    this.organizationIds.add(input.organizationId);
    this.projects.set(project.id, project);
    this.configurationAuthorities.set(project.id, "manual");
    return project;
  }

  async restoreProject(organizationId: string, projectId: string): Promise<ProjectRecord> {
    const project = this.projects.get(projectId);
    if (project === undefined || project.organizationId !== organizationId) {
      throw new Error("project not found");
    }
    const restored: ProjectRecord = {
      ...project,
      status: "active",
      archivedAt: null,
      updatedAt: new Date(),
    };
    this.projects.set(projectId, restored);
    return restored;
  }

  async getOrganizationEntitlements(
    organizationId: string,
  ): Promise<OrganizationEntitlementsRecord | undefined> {
    return this.organizationEntitlements.get(organizationId);
  }

  async stampOrganizationEntitlements(
    input: StampOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord> {
    const existing = this.organizationEntitlements.get(input.organizationId);
    // Idempotent: an identical granted template and plan provenance is a no-op — no timestamp
    // bump, no duplicate audit row — mirroring the Postgres conditional stamp.
    if (
      existing !== undefined &&
      existing.planId === input.planId &&
      existing.planVersion === input.planVersion &&
      JSON.stringify(existing.granted) === JSON.stringify(input.granted)
    ) {
      return existing;
    }
    const now = this.now();
    const record: OrganizationEntitlementsRecord = {
      organizationId: input.organizationId,
      granted: input.granted,
      overrides: existing?.overrides ?? {},
      planId: input.planId,
      planVersion: input.planVersion,
      stampedAt: now,
      updatedAt: now,
    };
    this.organizationEntitlements.set(input.organizationId, record);
    this.recordEntitlementChange({
      organizationId: input.organizationId,
      actor: input.actor,
      source: input.source,
      before: existing === undefined ? null : entitlementSnapshot(existing),
      after: entitlementSnapshot(record),
      reason: input.reason,
    });
    return record;
  }

  async overrideOrganizationEntitlements(
    input: OverrideOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord> {
    const existing = this.organizationEntitlements.get(input.organizationId);
    if (existing === undefined) {
      throw new Error(`organization has no entitlements record: ${input.organizationId}`);
    }
    // Merge the patch against the current row, mirroring the Postgres locked-row merge. No await
    // between read and write, so concurrent overrides cannot interleave and lose keys.
    const overrides = mergeOverrides(
      entitlementOverridesSchema.parse(existing.overrides),
      input.patch,
    );
    const record: OrganizationEntitlementsRecord = {
      ...existing,
      overrides,
      updatedAt: this.now(),
    };
    this.organizationEntitlements.set(input.organizationId, record);
    this.recordEntitlementChange({
      organizationId: input.organizationId,
      actor: input.actor,
      source: "override",
      before: entitlementSnapshot(existing),
      after: entitlementSnapshot(record),
      reason: input.reason,
    });
    return record;
  }

  async clearOrganizationEntitlementsOverride(
    input: ClearOrganizationEntitlementsOverrideInput,
  ): Promise<OrganizationEntitlementsRecord> {
    const existing = this.organizationEntitlements.get(input.organizationId);
    if (existing === undefined) {
      throw new Error(`organization has no entitlements record: ${input.organizationId}`);
    }
    // Drop the key from the current row, mirroring the Postgres locked-row clear. No await
    // between read and write, so a concurrent override cannot interleave.
    const overrides = clearOverrideKey(
      entitlementOverridesSchema.parse(existing.overrides),
      input.key,
    );
    const record: OrganizationEntitlementsRecord = {
      ...existing,
      overrides,
      updatedAt: this.now(),
    };
    this.organizationEntitlements.set(input.organizationId, record);
    this.recordEntitlementChange({
      organizationId: input.organizationId,
      actor: input.actor,
      source: "override",
      before: entitlementSnapshot(existing),
      after: entitlementSnapshot(record),
      reason: input.reason,
    });
    return record;
  }

  async listEntitlementChanges(
    organizationId: string,
    limit: number,
  ): Promise<EntitlementChangeRecord[]> {
    return this.entitlementChanges
      .filter((change) => change.organizationId === organizationId)
      .slice(-limit)
      .toReversed();
  }

  private recordEntitlementChange(
    input: Omit<EntitlementChangeRecord, "id" | "actorName" | "createdAt">,
  ): void {
    this.entitlementChanges.push({
      ...input,
      id: randomUUID(),
      actorName: null,
      createdAt: this.now(),
    });
  }

  async consumeOrganizationUsage(
    input: ConsumeOrganizationUsageInput,
  ): Promise<OrganizationUsageRecord | undefined> {
    // No `await` between read and write, so this is as atomic as the single-statement
    // Postgres upsert it mirrors: nothing can interleave on Node's single thread.
    const key = usageKey(input.organizationId, input.meter, input.periodStart);
    const existing = this.organizationUsage.get(key);
    const used = (existing?.used ?? 0) + input.amount;
    if (input.limit !== null && used > input.limit) return undefined;
    const record: OrganizationUsageRecord = {
      organizationId: input.organizationId,
      meter: input.meter,
      periodStart: input.periodStart,
      used,
    };
    this.organizationUsage.set(key, record);
    return record;
  }

  async getOrganizationUsage(
    organizationId: string,
    meter: string,
    periodStart: Date,
  ): Promise<OrganizationUsageRecord | undefined> {
    return this.organizationUsage.get(usageKey(organizationId, meter, periodStart));
  }

  async syncBillingPlan(input: SyncBillingPlanInput): Promise<BillingPlanRecord> {
    const record: BillingPlanRecord = {
      id: input.id,
      slug: input.slug,
      name: input.name,
      template: input.template,
      templateHash: input.templateHash,
      marketing: input.marketing,
      active: input.active,
      syncedAt: this.now(),
      prices: input.prices.map((price) => ({ ...price, planId: input.id })),
    };
    this.billingPlans.set(input.id, record);
    return record;
  }

  async deactivateBillingPlansExcept(activeIds: readonly string[]): Promise<void> {
    const keep = new Set(activeIds);
    for (const [id, plan] of this.billingPlans) {
      if (!keep.has(id) && plan.active) this.billingPlans.set(id, { ...plan, active: false });
    }
  }

  async listBillingPlans(): Promise<BillingPlanRecord[]> {
    return Array.from(this.billingPlans.values());
  }

  async reconcileOrganizationBilling(
    input: ReconcileOrganizationBillingInput,
  ): Promise<OrganizationBillingCustomerRecord> {
    const record: OrganizationBillingCustomerRecord = {
      organizationId: input.organizationId,
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: this.now(),
    };
    this.organizationBillingCustomers.set(input.organizationId, record);
    // No await between the two writes, so on Node's single thread the mirror and the stamp land
    // together — the in-memory stand-in for the Postgres transaction that couples them.
    if (input.stamp !== undefined) {
      await this.stampOrganizationEntitlements({
        organizationId: input.organizationId,
        ...input.stamp,
      });
    }
    return record;
  }

  async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Node runs one callback at a time, so a per-key promise chain is a faithful in-memory
    // stand-in for the Postgres advisory lock: same-key sections run strictly in sequence.
    const previous = this.advisoryLocks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const held = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    this.advisoryLocks.set(key, held);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.advisoryLocks.get(key) === held) this.advisoryLocks.delete(key);
    }
  }

  async getOrganizationBillingCustomer(
    organizationId: string,
  ): Promise<OrganizationBillingCustomerRecord | undefined> {
    return this.organizationBillingCustomers.get(organizationId);
  }

  async listProjectsForOrganization(organizationId: string) {
    const runtimeProjects = new Set(
      Array.from(this.organizationTriggers.values()).map(
        ({ runtimeProjectId }) => runtimeProjectId,
      ),
    );
    return Array.from(this.projects.values()).filter(
      (project) =>
        project.organizationId === organizationId &&
        project.status === "active" &&
        !runtimeProjects.has(project.id),
    );
  }

  async listPendingProjectTriggerMigrations(): Promise<PendingProjectTriggerMigration[]> {
    const runtimeProjects = new Set(
      Array.from(this.organizationTriggers.values()).map(
        ({ runtimeProjectId }) => runtimeProjectId,
      ),
    );
    return Array.from(this.projects.values()).flatMap((project) => {
      if (
        project.status !== "active" ||
        project.activeConfigurationRevisionId === null ||
        this.migratedProjects.has(project.id) ||
        runtimeProjects.has(project.id)
      ) {
        return [];
      }
      const revision = this.configurationRevisions.get(project.activeConfigurationRevisionId);
      return revision === undefined ? [] : [{ project, revision }];
    });
  }

  async migrateProjectTriggers(
    input: MigrateProjectTriggersInput,
  ): Promise<OrganizationTriggerRecord[]> {
    if (this.migratedProjects.has(input.projectId)) return [];
    const project = this.projects.get(input.projectId);
    if (
      project === undefined ||
      project.organizationId !== input.organizationId ||
      project.activeConfigurationRevisionId !== input.configurationRevisionId
    ) {
      throw new Error("project configuration changed during trigger migration");
    }
    const compiledCandidates = input.triggers.map((candidate) => {
      if (candidate.format !== "single_run" && candidate.format !== "legacy_multistep") {
        throw new Error("invalid organization trigger format");
      }
      return parseCompiledHubConfig(candidate.normalizedConfiguration);
    });
    const legacyRoutes = this.projectTriggerRoutes.get(input.projectId) ?? [];
    const candidateRoutes = input.triggers.map((candidate, index) => {
      const configuredEventName = compiledCandidates[index]!.triggers[0]?.on;
      if (configuredEventName === undefined) {
        throw new Error(`migrated trigger ${candidate.name} has no configured event`);
      }
      return legacyRoutes
        .filter((route) => route.triggerName === candidate.name)
        .map(
          (route): OrganizationTriggerRoute => ({
            provider: route.provider,
            connectionId: route.connectionId,
            resourceId: route.resourceId,
            configuredEventName,
          }),
        );
    });
    if (
      candidateRoutes.reduce((total, routes) => total + routes.length, 0) !== legacyRoutes.length
    ) {
      throw new Error("project trigger routes do not match migrated triggers");
    }
    const created: OrganizationTriggerRecord[] = [];
    for (const [index, candidate] of input.triggers.entries()) {
      const name = this.availableMigratedTriggerName(
        input.organizationId,
        input.projectSlug,
        candidate.name,
      );
      const now = this.now();
      const triggerId = randomUUID();
      const revisionId = randomUUID();
      const runtimeProjectId = this.createTriggerRuntimeProject({
        organizationId: input.organizationId,
        name: candidate.name,
        createdByUserId: null,
      });
      const trigger: OrganizationTriggerRecord = {
        id: triggerId,
        organizationId: input.organizationId,
        name,
        enabled: candidate.enabled,
        format: candidate.format,
        runtimeProjectId,
        activeRevisionId: revisionId,
        createdAt: now,
        updatedAt: now,
      };
      const revision: OrganizationTriggerRevisionRecord = {
        id: revisionId,
        triggerId,
        organizationId: input.organizationId,
        version: 1,
        yaml: candidate.yaml,
        normalizedConfiguration: candidate.normalizedConfiguration,
        contentHash: candidate.contentHash,
        sourceKind: "project_migration",
        sourceEvidence: candidate.sourceEvidence,
        createdByUserId: null,
        createdAt: now,
      };
      this.organizationTriggers.set(trigger.id, trigger);
      this.organizationTriggerRevisions.set(revision.id, revision);
      const routes = candidateRoutes[index]!;
      this.organizationTriggerRoutes.set(trigger.id, routes);
      const runtimeRevision = await this.insertProjectConfigurationRevision({
        projectId: runtimeProjectId,
        sourceKind: "manual",
        sourceEvidence: { kind: "organization_trigger_adapter", triggerId },
        rawYaml: candidate.yaml,
        normalizedConfiguration: candidate.normalizedConfiguration,
        contentHash: candidate.contentHash,
      });
      const configuration = compiledCandidates[index]!;
      await this.activateProjectConfigurationRevision(
        runtimeProjectId,
        runtimeRevision.id,
        routes.map((route) => ({
          provider: route.provider,
          connectionId: route.connectionId,
          resourceId: route.resourceId,
          triggerName:
            configuration.triggers.find(({ on }) => on === route.configuredEventName)?.name ??
            configuration.triggers[0]?.name ??
            candidate.name,
        })),
      );
      created.push(trigger);
    }
    this.projectTriggerRoutes.delete(input.projectId);
    this.projects.set(input.projectId, {
      ...project,
      status: "archived",
      activeConfigurationRevisionId: null,
      archivedAt: this.now(),
      updatedAt: this.now(),
    });
    this.migratedProjects.add(input.projectId);
    return created;
  }

  async listOrganizationTriggers(organizationId: string): Promise<OrganizationTriggerRecord[]> {
    return Array.from(this.organizationTriggers.values()).filter(
      (trigger) => trigger.organizationId === organizationId,
    );
  }

  async findOrganizationTriggerRevision(
    triggerId: string,
    revisionId: string,
  ): Promise<OrganizationTriggerRevisionRecord | undefined> {
    const revision = this.organizationTriggerRevisions.get(revisionId);
    return revision?.triggerId === triggerId ? revision : undefined;
  }

  async findOrganizationTriggerMigrationRevision(
    triggerId: string,
  ): Promise<OrganizationTriggerRevisionRecord | undefined> {
    return Array.from(this.organizationTriggerRevisions.values())
      .filter(
        (revision) =>
          revision.triggerId === triggerId && revision.sourceKind === "project_migration",
      )
      .sort((left, right) => left.version - right.version)[0];
  }

  async saveOrganizationTrigger(
    input: SaveOrganizationTriggerInput,
  ): Promise<OrganizationTriggerRecord> {
    const existing =
      input.triggerId === undefined ? undefined : this.organizationTriggers.get(input.triggerId);
    if (existing !== undefined && existing.organizationId !== input.organizationId) {
      throw new Error("organization trigger not found");
    }
    if (
      Array.from(this.organizationTriggers.values()).some(
        (trigger) =>
          trigger.organizationId === input.organizationId &&
          trigger.name === input.name &&
          trigger.id !== input.triggerId,
      )
    ) {
      throw new Error("trigger name already exists");
    }
    const now = this.now();
    const triggerId = existing?.id ?? randomUUID();
    const runtimeProjectId =
      existing?.runtimeProjectId ??
      this.createTriggerRuntimeProject({
        organizationId: input.organizationId,
        name: input.name,
        createdByUserId: input.createdByUserId,
      });
    const revisionId = randomUUID();
    const version =
      Math.max(
        0,
        ...Array.from(this.organizationTriggerRevisions.values())
          .filter((revision) => revision.triggerId === triggerId)
          .map((revision) => revision.version),
      ) + 1;
    const revision: OrganizationTriggerRevisionRecord = {
      id: revisionId,
      triggerId,
      organizationId: input.organizationId,
      version,
      yaml: input.yaml,
      normalizedConfiguration: input.normalizedConfiguration,
      contentHash: input.contentHash,
      sourceKind: input.sourceKind,
      sourceEvidence: input.sourceEvidence,
      createdByUserId: input.createdByUserId,
      createdAt: now,
    };
    const trigger: OrganizationTriggerRecord = {
      id: triggerId,
      organizationId: input.organizationId,
      name: input.name,
      enabled: input.enabled,
      format: input.format,
      runtimeProjectId,
      activeRevisionId: revisionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.organizationTriggerRevisions.set(revision.id, revision);
    this.organizationTriggers.set(trigger.id, trigger);
    this.organizationTriggerRoutes.set(trigger.id, [...input.routes]);
    const runtimeRevision = await this.insertProjectConfigurationRevision({
      projectId: runtimeProjectId,
      sourceKind: input.sourceKind,
      sourceEvidence: { kind: "organization_trigger_adapter", triggerId },
      rawYaml: input.yaml,
      normalizedConfiguration: input.normalizedConfiguration,
      contentHash: input.contentHash,
      createdByUserId: input.createdByUserId,
    });
    const configuration = parseCompiledHubConfig(input.normalizedConfiguration);
    await this.activateProjectConfigurationRevision(
      runtimeProjectId,
      runtimeRevision.id,
      input.routes.map((route) => ({
        provider: route.provider,
        connectionId: route.connectionId,
        resourceId: route.resourceId,
        triggerName:
          configuration.triggers.find(({ on }) => on === route.configuredEventName)?.name ??
          configuration.triggers[0]?.name ??
          input.name,
      })),
    );
    return trigger;
  }

  private createTriggerRuntimeProject(input: {
    organizationId: string;
    name: string;
    createdByUserId: string | null;
  }): string {
    const id = randomUUID();
    const now = this.now();
    this.projects.set(id, {
      id,
      organizationId: input.organizationId,
      name: `Trigger runtime: ${input.name}`,
      slug: `trigger-${id.slice(0, 8)}`,
      status: "active",
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      activeConfigurationRevisionId: null,
    });
    this.configurationAuthorities.set(id, "manual");
    return id;
  }

  private availableMigratedTriggerName(
    organizationId: string,
    projectSlug: string,
    requestedName: string,
  ): string {
    const occupied = new Set(
      Array.from(this.organizationTriggers.values())
        .filter((trigger) => trigger.organizationId === organizationId)
        .map((trigger) => trigger.name),
    );
    if (!occupied.has(requestedName)) return requestedName;
    const base = `${projectSlug}-${requestedName}`;
    if (!occupied.has(base)) return base;
    let suffix = 2;
    while (occupied.has(`${base}-${String(suffix)}`)) suffix += 1;
    return `${base}-${String(suffix)}`;
  }

  async findProjectForOrganization(organizationId: string, projectId: string) {
    const project = this.projects.get(projectId);
    return project?.organizationId === organizationId ? project : undefined;
  }

  async findProjectById(projectId: string) {
    return this.projects.get(projectId);
  }

  async findProjectBySlugForOrganization(organizationId: string, slug: string) {
    return Array.from(this.projects.values()).find(
      (project) => project.organizationId === organizationId && project.slug === slug,
    );
  }

  async listOrganizationsForOperator(): Promise<OperatorOrganizationRecord[]> {
    return this.operatorOrganizations();
  }

  async findOrganizationForOperator(slug: string): Promise<OperatorOrganizationRecord | undefined> {
    return this.operatorOrganizations().find((organization) => organization.slug === slug);
  }

  /** Distinct organizations derived from the membership fixtures — the in-memory store models
   * organizations only through those, so the operator picker reads the same source. */
  private operatorOrganizations(): OperatorOrganizationRecord[] {
    const seen = new Map<string, OperatorOrganizationRecord>();
    for (const membership of this.options.memberships ?? []) {
      seen.set(membership.organizationId, {
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
      });
    }
    return Array.from(seen.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  async resolveTenantRouteAccess(
    userId: string,
    organizationSlug: string,
    projectSlug?: string,
  ): Promise<TenantRouteAccess | undefined> {
    const membership = this.options.memberships?.find(
      (candidate) => candidate.userId === userId && candidate.organizationSlug === organizationSlug,
    );
    if (membership === undefined) return undefined;
    const project =
      projectSlug === undefined
        ? undefined
        : Array.from(this.projects.values()).find(
            (candidate) =>
              candidate.organizationId === membership.organizationId &&
              candidate.slug === projectSlug &&
              candidate.status === "active",
          );
    if (projectSlug !== undefined && project === undefined) return undefined;
    return {
      organization: {
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
      },
      membership: { id: membership.membershipId, role: membership.role },
      ...(project === undefined ? {} : { project }),
    };
  }

  async archiveProject(organizationId: string, projectId: string, _userId: string) {
    const project = await this.findProjectForOrganization(organizationId, projectId);
    if (project === undefined) throw new Error("project access denied");
    const now = new Date();
    const archived: ProjectRecord = {
      ...project,
      status: "archived",
      archivedAt: now,
      updatedAt: now,
      activeConfigurationRevisionId: null,
    };
    this.projects.set(projectId, archived);
    return archived;
  }

  async updateProjectSlug(
    organizationId: string,
    projectId: string,
    slug: string,
    _userId: string,
  ) {
    const project = await this.findProjectForOrganization(organizationId, projectId);
    if (project === undefined) throw new Error("project access denied");
    const updated = { ...project, slug, updatedAt: new Date() };
    this.projects.set(projectId, updated);
    return updated;
  }

  async insertProjectConfigurationRevision(
    input: InsertProjectConfigurationRevisionInput,
  ): Promise<ProjectConfigurationRevisionRecord> {
    const project = this.projects.get(input.projectId);
    if (project?.status !== "active") throw new Error("project not found");
    const version =
      Math.max(
        0,
        ...Array.from(this.configurationRevisions.values())
          .filter((revision) => revision.projectId === input.projectId)
          .map((revision) => revision.version),
      ) + 1;
    const now = new Date();
    const revision: ProjectConfigurationRevisionRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      organizationId: project.organizationId,
      version,
      sourceKind: input.sourceKind,
      sourceEvidence: input.sourceEvidence,
      rawYaml: input.rawYaml ?? null,
      normalizedConfiguration: input.normalizedConfiguration,
      validationErrors: input.validationErrors ?? null,
      contentHash: input.contentHash,
      createdByUserId: input.createdByUserId ?? null,
      receivedAt: now,
      createdAt: now,
      validatedAt: input.validationErrors === undefined ? now : null,
    };
    this.configurationRevisions.set(revision.id, revision);
    return revision;
  }

  async activateProjectConfigurationRevision(
    projectId: string,
    revisionId: string,
    routes?: readonly ProjectTriggerRoute[],
  ) {
    const project = this.projects.get(projectId);
    const revision = this.configurationRevisions.get(revisionId);
    if (project?.status !== "active" || revision?.projectId !== projectId)
      throw new Error("configuration revision not found");
    if (revision.validationErrors !== null) throw new Error("invalid configuration revision");
    this.projectTriggerRoutes.set(projectId, [
      ...(routes ?? this.projectTriggerRoutes.get(projectId) ?? []),
    ]);
    this.projects.set(projectId, {
      ...project,
      activeConfigurationRevisionId: revisionId,
      updatedAt: new Date(),
    });
    return revision;
  }

  async findProjectConfigurationRollbackTarget(projectId: string) {
    const active = await this.findActiveProjectConfiguration(projectId);
    return Array.from(this.configurationRevisions.values())
      .filter(
        (revision) =>
          revision.projectId === projectId &&
          revision.validationErrors === null &&
          active !== undefined &&
          revision.version < active.version,
      )
      .sort((left, right) => right.version - left.version)[0];
  }

  async rollbackProjectConfiguration(
    projectId: string,
    targetRevisionId: string,
    routes: readonly ProjectTriggerRoute[],
  ) {
    const target = await this.findProjectConfigurationRollbackTarget(projectId);
    if (target?.id !== targetRevisionId) throw new Error("configuration rollback target changed");
    return this.activateProjectConfigurationRevision(projectId, targetRevisionId, routes);
  }

  async findActiveProjectConfiguration(projectId: string) {
    const revisionId = this.projects.get(projectId)?.activeConfigurationRevisionId;
    return revisionId === null || revisionId === undefined
      ? undefined
      : this.configurationRevisions.get(revisionId);
  }

  async findProjectConfigurationRevision(projectId: string, revisionId: string) {
    const revision = this.configurationRevisions.get(revisionId);
    return revision?.projectId === projectId ? revision : undefined;
  }

  async switchProjectConfigurationToManual(input: SwitchProjectConfigurationToManualInput) {
    const revision = await this.insertProjectConfigurationRevision({
      projectId: input.projectId,
      sourceKind: "manual",
      sourceEvidence: {
        kind: "authority-switch",
        formattingPreserved: true,
        bundle: input.bundle,
      },
      rawYaml: input.rawYaml,
      normalizedConfiguration: input.normalizedConfiguration,
      contentHash: input.contentHash,
      createdByUserId: input.userId,
    });
    this.configurationAuthorities.set(input.projectId, "manual");
    this.githubConfigurationSources.delete(input.projectId);
    return this.activateProjectConfigurationRevision(input.projectId, revision.id, input.routes);
  }

  async setProjectGitHubConfigurationSource(
    input: SetProjectGitHubConfigurationSourceInput,
  ): Promise<void> {
    const project = this.projects.get(input.projectId);
    if (project?.status !== "active") throw new Error("project access denied");
    this.configurationAuthorities.set(input.projectId, "github");
    this.githubConfigurationSources.set(input.projectId, {
      githubConnectionId: input.githubConnectionId,
      githubRepositoryId: input.githubRepositoryId,
      githubRepositoryFullName: input.githubRepositoryFullName,
      githubDefaultBranch: input.githubDefaultBranch,
      automaticDeploymentEnabled: input.automaticDeploymentEnabled,
    });
  }

  async recordConfigurationSyncAttempt(
    input: RecordConfigurationSyncAttemptInput,
  ): Promise<ConfigurationSyncAttemptRecord> {
    const attempt: ConfigurationSyncAttemptRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      githubConnectionId: input.githubConnectionId,
      githubRepositoryId: input.githubRepositoryId,
      webhookDeliveryId: input.webhookDeliveryId,
      commitSha: input.commitSha,
      outcome: input.outcome,
      evidence: structuredClone(input.evidence),
      createdAt: this.options.now?.() ?? new Date(),
    };
    const attempts = this.configurationSyncAttempts.get(input.projectId) ?? [];
    attempts.push(attempt);
    this.configurationSyncAttempts.set(input.projectId, attempts);
    return attempt;
  }

  async projectConfigurationReadModel(projectId: string) {
    const authority = this.configurationAuthorities.get(projectId);
    if (authority === undefined) throw new Error("configuration authority not found");
    return {
      authority,
      activeRevision: (await this.findActiveProjectConfiguration(projectId)) ?? null,
      lastSyncAttempt: this.configurationSyncAttempts.get(projectId)?.at(-1) ?? null,
      sourceState:
        authority === "manual"
          ? ({ kind: "manual", formattingPreserved: false } as const)
          : ({
              kind: "github",
              githubConnectionId:
                this.githubConfigurationSources.get(projectId)?.githubConnectionId ?? "unavailable",
              githubRepositoryId:
                this.githubConfigurationSources.get(projectId)?.githubRepositoryId ?? 0,
              githubRepositoryFullName:
                this.githubConfigurationSources.get(projectId)?.githubRepositoryFullName ??
                "unavailable",
              githubDefaultBranch:
                this.githubConfigurationSources.get(projectId)?.githubDefaultBranch ?? "main",
              automaticDeploymentEnabled:
                this.githubConfigurationSources.get(projectId)?.automaticDeploymentEnabled ?? false,
            } as const),
    };
  }

  async organizationConnectionUsage(organizationId: string): Promise<OrganizationConnectionUsage> {
    return {
      github: Array.from(this.githubConnections.values()).filter(
        (connection) => connection.organizationId === organizationId,
      ),
      discord: Array.from(this.discordConnections.values()).filter(
        (connection) => connection.organizationId === organizationId,
      ),
      slack: Array.from(this.slackConnections.values()).filter(
        (connection) => connection.organizationId === organizationId,
      ),
      linear: Array.from(this.linearConnections.values()).filter(
        (connection) => connection.organizationId === organizationId,
      ),
    };
  }

  async listGitHubRepositories(organizationId: string) {
    return Array.from(this.githubRepositories.values()).filter(
      (repository) => repository.organizationId === organizationId,
    );
  }

  async findGitHubRepositoryForOrganization(organizationId: string, fullName: string) {
    const rows = Array.from(this.githubRepositories.values()).filter(
      (repository) =>
        repository.organizationId === organizationId && repository.fullName === fullName,
    );
    if (rows.length > 1) throw new Error("github repository resource is ambiguous");
    return rows[0];
  }

  async upsertGitHubRepositories(
    organizationId: string,
    connectionId: string,
    repositories: Array<
      Pick<GitHubRepositoryRecord, "repositoryId" | "fullName" | "defaultBranch">
    >,
  ) {
    for (const repository of repositories) {
      const id =
        this.githubRepositories.get(`${connectionId}:${repository.repositoryId}`)?.id ??
        randomUUID();
      this.githubRepositories.set(`${connectionId}:${repository.repositoryId}`, {
        id,
        organizationId,
        connectionId,
        ...repository,
      });
    }
  }

  async findGitHubConfigurationTarget(
    projectId: string,
    repositoryId?: number,
  ): Promise<GitHubConfigurationTarget | undefined> {
    const source = this.githubConfigurationSources.get(projectId);
    if (
      source === undefined ||
      (repositoryId !== undefined && source.githubRepositoryId !== repositoryId)
    ) {
      return undefined;
    }
    const repository = Array.from(this.githubRepositories.values()).find(
      (candidate) =>
        candidate.connectionId === source.githubConnectionId &&
        candidate.repositoryId === source.githubRepositoryId,
    );
    const connection = Array.from(this.githubConnections.values()).find(
      (candidate) => candidate.id === source.githubConnectionId,
    );
    return repository === undefined || connection === undefined
      ? undefined
      : {
          ...repository,
          projectId,
          installationId: connection.installationId,
          automaticDeploymentEnabled: source.automaticDeploymentEnabled,
        };
  }

  async listGitHubConfigurationTargets(
    organizationId: string,
    connectionId: string,
    repositoryId: number,
  ): Promise<GitHubConfigurationTarget[]> {
    return Array.from(this.githubConfigurationSources.entries()).flatMap(([projectId, source]) => {
      const project = this.projects.get(projectId);
      if (
        project?.organizationId !== organizationId ||
        project.status !== "active" ||
        source.githubConnectionId !== connectionId ||
        source.githubRepositoryId !== repositoryId
      ) {
        return [];
      }
      const repository = Array.from(this.githubRepositories.values()).find(
        (candidate) =>
          candidate.connectionId === source.githubConnectionId &&
          candidate.repositoryId === source.githubRepositoryId,
      );
      const connection = Array.from(this.githubConnections.values()).find(
        (candidate) => candidate.id === source.githubConnectionId,
      );
      return repository === undefined || connection === undefined
        ? []
        : [
            {
              ...repository,
              projectId,
              installationId: connection.installationId,
              automaticDeploymentEnabled: source.automaticDeploymentEnabled,
            },
          ];
    });
  }

  async listUnroutedProviderEventsForOrganization(organizationId: string) {
    const routedReceiptIds = new Set(
      [...this.triggerRuns.values()].map((run) => run.providerEventReceiptId),
    );
    return [...this.providerEventReceipts.values()]
      .filter(
        (receipt) =>
          receipt.organizationId === organizationId &&
          receipt.droppedReason !== null &&
          isProviderEventDropReasonCode(receipt.droppedReason) &&
          !routedReceiptIds.has(receipt.id),
      )
      .sort(
        (left, right) =>
          right.receivedAt.getTime() - left.receivedAt.getTime() || right.id.localeCompare(left.id),
      )
      .slice(0, 50)
      .map(toProviderEventReceiptRecordSummary);
  }

  async isOrganizationMember(): Promise<boolean> {
    return false;
  }

  startConnectionAttempt(_input: StartConnectionAttemptInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  findConnectionAttemptConfiguration() {
    return Promise.resolve(undefined);
  }

  readConnectionAttempt(_input: ReadConnectionAttemptInput) {
    return connectionPersistenceUnavailable();
  }

  consumeConnectionAttempt(_input: ReadConnectionAttemptInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  advanceGitHubConnectionAttempt(_input: AdvanceGitHubConnectionAttemptInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  bindGitHubConnection(_input: BindGitHubConnectionInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  bindDiscordConnection(_input: BindDiscordConnectionInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  bindSlackConnection(_input: BindSlackConnectionInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  completeSlackProviderApplication(_input: CompleteSlackProviderApplicationInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  bindLinearConnection(_input: BindLinearConnectionInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  completeLinearProviderApplication(_input: CompleteLinearProviderApplicationInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  updateLinearConnectionTokens(_input: UpdateLinearConnectionTokensInput): Promise<void> {
    return connectionPersistenceUnavailable();
  }

  withLinearConnectionRefresh<T>(
    linearOrganizationId: string,
    operation: LinearConnectionRefreshOperation<T>,
  ): Promise<T> {
    return this.withAdvisoryLock(
      JSON.stringify(["paseo-connection", "linear", "external", linearOrganizationId]),
      async () => {
        const connection = this.linearConnections.get(linearOrganizationId);
        return operation(connection, async (input) => {
          const current = this.linearConnections.get(linearOrganizationId);
          if (current === undefined) throw new Error("Linear connection unavailable");
          this.linearConnections.set(linearOrganizationId, { ...current, ...input });
        });
      },
    );
  }

  disconnectConnection(
    _provider: ConnectionProvider,
    _connectionId: string,
    _access: ConnectionStartAuthority,
  ) {
    return connectionPersistenceUnavailable();
  }

  findGitHubConnection(_installationId: number): Promise<GitHubConnectionRecord | undefined> {
    return Promise.resolve(this.githubConnections.get(_installationId));
  }

  findDiscordConnection(_guildId: string): Promise<DiscordConnectionRecord | undefined> {
    return Promise.resolve(this.discordConnections.get(_guildId));
  }

  findSlackConnection(_teamId: string): Promise<SlackConnectionRecord | undefined> {
    return Promise.resolve(this.slackConnections.get(_teamId));
  }

  findLinearConnection(_linearOrganizationId: string): Promise<LinearConnectionRecord | undefined> {
    return Promise.resolve(this.linearConnections.get(_linearOrganizationId));
  }

  findSlackConnectionForOrganization(
    organizationId: string,
    teamId: string,
  ): Promise<SlackConnectionRecord | undefined> {
    const connection = this.slackConnections.get(teamId);
    return Promise.resolve(connection?.organizationId === organizationId ? connection : undefined);
  }

  findLinearConnectionForOrganization(
    organizationId: string,
    linearOrganizationId: string,
  ): Promise<LinearConnectionRecord | undefined> {
    const connection = this.linearConnections.get(linearOrganizationId);
    return Promise.resolve(connection?.organizationId === organizationId ? connection : undefined);
  }

  findDiscordConnectionForOrganization(
    organizationId: string,
    guildId: string,
  ): Promise<DiscordConnectionRecord | undefined> {
    const connection = this.discordConnections.get(guildId);
    return Promise.resolve(connection?.organizationId === organizationId ? connection : undefined);
  }

  removeDiscordConnection(): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {}

  private readAttachment(id: string): AttachmentRecord {
    const attachment = this.attachments.get(id);
    if (attachment === undefined) throw new Error(`attachment not found: ${id}`);
    return attachment;
  }

  private async acceptMemoryEvent(
    input:
      | AcceptGitHubEventInput
      | AcceptDiscordEventInput
      | AcceptSlackEventInput
      | AcceptLinearEventInput,
    organizationId: string | undefined,
    connectionId: string | undefined,
    resourceId: string | null,
    reason: string | undefined,
  ): Promise<ProviderEventAcceptance> {
    const receiptId = this.findReceiptId(organizationId, input.deliveryId, input.signatureHash);
    if (receiptId !== undefined) {
      const receipt = this.providerEventReceipts.get(receiptId);
      if (receipt === undefined) throw new Error("provider receipt unavailable");
      if (receipt.droppedReason !== null) {
        return { status: "dropped", receiptId, reason: receipt.droppedReason };
      }
      if (receipt.acceptedRoutes === null) return { status: "duplicate", receiptId };
      return {
        status: "accepted",
        receiptId,
        events: receipt.acceptedRoutes.map((route) => ({
          providerEventReceiptId: receipt.id,
          organizationId: receipt.organizationId,
          projectId: route.projectId,
          configurationRevisionId: route.configurationRevisionId,
          deliveryId: receipt.deliveryId,
          source: receipt.source,
          payload: receipt.payload,
          receivedAt: receipt.receivedAt,
          connectionId: route.connectionId,
          resourceId: route.resourceId,
        })),
      };
    }
    if (organizationId === undefined || connectionId === undefined) {
      return {
        status: "dropped",
        receiptId: input.deliveryId,
        reason: reason ?? "provider_unbound",
      };
    }
    const receipt = this.insertProviderEventReceipt({
      organizationId,
      provider: providerForInput(input),
      connectionId,
      resourceId,
      input,
    });
    if (reason !== undefined) {
      this.providerEventReceipts.set(receipt.id, { ...receipt, droppedReason: reason });
      return {
        status: "dropped",
        receiptId: receipt.id,
        reason,
      };
    }
    const provider = providerForInput(input);
    const routes = Array.from(this.projectTriggerRoutes.entries()).flatMap(
      ([projectId, candidates]) => {
        const project = this.projects.get(projectId);
        return project?.status === "active" && project.activeConfigurationRevisionId !== null
          ? candidates
              .filter(
                (route) =>
                  route.provider === provider &&
                  route.connectionId === connectionId &&
                  (route.resourceId === null || route.resourceId === resourceId),
              )
              .map((route) => Object.assign({}, route, { projectId }))
          : [];
      },
    );
    if (routes.length === 0) {
      this.providerEventReceipts.set(receipt.id, {
        ...receipt,
        droppedReason: "no_project_route",
      });
      return { status: "dropped", receiptId: receipt.id, reason: "no_project_route" };
    }
    const projectRoutes = new Map<string, (typeof routes)[number]>();
    for (const route of routes) {
      if (!projectRoutes.has(route.projectId)) projectRoutes.set(route.projectId, route);
    }

    const events: DurableProviderEvent[] = [...projectRoutes.values()].map((route) => ({
      providerEventReceiptId: receipt.id,
      organizationId,
      projectId: route.projectId,
      configurationRevisionId: this.projects.get(route.projectId)!.activeConfigurationRevisionId!,
      deliveryId: input.deliveryId,
      source: input.source,
      payload: input.payload,
      receivedAt: input.receivedAt,
      connectionId,
      resourceId: route.resourceId,
    }));
    const acceptedRoutes = events.map((event) => ({
      projectId: event.projectId,
      configurationRevisionId: event.configurationRevisionId,
      connectionId: event.connectionId,
      resourceId: event.resourceId,
    }));
    this.providerEventReceipts.set(receipt.id, { ...receipt, acceptedRoutes });
    return { status: "accepted", events, receiptId: receipt.id };
  }

  private findReceiptId(
    organizationId: string | undefined,
    deliveryId: string,
    signatureHash: string | null | undefined,
  ): string | undefined {
    if (organizationId === undefined) return undefined;
    return signatureHash === undefined || signatureHash === null
      ? this.providerEventReceiptIdsByDelivery.get(triggerDeliveryKey(organizationId, deliveryId))
      : (this.providerEventReceiptIdsBySignature.get(signatureHash) ??
          this.providerEventReceiptIdsByDelivery.get(
            triggerDeliveryKey(organizationId, deliveryId),
          ));
  }

  private insertProviderEventReceipt(input: {
    organizationId: string;
    provider: ProviderEventReceiptRecord["provider"];
    connectionId: string | null;
    resourceId: string | null;
    input: {
      deliveryId: string;
      signatureHash?: string | null;
      providerApplicationId?: string | null;
      providerConfigurationVersion?: number | null;
      source: string;
      repo?: string | null;
      payload: unknown;
      receivedAt: Date;
      dropReason?: string;
    };
  }): ProviderEventReceiptRecord {
    const receipt: ProviderEventReceiptRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      provider: input.provider,
      connectionId: input.connectionId,
      resourceId: input.resourceId,
      deliveryId: input.input.deliveryId,
      signatureHash: input.input.signatureHash ?? null,
      providerApplicationId: input.input.providerApplicationId ?? null,
      providerConfigurationVersion: input.input.providerConfigurationVersion ?? null,
      source: input.input.source,
      repo: input.input.repo ?? null,
      payload: input.input.payload,
      receivedAt: input.input.receivedAt,
      droppedReason: input.input.dropReason ?? null,
      acceptedRoutes: null,
    };
    this.providerEventReceipts.set(receipt.id, receipt);
    this.providerEventReceiptIdsByDelivery.set(
      triggerDeliveryKey(receipt.organizationId, receipt.deliveryId),
      receipt.id,
    );
    if (receipt.signatureHash !== null) {
      this.providerEventReceiptIdsBySignature.set(receipt.signatureHash, receipt.id);
    }
    return receipt;
  }

  private readMachine(id: string): MachineRecord {
    const machine = this.machines.get(id);

    if (machine === undefined) {
      throw new Error(`machine not found: ${id}`);
    }

    return machine;
  }

  private readAgentExecution(id: string): AgentExecutionRecord {
    const execution = this.agentExecutions.get(id);

    if (execution === undefined) {
      throw new Error(`agent execution not found: ${id}`);
    }

    return execution;
  }
}

function emptyHubActionAcknowledgements(): AgentExecutionHubAcknowledgements {
  return { terminalAt: null, idleAt: null, finishExecutionCall: null };
}

function connectionPersistenceUnavailable(): never {
  throw new Error("connection persistence requires PostgreSQL");
}

function providerForInput(
  input:
    | AcceptGitHubEventInput
    | AcceptDiscordEventInput
    | AcceptSlackEventInput
    | AcceptLinearEventInput,
): "github" | "discord" | "slack" | "linear" {
  if ("installationId" in input) return "github";
  if ("guildId" in input) return "discord";
  return "teamId" in input ? "slack" : "linear";
}

function githubDropReason(
  input: AcceptGitHubEventInput,
  binding: GitHubConnectionRecord | undefined,
): string | undefined {
  if (input.dropReason !== undefined) return input.dropReason;
  if (binding === undefined) return "github_unbound";
  if (binding.status === "suspended") return "configuration_unavailable";
  return undefined;
}

function discordDropReason(
  input: AcceptDiscordEventInput,
  binding: DiscordConnectionRecord | undefined,
): string | undefined {
  if (input.dropReason !== undefined) return input.dropReason;
  if (binding === undefined) return "discord_unbound";
  return undefined;
}

function slackDropReason(
  input: AcceptSlackEventInput,
  binding: SlackConnectionRecord | undefined,
): string | undefined {
  if (input.dropReason !== undefined) return input.dropReason;
  if (binding === undefined) return "slack_unbound";
  return undefined;
}

function linearDropReason(
  input: AcceptLinearEventInput,
  binding: LinearConnectionRecord | undefined,
): string | undefined {
  if (input.dropReason !== undefined) return input.dropReason;
  if (binding === undefined) return "linear_unbound";
  if (linearConnectionRequiresReauthorization(binding, input.receivedAt)) {
    return "configuration_unavailable";
  }
  return undefined;
}

interface MemoryCliAuthorization extends CliAuthorizationRecord {
  deviceVerifier: string;
  userCodeVerifier: string;
  fingerprintVerifier: string;
  nextPollAt: Date;
  credential: { id: string; prefix: string; verifier: string } | null;
}

function workflowDeadlineKind(
  execution: AgentExecutionRecord | undefined,
  step: WorkflowStepRunRecord,
  run: AcceptedTriggerRunRecord,
  observedAt: Date,
): WorkflowDeadlineKind | undefined {
  if (run.status === "running" && run.deadlineAt <= observedAt) return "whole_run";
  const hardDeadline = execution?.deadlineAt ?? step.deadlineAt;
  const idleDeadline = execution?.idleDeadlineAt ?? step.idleDeadlineAt;
  if (hardDeadline !== null && hardDeadline !== undefined && hardDeadline <= observedAt) {
    if (
      idleDeadline !== null &&
      idleDeadline !== undefined &&
      idleDeadline <= observedAt &&
      idleDeadline < hardDeadline
    ) {
      return "step_idle";
    }
    return "step_hard";
  }
  if (idleDeadline !== null && idleDeadline !== undefined && idleDeadline <= observedAt) {
    return "step_idle";
  }
  return undefined;
}

function capIdleDeadline(
  idleDeadlineAt: Date | null | undefined,
  deadlineAt: Date | null,
): Date | null {
  if (idleDeadlineAt === null || idleDeadlineAt === undefined || deadlineAt === null) {
    return idleDeadlineAt ?? null;
  }
  return new Date(Math.min(idleDeadlineAt.getTime(), deadlineAt.getTime()));
}

function isTerminalAgentExecutionStatus(status: AgentExecutionStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function triggerDeliveryKey(organizationId: string, deliveryId: string): string {
  return `${organizationId}:${deliveryId}`;
}

function freezeEvidence<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeEvidence(child);
  return Object.freeze(value);
}

function attachmentSourceKey(
  providerEventReceiptId: string,
  provider: AttachmentProvider,
  sourceId: string,
): string {
  return `${providerEventReceiptId}:${provider}:${sourceId}`;
}
