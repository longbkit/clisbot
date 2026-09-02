import { isDeepStrictEqual } from "node:util";
import { DatabaseUnavailableError } from "../db/errors.js";
import type {
  AgentExecutionRecord,
  Database,
  DurableProviderEvent,
  MeterReservation,
  MeterReservationDenied,
  AcceptedTriggerRunRecord,
  TriggerRunRecord,
  WorkflowWakeupRecord,
  WorkflowDeadlineRecovery,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import type { AgentExecutionStatus } from "../db/schema.js";
import { parseCompiledHubConfig, type JsonPrimitive, type JsonValue } from "../config/compiler.js";
import {
  toExecutionConfiguration,
  type CompiledExecutionConfiguration,
} from "../configuration/store.js";
import { logger as defaultLogger } from "../logger.js";
import { reportFailure } from "../failures/index.js";
import { durableExecutionId } from "../daemons/lifecycle.js";
import { EntitlementDenied } from "../entitlements/catalog.js";
import { encodeEntitlementDenialFailureReason } from "../entitlements/denial.js";
import type { EntitlementsService } from "../entitlements/service.js";
import {
  buildLaunchMachineIntent,
  type LaunchMachineIntent,
} from "../dispatcher/launch-machine-intent.js";
import type {
  TriggerDispatchOutcome,
  TriggerEventName,
  TriggerHandler,
  TriggerProvider,
  TriggerProviderMatch,
  AcceptedTriggerProviderMatch,
} from "../triggers/index.js";
import type { ProviderEventDropReasonCode } from "../triggers/drop-reason.js";
import { logProviderEventRouting } from "../triggers/audit.js";
import { asTriggerContextValue, isAcceptedTriggerProviderMatch } from "../triggers/index.js";
import {
  ExpressionEvaluationError,
  evaluateExpression,
  expressionPathsInTemplate,
  renderExecutionTemplate,
  renderExpressionTemplate,
  type ExpressionContext,
} from "./expression.js";
import type { WorktreeTarget } from "../config/index.js";
import type { Logger } from "pino";

const DEFAULT_WAKEUP_LEASE_MS = 30_000;
const DEFAULT_WORKER_INTERVAL_MS = 250;

type AcceptedWorkflowRun = Extract<
  Awaited<ReturnType<Database["findTriggerRunById"]>>,
  { outcome: "accepted" }
>;
type WorkflowStepRun = Awaited<ReturnType<Database["listWorkflowStepRunsForTriggerRun"]>>[number];
interface PreparedWorkflowWakeup {
  run: AcceptedWorkflowRun;
  configuration: CompiledExecutionConfiguration;
  trigger: CompiledExecutionConfiguration["triggers"][number];
  steps: WorkflowStepRun[];
  next: WorkflowStepRun;
  step: CompiledExecutionConfiguration["triggers"][number]["steps"][number];
  context: ExpressionContext;
  recoverPreHandoffDispatch: boolean;
}

export interface DurableWorkflowEngineOptions {
  database: Database | null;
  /** Required end to end so the executions meter can never be silently skipped. */
  entitlements: EntitlementsService | null;
  providers?: readonly TriggerProvider[];
  dispatchLaunchMachineIntent?: (intent: LaunchMachineIntent) => Promise<unknown>;
  validateLaunchMachineIntent?: (intent: LaunchMachineIntent) => void;
  configurationRevisionId?: string;
  leaseMs?: number;
  workerIntervalMs?: number;
  now?: () => Date;
  onWorkflowDeadlineExceeded?: (recovery: WorkflowDeadlineRecovery) => Promise<void>;
  onWorkflowRunAccepted?: (run: AcceptedTriggerRunRecord) => Promise<JsonValue | null | void>;
  onWorkflowRunStarted?: (run: AcceptedTriggerRunRecord) => Promise<JsonValue | null | void>;
  onWorkflowRunTerminal?: (run: TriggerRunRecord) => Promise<JsonValue | null | void>;
  logger?: Pick<Logger, "warn" | "error"> & Partial<Pick<Logger, "info">>;
}

export class DurableWorkflowEngine {
  private readonly logger: Pick<Logger, "warn" | "error"> & Partial<Pick<Logger, "info">>;
  private readonly leaseMs: number;
  private readonly workerIntervalMs: number;
  private readonly now: () => Date;
  private workerTimer: NodeJS.Timeout | undefined;
  private processing: Promise<void> | undefined;
  private terminalNotificationProcessing: Promise<void> | undefined;
  private terminalNotificationRecoveryRequested = false;
  private stopped = false;

  constructor(private readonly options: DurableWorkflowEngineOptions) {
    this.logger = options.logger ?? defaultLogger;
    this.leaseMs = options.leaseMs ?? DEFAULT_WAKEUP_LEASE_MS;
    this.workerIntervalMs = options.workerIntervalMs ?? DEFAULT_WORKER_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    this.stopped = false;
    if (this.workerTimer !== undefined) return;
    this.workerTimer = setInterval(() => this.startProcessing(), this.workerIntervalMs);
    this.workerTimer.unref();
    this.startProcessing();
  }

  private startProcessing(): void {
    void this.processAvailable().catch((error: unknown) => {
      this.report(error, "workflow.worker.recover");
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.workerTimer !== undefined) clearInterval(this.workerTimer);
    this.workerTimer = undefined;
    await this.processing;
    await this.terminalNotificationProcessing;
  }

  async enqueue(trigger: DurableProviderEvent): Promise<TriggerDispatchOutcome> {
    if (this.options.database === null) throw new DatabaseUnavailableError();
    const { matches, dropReason } = await collectProviderMatches(
      this.options.providers ?? [],
      trigger,
    );
    if (matches.length === 0) {
      await this.options.database.markProviderEventDropped(
        trigger.providerEventReceiptId,
        dropReason,
      );
      logProviderEventRouting({
        source: trigger.source,
        deliveryId: trigger.deliveryId,
        receiptId: trigger.providerEventReceiptId,
        workflowId: trigger.workflowId,
        triggerNames: [],
        acceptedCount: 0,
        rejectedCount: 0,
        dropReason,
      });
      return { providerEventReceiptId: trigger.providerEventReceiptId };
    }
    const createdAt = this.now();
    await Promise.all(
      matches.map(async (match) => {
        const configurationRevisionId =
          match.configurationRevisionId ?? this.options.configurationRevisionId;
        if (configurationRevisionId === undefined)
          throw new Error("workflow_configuration_revision_required");
        if (match.invocation.status === "rejected") {
          await this.options.database!.createRejectedTriggerRun({
            organizationId: trigger.organizationId,
            workflowId: trigger.workflowId,
            configurationRevisionId,
            providerEventReceiptId: trigger.providerEventReceiptId,
            configuredTriggerName: match.triggerName,
            prompt: match.invocation.prompt,
            inputs: match.invocation.inputs,
            triggerContext: match.triggerContext,
            outputContext: match.outputContext,
            rejection: match.invocation.rejection,
            createdAt,
          });
          return;
        }
        if (!isAcceptedTriggerProviderMatch(match))
          throw new Error("accepted workflow match required");
        const acceptedMatch: AcceptedTriggerProviderMatch = match;
        const configuration = toExecutionConfiguration(
          parseCompiledHubConfig(acceptedMatch.hubConfig),
        );
        const compiledTrigger = configuration.triggers.find(
          (candidate) => candidate.name === acceptedMatch.triggerName,
        );
        if (compiledTrigger === undefined)
          throw new Error(`compiled trigger not found: ${acceptedMatch.triggerName}`);
        const runDeadline = new Date(createdAt.getTime() + compiledTrigger.maxRuntimeMs);
        // Accepting a trigger reserves nothing: a trigger can skip every step, and multi-step
        // workflows create several executions. Metering happens per execution, at creation time
        // (see processWakeup), so the meter is genuinely per-execution and atomic with the work.
        const created = await this.options.database!.createAcceptedTriggerRun({
          organizationId: trigger.organizationId,
          workflowId: trigger.workflowId,
          configurationRevisionId,
          providerEventReceiptId: trigger.providerEventReceiptId,
          configuredTriggerName: acceptedMatch.triggerName,
          prompt: acceptedMatch.invocation.prompt,
          inputs: acceptedMatch.invocation.inputs,
          triggerContext: acceptedMatch.triggerContext,
          outputContext: acceptedMatch.outputContext,
          deadlineAt: runDeadline,
          stepIds: compiledTrigger.steps.map((step) => step.id),
          createdAt,
        });
        if (created.created) await this.deliverWorkflowRunAccepted(created.run);
      }),
    );
    logProviderEventRouting({
      source: trigger.source,
      deliveryId: trigger.deliveryId,
      receiptId: trigger.providerEventReceiptId,
      workflowId: trigger.workflowId,
      triggerNames: matches.map((match) => match.triggerName),
      acceptedCount: matches.filter(isAcceptedTriggerProviderMatch).length,
      rejectedCount: matches.filter((match) => match.invocation.status === "rejected").length,
    });
    return { providerEventReceiptId: trigger.providerEventReceiptId };
  }

  async processAvailable(): Promise<void> {
    if (this.options.database === null || this.stopped) return;
    if (this.processing !== undefined) return this.processing;
    this.processing = this.processAvailableImpl().finally(() => {
      this.processing = undefined;
    });
    return this.processing;
  }

  private async processAvailableImpl(): Promise<void> {
    const database = this.options.database;
    if (database === null) return;
    await this.recoverWorkflowDeadlines(this.now());
    this.kickTerminalNotificationRecovery();
    await database.recoverWorkflowWakeups(this.now());
    while (!this.stopped) {
      const wakeup = await database.claimWorkflowWakeup(this.now(), this.leaseMs);
      if (wakeup === undefined) return;
      try {
        await this.processWakeup(wakeup);
      } catch (error) {
        this.report(error, "workflow.wakeup.process", {
          triggerRunId: wakeup.triggerRunId,
        });
      }
    }
  }

  // eslint-disable-next-line complexity -- one durable state transition owns the atomic handoff.
  private async processWakeup(wakeup: WorkflowWakeupRecord): Promise<void> {
    const database = this.options.database;
    if (database === null) return;
    const prepared = await this.prepareWorkflowWakeup(wakeup);
    if (prepared === undefined) return;
    const { run, configuration, trigger, steps, next, step, context, recoverPreHandoffDispatch } =
      prepared;
    if (await this.deferChannelRunBehindEarlierReceipt(run)) return;
    let shouldRun = true;
    try {
      shouldRun =
        step.condition === undefined || truthy(evaluateExpression(step.condition, context));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "workflow_condition_evaluation_failed";
      this.report(error, "workflow.condition.evaluate", {
        triggerRunId: run.id,
        stepId: step.id,
      });
      const failed = await database.failWorkflowRun(run.id, "failed", reason, step.id);
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return;
    }
    try {
      const composedValues = composeValuesIfAvailable(trigger.values, context);
      if (composedValues !== undefined) {
        await database.updateTriggerRunValues(run.id, composedValues);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "workflow_value_evaluation_failed";
      this.report(error, "workflow.values.evaluate", {
        triggerRunId: run.id,
        stepId: step.id,
      });
      const failed = await database.failWorkflowRun(run.id, "failed", reason, step.id);
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return;
    }
    if (!shouldRun) {
      await database.markWorkflowStepSkipped(run.id, step.id, "condition_false");
      return;
    }
    const startedAt = this.now();
    const deadlineAt = new Date(
      Math.min(run.deadlineAt.getTime(), startedAt.getTime() + step.maxRuntimeMs),
    );
    const idleDeadlineAt = new Date(
      Math.min(
        run.deadlineAt.getTime(),
        deadlineAt.getTime(),
        startedAt.getTime() + step.idleTimeoutMs,
      ),
    );
    const preparedIntent = await this.buildMaterializedStepIntentOrFail(
      configuration,
      trigger,
      step,
      run,
      context,
      next.id,
      deadlineAt,
    );
    if (preparedIntent === undefined) return;
    const { executionId, intent: baseIntent } = preparedIntent;
    const reuse = await this.resolveStepReuseAgent(step, run, steps, baseIntent);
    if (step.reuse !== undefined) {
      this.logger.info?.(
        {
          workflowRunId: run.id,
          stepId: step.id,
          reuse: step.reuse,
          result: reuse.reason,
          ...(reuse.agentId === undefined ? {} : { agentId: reuse.agentId }),
        },
        "workflow Agent reuse resolved",
      );
    }
    if (reuse.pending) {
      await database.deferWorkflowWakeup(
        run.id,
        new Date(this.now().getTime() + this.workerIntervalMs),
      );
      return;
    }
    const intent: LaunchMachineIntent =
      reuse.agentId === undefined ? baseIntent : { ...baseIntent, reuseAgentId: reuse.agentId };
    if (await this.failInvalidLaunchIntent(database, run, step, intent)) return;
    const reservation = await this.reserveExecution(run.organizationId);
    const created = await database.createWorkflowStepExecution({
      triggerRunId: run.id,
      stepId: step.id,
      ordinal: next.ordinal,
      executionId,
      execution: {
        id: executionId,
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        machineId: null,
        daemonId: null,
        triggerContext: run.triggerContext,
        outputContext: run.outputContext,
        configurationRevisionId: run.configurationRevisionId,
        deadlineAt,
        idleDeadlineAt,
        startedAt,
        workflowStepRunId: next.id,
        launchIntent: intent,
      },
      reservation,
    });
    if (await this.failDeniedReservation(database, run, step, created.reservationDenied)) return;
    if (created.execution === undefined) {
      await database.deleteWorkflowWakeup(run.id);
      return;
    }
    await this.linkWorkflowStepAndNotifyStart(
      database,
      run.id,
      steps,
      next.id,
      created.execution.id,
      intent,
    );
    if (!created.created) {
      await this.handleExistingWorkflowExecution(
        created.execution,
        next.id,
        recoverPreHandoffDispatch,
      );
      await database.deleteWorkflowWakeup(run.id);
      return;
    }
    const result = await this.dispatch(intent);
    const execution = await this.executionFromResult(result, intent, next.id);
    if (execution.id !== created.execution.id) {
      throw new Error(`durable dispatch returned a different execution: ${execution.id}`);
    }
    await this.finishPersistedExecution(execution);
    await database.deleteWorkflowWakeup(run.id);
  }

  private async deferChannelRunBehindEarlierReceipt(run: AcceptedWorkflowRun): Promise<boolean> {
    const database = this.options.database;
    const bindingKey = channelBindingKey(run.outputContext);
    if (database === null || bindingKey === undefined) return false;
    const blocked = await database.hasEarlierRunningChannelWorkflow({
      organizationId: run.organizationId,
      triggerRunId: run.id,
      bindingKey,
    });
    if (!blocked) return false;
    await database.deferWorkflowWakeup(
      run.id,
      new Date(this.now().getTime() + this.workerIntervalMs),
    );
    return true;
  }

  private async resolveStepReuseAgent(
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    run: AcceptedWorkflowRun,
    steps: readonly WorkflowStepRun[],
    intent: LaunchMachineIntent,
  ): Promise<{ agentId?: string; pending: boolean; reason: string }> {
    if (step.reuse === undefined) return { pending: false, reason: "disabled" };
    if (step.reuse === "binding") {
      const bindingKey = channelBindingKey(run.outputContext);
      if (bindingKey === undefined || this.options.database === null) {
        return { pending: false, reason: "binding_unavailable" };
      }
      const candidate = await this.options.database.findWorkflowAgentReuseBinding({
        organizationId: run.organizationId,
        bindingKey,
        workflowName: run.configuredTriggerName,
        stepId: step.id,
      });
      return reusableAgent(candidate, intent);
    }
    const sourceStepId = step.reuse.slice("steps.".length);
    const source = steps.find((candidate) => candidate.stepId === sourceStepId);
    if (source?.agentExecutionId === null || source?.agentExecutionId === undefined)
      return { pending: false, reason: "source_unlinked" };
    const execution = await this.options.database?.findAgentExecutionById(source.agentExecutionId);
    return reusableAgent(execution, intent);
  }

  private async linkWorkflowStepAndNotifyStart(
    database: Database,
    triggerRunId: string,
    steps: readonly WorkflowStepRun[],
    stepRunId: string,
    executionId: string,
    intent: LaunchMachineIntent,
  ): Promise<void> {
    await database.linkWorkflowStepRunExecution(stepRunId, executionId, intent);
    if (steps.some((candidate) => candidate.startedAt !== null)) return;
    const started = await database.findTriggerRunById(triggerRunId);
    if (started?.outcome === "accepted") await this.deliverWorkflowRunStarted(started);
  }

  /**
   * Fail the run when execution creation was denied by the meter. The denial is the same typed
   * `EntitlementDenied` every other boundary produces, so a metered failure stays distinct from
   * a crash on the run's failure reason. Returns true when it handled a denial.
   */
  private async failDeniedReservation(
    database: Database,
    run: AcceptedWorkflowRun,
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    denied: MeterReservationDenied | undefined,
  ): Promise<boolean> {
    if (denied === undefined) return false;
    const error = new EntitlementDenied(
      "executions.monthly",
      "meter",
      denied.limit,
      denied.current,
    );
    // Store the machine-parseable denial, not the human message: the run UI decodes this back
    // into a typed payload rather than pattern-matching a sentence. See src/entitlements/denial.ts.
    const failureReason = encodeEntitlementDenialFailureReason(error.payload());
    const failed = await database.failWorkflowRun(run.id, "failed", failureReason, step.id);
    if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
    await database.deleteWorkflowWakeup(run.id);
    return true;
  }

  /**
   * The meter reservation to attach to the next execution creation. Entitlements is required
   * whenever a database is wired, so a null here is a composition bug, not a skipped meter.
   */
  private async reserveExecution(organizationId: string): Promise<MeterReservation> {
    const entitlements = this.options.entitlements;
    if (entitlements === null) {
      throw new Error("durable workflow engine requires entitlements when a database is wired");
    }
    return entitlements.meterReservation(organizationId, "executions.monthly");
  }

  private async handleExistingWorkflowExecution(
    execution: AgentExecutionRecord,
    stepRunId: string,
    recoverPreHandoffDispatch: boolean,
  ): Promise<void> {
    if (!recoverPreHandoffDispatch || !isRecoverablePreHandoffExecution(execution)) {
      await this.finishPersistedExecution(execution);
      return;
    }
    const persistedIntent = execution.launchIntent;
    if (persistedIntent === null) {
      throw new Error(`workflow execution missing persisted launch intent: ${execution.id}`);
    }
    const result = await this.dispatch(persistedIntent);
    const recovered = await this.executionFromResult(result, persistedIntent, stepRunId);
    if (recovered.id !== execution.id) {
      throw new Error(`durable dispatch returned a different execution: ${recovered.id}`);
    }
    await this.finishPersistedExecution(recovered);
  }

  private async prepareWorkflowWakeup(
    wakeup: WorkflowWakeupRecord,
  ): Promise<PreparedWorkflowWakeup | undefined> {
    const database = this.options.database;
    if (database === null) return undefined;
    const triggerRunId = wakeup.triggerRunId;
    const run = await database.findTriggerRunById(triggerRunId);
    if (run === undefined || run.status !== "running" || run.outcome !== "accepted") {
      await database.deleteWorkflowWakeup(triggerRunId);
      return undefined;
    }
    if (run.deadlineAt <= this.now()) {
      await this.recoverWorkflowDeadlines(this.now());
      await database.deleteWorkflowWakeup(triggerRunId);
      return undefined;
    }
    const configuration = await this.configurationForRun(run);
    const trigger = configuration.triggers.find(
      (candidate) => candidate.name === run.configuredTriggerName,
    );
    if (trigger === undefined)
      throw new Error(`workflow trigger not found: ${run.configuredTriggerName}`);
    let steps = await database.listWorkflowStepRunsForTriggerRun(run.id);
    if (steps.length !== trigger.steps.length)
      throw new Error(`workflow steps missing for ${run.id}`);

    const recoveredTerminalRun = await this.reconcileTerminalStepExecutions(steps);
    if (recoveredTerminalRun !== undefined) {
      await this.notifyWorkflowRunTerminal(recoveredTerminalRun);
    }
    await this.persistBindingReuseAgents(run, trigger, steps);
    const reconciledRun = await database.findTriggerRunById(run.id);
    if (reconciledRun === undefined || reconciledRun.status !== "running") {
      await database.deleteWorkflowWakeup(run.id);
      return undefined;
    }
    steps = await database.listWorkflowStepRunsForTriggerRun(run.id);
    if (await this.failTerminalWorkflowStep(run.id, steps)) return undefined;
    const liveExecution = await this.findLiveExecution(steps);
    if (liveExecution !== undefined) {
      await database.deleteWorkflowWakeup(run.id);
      return undefined;
    }
    const recoverPreHandoffDispatch = wakeup.leasedBeforeClaim;
    const next =
      (recoverPreHandoffDispatch ? await this.findRecoverablePreHandoffStep(steps) : undefined) ??
      steps.find((candidate) => candidate.status === "pending");
    if (next === undefined) {
      await this.finishWorkflowRunIfComplete(reconciledRun, steps, trigger);
      return undefined;
    }
    const step = trigger.steps[next.ordinal];
    if (step === undefined) throw new Error(`compiled step missing for ${next.stepId}`);
    return {
      run: reconciledRun,
      configuration,
      trigger,
      steps,
      next,
      step,
      context: workflowContext(reconciledRun, steps, trigger.values),
      recoverPreHandoffDispatch,
    };
  }

  private async persistBindingReuseAgents(
    run: AcceptedWorkflowRun,
    trigger: CompiledExecutionConfiguration["triggers"][number],
    steps: readonly WorkflowStepRun[],
  ): Promise<void> {
    const database = this.options.database;
    const bindingKey = channelBindingKey(run.outputContext);
    if (database === null || bindingKey === undefined) return;
    for (const step of steps) {
      const compiled = trigger.steps[step.ordinal];
      if (compiled?.reuse !== "binding" || step.agentExecutionId === null) continue;
      const execution = await database.findAgentExecutionById(step.agentExecutionId);
      if (execution?.daemonAgentId === null || execution?.daemonAgentId === undefined) continue;
      await database.upsertWorkflowAgentReuseBinding({
        organizationId: run.organizationId,
        bindingKey,
        workflowName: run.configuredTriggerName,
        stepId: step.stepId,
        agentExecutionId: execution.id,
      });
    }
  }

  private async buildStepIntentOrFail(
    configuration: CompiledExecutionConfiguration,
    trigger: CompiledExecutionConfiguration["triggers"][number],
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    run: AcceptedWorkflowRun,
    context: ExpressionContext,
    stepRunId: string,
    deadlineAt: Date,
    executionId: string,
  ): Promise<LaunchMachineIntent | undefined> {
    const database = this.options.database;
    if (database === null) return undefined;
    try {
      return buildStepIntent(
        configuration,
        trigger,
        step,
        run,
        context,
        stepRunId,
        deadlineAt,
        executionId,
      );
    } catch (error) {
      if (!(error instanceof ExpressionEvaluationError)) throw error;
      this.report(error, "workflow.launch-expression.evaluate", {
        triggerRunId: run.id,
        stepId: step.id,
      });
      const failed = await database.failWorkflowRun(run.id, "failed", error.message, step.id);
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return undefined;
    }
  }

  private async materializeStepContextOrFail(
    run: AcceptedWorkflowRun,
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    executionId: string,
  ): Promise<JsonValue | undefined> {
    if (!stepUsesTriggerContext(step)) return null;
    const provider = providerForTriggerContext(this.options.providers ?? [], run.triggerContext);
    if (provider?.materializeContext === undefined) {
      const failed = await this.options.database!.failWorkflowRun(
        run.id,
        "failed",
        "trigger_context_materializer_unavailable",
        step.id,
      );
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return undefined;
    }
    try {
      return asTriggerContextValue(
        await provider.materializeContext({
          executionId,
          organizationId: run.organizationId,
          workflowId: run.workflowId,
          providerEventReceiptId: run.providerEventReceiptId,
          triggerContext: run.triggerContext,
        }),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "trigger_context_unavailable";
      this.report(error, "workflow.context.materialize", {
        triggerRunId: run.id,
        stepId: step.id,
        executionId,
      });
      const failed = await this.options.database!.failWorkflowRun(
        run.id,
        "failed",
        reason,
        step.id,
      );
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return undefined;
    }
  }

  private async buildMaterializedStepIntentOrFail(
    configuration: CompiledExecutionConfiguration,
    trigger: CompiledExecutionConfiguration["triggers"][number],
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    run: AcceptedWorkflowRun,
    context: ExpressionContext,
    stepRunId: string,
    deadlineAt: Date,
  ): Promise<{ executionId: string; intent: LaunchMachineIntent } | undefined> {
    const existing = await this.options.database?.findAgentExecutionByWorkflowStepRunId(stepRunId);
    if (existing?.launchIntent !== null && existing?.launchIntent !== undefined) {
      return { executionId: existing.id, intent: existing.launchIntent };
    }
    const executionId = durableExecutionId({
      triggerRunId: run.id,
      configurationRevisionId: run.configurationRevisionId,
      triggerName: run.configuredTriggerName,
      workflowStepRunId: stepRunId,
    });
    const materializedContext = await this.materializeStepContextOrFail(run, step, executionId);
    if (materializedContext === undefined) return undefined;
    const intent = await this.buildStepIntentOrFail(
      configuration,
      trigger,
      step,
      run,
      { ...context, context: materializedContext },
      stepRunId,
      deadlineAt,
      executionId,
    );
    if (intent === undefined) return undefined;
    if (durableExecutionId(intent) !== executionId) {
      throw new Error("workflow execution identity changed during context materialization");
    }
    return { executionId, intent };
  }

  private async failInvalidLaunchIntent(
    database: Database,
    run: AcceptedWorkflowRun,
    step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
    intent: LaunchMachineIntent,
  ): Promise<boolean> {
    try {
      this.options.validateLaunchMachineIntent?.(intent);
      return false;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "required output capability unavailable";
      this.report(error, "workflow.launch-intent.validate", {
        triggerRunId: run.id,
        stepId: step.id,
      });
      const failed = await database.failWorkflowRun(run.id, "failed", reason, step.id);
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return true;
    }
  }

  private async finishWorkflowRunIfComplete(
    run: AcceptedWorkflowRun,
    steps: readonly WorkflowStepRun[],
    trigger: CompiledExecutionConfiguration["triggers"][number],
  ): Promise<void> {
    const database = this.options.database;
    if (database === null) return;
    try {
      await database.updateTriggerRunValues(
        run.id,
        composeValues(trigger.values, workflowContext(run, steps, trigger.values)),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "workflow_value_evaluation_failed";
      this.report(error, "workflow.final-values.evaluate", {
        triggerRunId: run.id,
      });
      const failed = await database.failWorkflowRun(run.id, "failed", reason);
      if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
      return;
    }
    const succeeded = await database.succeedTriggerRun(run.id);
    if (succeeded?.transitioned === true) await this.notifyWorkflowRunTerminal(succeeded.run);
  }

  private async recoverWorkflowDeadlines(now: Date): Promise<void> {
    const database = this.options.database;
    if (database === null) return;
    for (const recovery of await database.recoverWorkflowDeadlines(now)) {
      if (this.options.onWorkflowDeadlineExceeded !== undefined) {
        await this.options.onWorkflowDeadlineExceeded(recovery);
      }
      const run = await database.findTriggerRunById(recovery.triggerRunId);
      if (run?.outcome === "accepted" && run.status !== "running") {
        await this.notifyWorkflowRunTerminal(run);
      }
    }
  }

  private notifyWorkflowRunTerminal(run: TriggerRunRecord): Promise<void> {
    if (run.outcome !== "accepted" || run.status === "running") return Promise.resolve();
    this.kickTerminalNotificationRecovery();
    return Promise.resolve();
  }

  private async deliverWorkflowRunAccepted(run: AcceptedTriggerRunRecord): Promise<void> {
    const callback = this.options.onWorkflowRunAccepted;
    if (callback === undefined || this.options.database === null) return;
    try {
      const result = await callback(run);
      await this.options.database.setWorkflowRunReactionState(
        run.id,
        result === undefined ? run.reactionState : result,
      );
    } catch (error: unknown) {
      this.report(error, "workflow.reaction.accepted", {
        triggerRunId: run.id,
      });
    }
  }

  private async deliverWorkflowRunStarted(run: AcceptedTriggerRunRecord): Promise<void> {
    const callback = this.options.onWorkflowRunStarted;
    if (callback === undefined || this.options.database === null) return;
    try {
      const result = await callback(run);
      await this.options.database.setWorkflowRunReactionState(
        run.id,
        result === undefined ? run.reactionState : result,
      );
    } catch (error: unknown) {
      this.report(error, "workflow.reaction.started", { triggerRunId: run.id });
    }
  }

  private kickTerminalNotificationRecovery(): void {
    if (this.options.database === null || this.stopped) return;
    this.terminalNotificationRecoveryRequested = true;
    if (this.terminalNotificationProcessing !== undefined) return;
    this.terminalNotificationProcessing = this.recoverRequestedWorkflowRunTerminalNotifications()
      .catch((error: unknown) => {
        this.report(error, "workflow.notification.terminal.recover");
      })
      .finally(() => {
        this.terminalNotificationProcessing = undefined;
        if (this.terminalNotificationRecoveryRequested) {
          this.kickTerminalNotificationRecovery();
        }
      });
  }

  private async recoverRequestedWorkflowRunTerminalNotifications(): Promise<void> {
    do {
      this.terminalNotificationRecoveryRequested = false;
      await this.recoverPendingWorkflowRunTerminalNotifications();
    } while (this.terminalNotificationRecoveryRequested && !this.stopped);
  }

  private async recoverPendingWorkflowRunTerminalNotifications(): Promise<void> {
    const database = this.options.database;
    if (database === null) return;
    while (!this.stopped) {
      const run = await database.claimPendingWorkflowRunTerminalNotification(
        this.now(),
        this.leaseMs,
      );
      if (run === undefined) return;
      try {
        const reactionState = await this.options.onWorkflowRunTerminal?.(run);
        const deliveredReactionState =
          reactionState === undefined ? terminalReactionState(run) : reactionState;
        await database.markWorkflowRunTerminalNotificationDelivered(
          run.id,
          this.now(),
          deliveredReactionState,
        );
      } catch (error) {
        this.report(error, "workflow.notification.terminal.deliver", {
          triggerRunId: run.id,
        });
      }
    }
  }

  private async finishPersistedExecution(
    execution: Pick<AgentExecutionRecord, "id" | "status" | "result">,
  ): Promise<void> {
    if (execution.status !== "succeeded" && execution.status !== "failed") return;
    const database = this.options.database;
    if (database === null) return;
    await database.completeWorkflowStep(
      execution.id,
      execution.status,
      execution.result,
      execution.status === "failed" ? readFailureReason(execution.result) : undefined,
    );
  }

  private report(error: unknown, operation: string, diagnostic?: Record<string, unknown>): void {
    reportFailure(
      error,
      { operation, component: "workflows" },
      {
        logger: this.logger,
        ...(diagnostic === undefined ? {} : { diagnostic }),
      },
    );
  }

  private async findLiveExecution(
    steps: readonly { status: string; agentExecutionId: string | null }[],
  ): Promise<AgentExecutionRecord | undefined> {
    const database = this.options.database;
    if (database === null) return undefined;
    for (const step of steps) {
      if (step.status !== "running" || step.agentExecutionId === null) continue;
      const execution = await database.findAgentExecutionById(step.agentExecutionId);
      if (
        execution !== undefined &&
        (execution.status === "spawning" || execution.status === "running")
      ) {
        if (isRecoverablePreHandoffExecution(execution)) continue;
        return execution;
      }
    }
    return undefined;
  }

  private async findRecoverablePreHandoffStep(
    steps: readonly WorkflowStepRun[],
  ): Promise<WorkflowStepRun | undefined> {
    const database = this.options.database;
    if (database === null) return undefined;
    for (const step of steps) {
      if (step.status !== "running" || step.agentExecutionId === null) continue;
      const execution = await database.findAgentExecutionById(step.agentExecutionId);
      if (execution !== undefined && isRecoverablePreHandoffExecution(execution)) return step;
    }
    return undefined;
  }

  private async reconcileTerminalStepExecutions(
    steps: readonly { status: string; agentExecutionId: string | null }[],
  ): Promise<TriggerRunRecord | undefined> {
    const database = this.options.database;
    if (database === null) return undefined;
    for (const step of steps) {
      if (step.status !== "running" || step.agentExecutionId === null) continue;
      const execution = await database.findAgentExecutionById(step.agentExecutionId);
      if (
        execution === undefined ||
        (execution.status !== "succeeded" && execution.status !== "failed")
      ) {
        continue;
      }
      const completed = await database.completeWorkflowStep(
        execution.id,
        execution.status === "succeeded" ? "succeeded" : "failed",
        execution.result,
        readFailureReason(execution.result),
      );
      if (completed !== undefined && completed.run.status !== "running") return completed.run;
    }
    return undefined;
  }

  private async failTerminalWorkflowStep(
    triggerRunId: string,
    steps: readonly WorkflowStepRun[],
  ): Promise<boolean> {
    const database = this.options.database;
    if (database === null) return false;
    const terminalFailure = steps.find(
      (candidate) => candidate.status === "failed" || candidate.status === "timed_out",
    );
    if (terminalFailure === undefined) return false;
    const status = terminalFailure.status === "timed_out" ? "timed_out" : "failed";
    const failed = await database.failWorkflowRun(
      triggerRunId,
      status,
      terminalFailure.failureReason ?? `workflow_step_${status}`,
      terminalFailure.stepId,
    );
    if (failed?.transitioned === true) await this.notifyWorkflowRunTerminal(failed.run);
    return true;
  }

  private async configurationForRun(
    run: AcceptedWorkflowRun,
  ): Promise<CompiledExecutionConfiguration> {
    const database = this.options.database;
    if (database === null) throw new DatabaseUnavailableError();
    const revision: OrganizationTriggerRevisionRecord | undefined =
      await database.findOrganizationTriggerRevision(run.workflowId, run.configurationRevisionId);
    if (revision === undefined)
      throw new Error(`workflow configuration revision not found: ${run.configurationRevisionId}`);
    return toExecutionConfiguration(parseCompiledHubConfig(revision.normalizedConfiguration));
  }

  private async dispatch(intent: LaunchMachineIntent): Promise<unknown> {
    if (this.options.dispatchLaunchMachineIntent !== undefined)
      return this.options.dispatchLaunchMachineIntent(intent);
    throw new Error("no durable workflow dispatch handler registered");
  }

  private async executionFromResult(
    result: unknown,
    intent: LaunchMachineIntent,
    stepRunId: string,
  ): Promise<Pick<AgentExecutionRecord, "id" | "status" | "result">> {
    const candidate = readDispatchExecution(result);
    if (candidate !== undefined) return candidate;
    const database = this.options.database;
    const existing =
      database === null
        ? undefined
        : await database.findAgentExecutionByWorkflowStepRunId(stepRunId);
    if (existing !== undefined) return existing;
    throw new Error(`durable dispatch returned no execution: ${durableExecutionId(intent)}`);
  }
}

function buildStepIntent(
  configuration: CompiledExecutionConfiguration,
  trigger: CompiledExecutionConfiguration["triggers"][number],
  step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
  run: Extract<Awaited<ReturnType<Database["findTriggerRunById"]>>, { outcome: "accepted" }>,
  context: ExpressionContext,
  stepRunId: string,
  deadlineAt: Date,
  executionId: string,
): LaunchMachineIntent {
  const environmentName = authorityString(
    renderExpressionTemplate(step.environment, context),
    "environment",
  );
  const environment = configuration.environments.find(
    (candidate) => candidate.name === environmentName,
  );
  if (
    environment === undefined ||
    environment.kind !== "daemon" ||
    environment.daemonId === undefined
  ) {
    throw new Error(`workflow environment ${environmentName} is unavailable`);
  }
  const agent = materializeAgent(step.agent, context);
  return {
    ...buildLaunchMachineIntent({
      organizationId: run.organizationId,
      workflowId: run.workflowId,
      triggerRunId: run.id,
      triggerName: run.configuredTriggerName,
      environmentName,
      environment: {
        kind: "daemon",
        daemonId: environment.daemonId,
        authoredSlug: environment.daemon,
        cwd: environment.cwd,
        ...(environment.worktree === undefined
          ? {}
          : {
              worktree: materializeExecutionWorktree(environment.worktree, executionId),
            }),
      },
      ...(step.env === undefined ? {} : { env: step.env }),
      ...(step.github === undefined ? {} : { github: step.github }),
      prompt: step.prompt
        .map((block) =>
          renderExpressionTemplate(block.kind === "text" ? block.value : block.content, context),
        )
        .join("\n"),
      agent,
      allowOutputs: step.allowOutputs,
      ...(step.reuse === undefined ? {} : { reuse: step.reuse }),
      timeoutMs: step.maxRuntimeMs,
      idleTimeoutMs: step.idleTimeoutMs,
      autoArchive: step.autoArchive,
      triggerContext: run.triggerContext,
      outputContext: run.outputContext,
      configurationRevisionId: run.configurationRevisionId,
      hubConfig: configuration,
    }),
    workflowStepRunId: stepRunId,
    ...(step.output === undefined ? {} : { outputSchema: step.output.schema }),
    deadlineAt,
  };
}

function materializeAgent(
  selection: CompiledExecutionConfiguration["triggers"][number]["steps"][number]["agent"],
  context: ExpressionContext,
) {
  const agent =
    "selector" in selection
      ? selection.choices[
          authorityString(renderExpressionTemplate(selection.selector, context), "agent")
        ]
      : selection;
  if (agent === undefined) throw new Error("workflow named agent is unavailable");
  return {
    ...agent,
    ...(agent.options === undefined ? {} : { options: structuredClone(agent.options) }),
  };
}

function workflowContext(
  run: Extract<Awaited<ReturnType<Database["findTriggerRunById"]>>, { outcome: "accepted" }>,
  steps: readonly { stepId: string; status: string; output: unknown }[],
  values: Readonly<Record<string, import("./expression.js").Expression>>,
): ExpressionContext {
  return {
    prompt: run.prompt,
    context: null,
    inputs: inputContext(run.inputs),
    steps: Object.fromEntries(
      steps.map((step) => [step.stepId, { status: step.status, output: step.output }]),
    ),
    values,
  };
}

function stepUsesTriggerContext(
  step: CompiledExecutionConfiguration["triggers"][number]["steps"][number],
): boolean {
  return step.prompt.some((block) =>
    expressionPathsInTemplate(block.kind === "text" ? block.value : block.content).some(
      (path) => path.namespace === "paseo" && path.path === "context",
    ),
  );
}

function providerForTriggerContext(
  providers: readonly TriggerProvider[],
  triggerContext: unknown,
): TriggerProvider | undefined {
  if (typeof triggerContext !== "object" || triggerContext === null) return undefined;
  if (!("provider" in triggerContext) || typeof triggerContext.provider !== "string") {
    return undefined;
  }
  return providers.find((provider) => provider.name === triggerContext.provider);
}

function composeValues(
  values: Readonly<Record<string, import("./expression.js").Expression>>,
  context: ExpressionContext,
): Readonly<Record<string, JsonValue>> {
  return Object.fromEntries(
    Object.entries(values).map(([name, expression]) => [
      name,
      evaluateExpression(expression, context),
    ]),
  );
}

function composeValuesIfAvailable(
  values: Readonly<Record<string, import("./expression.js").Expression>>,
  context: ExpressionContext,
): Readonly<Record<string, JsonValue>> | undefined {
  try {
    return composeValues(values, context);
  } catch (error) {
    if (error instanceof ExpressionEvaluationError) return undefined;
    throw error;
  }
}

function isRecoverablePreHandoffExecution(execution: AgentExecutionRecord): boolean {
  return (
    execution.status === "spawning" &&
    execution.launchIntent !== null &&
    execution.machineId === null &&
    execution.daemonId === null &&
    execution.daemonAgentId === null
  );
}

function channelBindingKey(outputContext: unknown): string | undefined {
  if (!isRecord(outputContext)) return undefined;
  const channel = outputContext["channel"];
  if (!isRecord(channel) || typeof channel["binding_key"] !== "string") return undefined;
  return channel["binding_key"];
}

function reusableAgent(
  execution: AgentExecutionRecord | undefined,
  intent: LaunchMachineIntent,
): { agentId?: string; pending: boolean; reason: string } {
  if (execution === undefined) return { pending: false, reason: "execution_missing" };
  // A worktree target is materialized per execution. Reusing its Agent would
  // either ask the daemon to create a second workspace for an existing
  // session (which it correctly rejects), or silently run in the old
  // workspace. Treat it as an incompatible environment and create anew.
  if (intent.environment.worktree !== undefined) {
    return { pending: false, reason: "incompatible_environment" };
  }
  const previous = execution.launchIntent;
  if (
    previous === null ||
    !isDeepStrictEqual(reuseCompatibilityValue(previous), reuseCompatibilityValue(intent))
  ) {
    return { pending: false, reason: "incompatible" };
  }
  if (
    execution.daemonAgentId === null ||
    (execution.hubAction !== null && execution.hubActionCompletedAt === null) ||
    (execution.completedByAgentAt !== null &&
      (execution.hubActionAcknowledgements.terminalAt === null ||
        execution.hubActionAcknowledgements.idleAt === null))
  ) {
    return { pending: true, reason: "pending_acknowledgement" };
  }
  return {
    agentId: execution.daemonAgentId,
    pending: false,
    reason: "resolved",
  };
}

function reuseCompatibilityValue(intent: LaunchMachineIntent) {
  return {
    environment: intent.environment,
    environmentName: intent.environmentName,
    agent: intent.agent,
    env: intent.env ?? null,
    authority: {
      github: intent.github ?? null,
      allowOutputs: intent.allowOutputs,
      channel: channelReplyAuthority(intent.outputContext),
    },
  };
}

function channelReplyAuthority(outputContext: unknown): unknown {
  if (!isRecord(outputContext)) return null;
  const channel = outputContext["channel"];
  if (!isRecord(channel)) return null;
  const route = channel["route"];
  return {
    name: channel["name"] ?? null,
    accountId: channel["account_id"] ?? null,
    conversationId: channel["external_conversation_id"] ?? null,
    threadId: channel["external_thread_id"] ?? null,
    bindingKey: channel["binding_key"] ?? null,
    defaults: isRecord(route) ? (route["defaults"] ?? null) : null,
  };
}

function authorityString(value: string, field: string): string {
  if (value.length === 0) throw new Error(`${field} resolved to an empty authority`);
  return value;
}

function materializeExecutionWorktree(worktree: WorktreeTarget, executionId: string) {
  if (worktree.mode !== "branch-off") return worktree;
  return {
    ...worktree,
    newBranch: renderExecutionTemplate(worktree.newBranch, executionId),
  };
}

function inputContext(value: unknown): Readonly<Record<string, JsonPrimitive>> {
  if (!isRecord(value)) return {};
  const inputs: Record<string, JsonPrimitive> = {};
  for (const [name, input] of Object.entries(value)) {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      inputs[name] = input;
    }
  }
  return inputs;
}

function truthy(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined && value !== 0 && value !== "";
}

function terminalReactionState(run: TriggerRunRecord): JsonValue | null {
  if (run.outcome === "accepted") return run.reactionState;
  return null;
}

async function collectProviderMatches(
  providers: readonly TriggerProvider[],
  trigger: DurableProviderEvent,
): Promise<{
  matches: readonly TriggerProviderMatch[];
  dropReason: ProviderEventDropReasonCode;
}> {
  if (!isTriggerEventName(trigger.source))
    return { matches: [], dropReason: "no_trigger_for_source" };
  const matchingProviders = providers.filter((provider) =>
    provider.eventNames.some((name) => name === trigger.source),
  );
  const results = await Promise.all(matchingProviders.map((provider) => provider.match(trigger)));
  const matches = results.flatMap((result) => (typeof result === "string" ? [] : result));
  const reasons = results.filter(
    (result): result is ProviderEventDropReasonCode => typeof result === "string",
  );
  return {
    matches,
    dropReason:
      reasons.find((reason) => reason === "configuration_unavailable") ??
      reasons.find((reason) => reason === "trigger_filters_rejected") ??
      "no_trigger_for_source",
  };
}

function readDispatchExecution(
  result: unknown,
): Pick<AgentExecutionRecord, "id" | "status" | "result"> | undefined {
  if (!isRecord(result)) return undefined;
  const direct = readExecutionCandidate(result["execution"]);
  if (direct !== undefined) return direct;
  const executions = result["executions"];
  if (!Array.isArray(executions)) return undefined;
  return readExecutionCandidate(executions[0]);
}

function readExecutionCandidate(
  value: unknown,
): Pick<AgentExecutionRecord, "id" | "status" | "result"> | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string") return undefined;
  return {
    id: value["id"],
    status: readExecutionStatus(value["status"]),
    result: value["result"],
  };
}

function readExecutionStatus(value: unknown): AgentExecutionStatus {
  return value === "running" || value === "succeeded" || value === "failed" ? value : "spawning";
}

function readFailureReason(result: unknown): string | undefined {
  return isRecord(result) && typeof result["reason"] === "string" ? result["reason"] : undefined;
}

function isTriggerEventName(value: string): value is TriggerEventName {
  return /^[^.]+\.[^.]+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createDurableWorkflowHandler(options: DurableWorkflowEngineOptions): {
  handler: TriggerHandler;
  engine: DurableWorkflowEngine;
} {
  const engine = new DurableWorkflowEngine(options);
  return { handler: (trigger) => engine.enqueue(trigger), engine };
}
