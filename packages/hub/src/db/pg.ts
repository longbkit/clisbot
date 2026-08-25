import { randomUUID } from "node:crypto";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import type { JsonValue } from "../config/compiler.js";
import { parseInvocationInputs, parseInvocationRejection } from "../triggers/invocation.js";
import type { ProviderEventDropReasonCode } from "../triggers/drop-reason.js";
import {
  clearOverrideKey,
  entitlementOverridesSchema,
  mergeOverrides,
} from "../entitlements/catalog.js";
import { toDatabaseError } from "./errors.js";
import { withApiKeySerialization } from "./api-key-serialization.js";
import { ConnectionRepository } from "./connections.js";
import { ProviderEventAcceptanceRepository } from "./trigger-acceptance.js";
import {
  toAgentExecutionRecord,
  toAttachmentRecord,
  toMachineRecord,
  toProjectConfigurationRevisionRecord,
  toProjectRecord,
  toProviderEventReceiptSummary,
  toProviderEventReceiptRecord,
} from "./mappers.js";
import type { AgentExecutionStatus, MachineSource, MachineStatus } from "./schema.js";
import type { DatabaseRuntime, QueryHandle, QueryRow } from "./runtime/index.js";
import type { Locks } from "./runtime/locks/index.js";
import type {
  AgentExecutionOutputAttempt,
  AgentExecutionRecord,
  AttachmentProvider,
  AttachmentRecord,
  ConfigurationSyncAttemptRecord,
  CreateProjectInput,
  Database,
  InsertProjectConfigurationRevisionInput,
  InsertAgentExecutionInput,
  InsertAttachmentInput,
  InsertMachineInput,
  MachineRecord,
  TerminateMachineFields,
  TransitionAgentExecutionFields,
  TransitionAgentExecutionResult,
  ProviderEventReceiptRecord,
  ProviderEventReceiptSummary,
  EnrollDaemonInput,
  EnrollmentTokenRecord,
  DaemonRecord,
  CliAuthorizationRecord,
  CliAuthorizationDecisionInput,
  CliAuthorizationPollResult,
  StartCliAuthorizationInput,
  SwitchProjectConfigurationToManualInput,
  SetProjectGitHubConfigurationSourceInput,
  RecordConfigurationSyncAttemptInput,
  AdvanceGitHubConnectionAttemptInput,
  BindDiscordConnectionInput,
  BindGitHubConnectionInput,
  BindSlackConnectionInput,
  CompleteSlackProviderApplicationInput,
  ConnectionStartAuthority,
  ConnectionProvider,
  ReadConnectionAttemptInput,
  StartConnectionAttemptInput,
  AcceptDiscordEventInput,
  AcceptGitHubEventInput,
  AcceptSlackEventInput,
  GitHubLifecycleReceiptClaim,
  GitHubLifecycleReceiptClaimInput,
  GitHubLifecycleResult,
  PersistManualEventInput,
  ProjectConfigurationReadModel,
  ProjectConfigurationRevisionRecord,
  ProjectRecord,
  OrganizationConnectionUsage,
  GitHubRepositoryRecord,
  GitHubConfigurationTarget,
  ProjectTriggerRoute,
  CreateAcceptedTriggerRunInput,
  CreateRejectedTriggerRunInput,
  AgentExecutionHubAcknowledgementInput,
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
  ProjectActivityRunRecord,
  OrganizationEntitlementsRecord,
  OperatorOrganizationRecord,
  StampOrganizationEntitlementsInput,
  OverrideOrganizationEntitlementsInput,
  ClearOrganizationEntitlementsOverrideInput,
  EntitlementChangeRecord,
  EntitlementChangeSource,
  OrganizationUsageRecord,
  ConsumeOrganizationUsageInput,
  BillingPlanRecord,
  BillingPlanPriceRecord,
  SyncBillingPlanInput,
  OrganizationSubscriptionRecord,
  ReconcileOrganizationSubscriptionInput,
} from "./types.js";

const OUTPUT_ATTEMPT_LEASE_MS = 5 * 60_000;

function transitionWithTerminalRun(
  transition: TransitionAgentExecutionResult,
  run: TriggerRunRecord | undefined,
): TransitionAgentExecutionResult {
  return !transition.transitioned || run === undefined || run.status === "running"
    ? transition
    : { ...transition, terminalRun: run };
}

export function createDatabase(runtime: DatabaseRuntime, locks: Locks): Database {
  return new PgDatabase(runtime, locks);
}

class PgDatabase implements Database {
  private readonly connections;
  private readonly triggerAcceptance;

  constructor(
    private readonly pool: DatabaseRuntime,
    private readonly locks: Locks,
  ) {
    const database = this.pool.drizzle();
    this.connections = new ConnectionRepository(this.pool, locks);
    this.triggerAcceptance = new ProviderEventAcceptanceRepository(database, this.connections);
  }

  acceptGitHubEvent(input: AcceptGitHubEventInput) {
    return this.triggerAcceptance.acceptGitHub(input);
  }

  acceptDiscordEvent(input: AcceptDiscordEventInput) {
    return this.triggerAcceptance.acceptDiscord(input);
  }

  acceptSlackEvent(input: AcceptSlackEventInput) {
    return this.triggerAcceptance.acceptSlack(input);
  }

  persistManualEvent(input: PersistManualEventInput) {
    return this.triggerAcceptance.persistManual(input);
  }

  claimGitHubLifecycleReceipt(input: GitHubLifecycleReceiptClaimInput) {
    return this.triggerAcceptance.claimGitHubLifecycleReceipt(input);
  }

  applyGitHubLifecycle(
    claim: Extract<GitHubLifecycleReceiptClaim, { status: "claimed" }>,
    result: GitHubLifecycleResult,
  ) {
    return this.triggerAcceptance.applyGitHubLifecycle(claim, result);
  }

  releaseGitHubLifecycleReceipt(providerEventReceiptId: string) {
    return this.triggerAcceptance.releaseGitHubLifecycleReceipt(providerEventReceiptId);
  }

  async markProviderEventDropped(
    providerEventReceiptId: string,
    reason: ProviderEventDropReasonCode,
  ): Promise<void> {
    const rows = await query(
      this.pool,
      `update provider_event_receipts
      set dropped_reason = coalesce(dropped_reason, $2)
      where id = $1`,
      [providerEventReceiptId, reason],
    );
    if (rows.rowCount === 0)
      throw new Error(`provider event receipt not found: ${providerEventReceiptId}`);
  }

  async findProviderEventReceiptByDeliveryId(
    deliveryId: string,
    organizationId?: string,
  ): Promise<ProviderEventReceiptRecord | undefined> {
    const rows = await query<ProviderEventReceiptRow>(
      this.pool,
      organizationId === undefined
        ? "select * from provider_event_receipts where delivery_id = $1 limit 1"
        : "select * from provider_event_receipts where delivery_id = $1 and organization_id = $2 limit 1",
      organizationId === undefined ? [deliveryId] : [deliveryId, organizationId],
    );
    return rows.rows[0] === undefined ? undefined : toProviderEventReceiptRecord(rows.rows[0]);
  }

  async insertMachine(input: InsertMachineInput): Promise<MachineRecord> {
    try {
      const rows = await query<MachineRow>(
        this.pool,
        `
          insert into machines (
            org_id,
            source,
            status,
            trigger_name,
            trigger_context,
            specs
          )
          values ($1, $2, $3, $4, $5, $6)
          returning *
        `,
        [
          input.orgId,
          input.source,
          input.status ?? "spawning",
          input.triggerName ?? null,
          input.triggerContext ?? null,
          input.specs ?? null,
        ],
      );
      const machine = rows.rows[0];

      if (machine === undefined) {
        throw new Error("machine insert returned no row");
      }

      return toMachineRecord(machine);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findMachineById(id: string): Promise<MachineRecord | undefined> {
    try {
      const rows = await query<MachineRow>(
        this.pool,
        "select * from machines where id = $1 limit 1",
        [id],
      );

      return rows.rows[0] === undefined ? undefined : toMachineRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findMachineForOrganization(
    organizationId: string,
    id: string,
  ): Promise<MachineRecord | undefined> {
    try {
      const rows = await query<MachineRow>(
        this.pool,
        "select * from machines where id = $1 and org_id = $2 limit 1",
        [id, organizationId],
      );

      return rows.rows[0] === undefined ? undefined : toMachineRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async transitionMachine(
    id: string,
    toStatus: MachineStatus,
    fields?: TerminateMachineFields,
  ): Promise<MachineRecord> {
    try {
      const rows = await query<MachineRow>(
        this.pool,
        `
          update machines
          set
            status = $2::machine_status,
            terminated_at = case
              when $2::machine_status = 'terminated'::machine_status then now()
              else terminated_at
            end,
            shutdown_reason = case
              when $3::boolean then $4
              else shutdown_reason
            end
          where id = $1
          returning *
        `,
        [id, toStatus, fields !== undefined, fields?.reason ?? null],
      );
      const machine = rows.rows[0];

      if (machine === undefined) {
        throw new Error(`machine not found: ${id}`);
      }

      return toMachineRecord(machine);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async insertAgentExecution(input: InsertAgentExecutionInput): Promise<AgentExecutionRecord> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `
          insert into agent_executions (
            id,
            organization_id,
            project_id,
            machine_id,
            daemon_id,
            status,
            started_at,
            trigger_context,
            output_context,
            configuration_revision_id,
            completion_token_hash,
            deadline_at,
            idle_deadline_at,
            launch_intent,
            workflow_step_run_id,
            result,
            completed_at,
            reaction_state
          )
          select coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6::agent_execution_status, coalesce($7, now()), $8, $9, $10, $11,
                 $12,
                 case
                   when $13::timestamptz is null then null
                   when $12::timestamptz is null then $13::timestamptz
                   else least($12::timestamptz, $13::timestamptz)
                 end,
                 $14, $15, $16,
                 case when $6 = 'failed'::agent_execution_status then coalesce($7, now()) else null end,
                 $17
          from projects
          where projects.id = $3 and projects.organization_id = $2 and projects.status = 'active'
            and exists (
              select 1 from project_configuration_revisions
              where id = $10 and project_id = $3 and organization_id = $2
            )
            and ($5::uuid is null or exists (
              select 1 from daemons daemon
              join machines daemon_machine on daemon_machine.id = daemon.machine_id
              where daemon.id = $5 and daemon_machine.org_id = $2
            ))
            and ($4::uuid is null or exists (
              select 1 from machines where id = $4 and org_id = $2
            ))
          returning *
        `,
        [
          input.id ?? null,
          input.organizationId,
          input.projectId,
          input.machineId,
          input.daemonId ?? null,
          input.status ?? "spawning",
          input.startedAt ?? null,
          input.triggerContext,
          input.outputContext,
          input.configurationRevisionId,
          input.completionTokenHash ?? null,
          input.deadlineAt ?? null,
          input.idleDeadlineAt ?? null,
          input.launchIntent ?? null,
          input.workflowStepRunId ?? null,
          input.result ?? null,
          input.reactionState ?? null,
        ],
      );
      const execution = rows.rows[0];

      if (execution === undefined) {
        throw new Error("agent execution insert returned no row");
      }

      return toAgentExecutionRecord(execution);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async insertAgentExecutionIfAbsent(
    input: InsertAgentExecutionInput & { id: string },
  ): Promise<AgentExecutionRecord | undefined> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `
          insert into agent_executions (
            id,
            organization_id,
            project_id,
            machine_id,
            daemon_id,
            status,
            started_at,
            trigger_context,
            output_context,
            configuration_revision_id,
            completion_token_hash,
            deadline_at,
            idle_deadline_at,
            launch_intent,
            workflow_step_run_id,
            result,
            completed_at
          )
          select $1, $2, $3, $4, $5, $6::agent_execution_status, coalesce($7, now()), $8, $9, $10, $11,
                 $12,
                 case
                   when $13::timestamptz is null then null
                   when $12::timestamptz is null then $13::timestamptz
                   else least($12::timestamptz, $13::timestamptz)
                 end,
                 $14, $15, $16,
                 case when $6 = 'failed'::agent_execution_status then coalesce($7, now()) else null end
          from projects
          where projects.id = $3 and projects.organization_id = $2 and projects.status = 'active'
            and exists (
              select 1 from project_configuration_revisions
              where id = $10 and project_id = $3 and organization_id = $2
            )
            and ($5::uuid is null or exists (
              select 1 from daemons daemon
              join machines daemon_machine on daemon_machine.id = daemon.machine_id
              where daemon.id = $5 and daemon_machine.org_id = $2
            ))
            and ($4::uuid is null or exists (
              select 1 from machines where id = $4 and org_id = $2
            ))
          on conflict (id) do nothing
          returning *
        `,
        [
          input.id,
          input.organizationId,
          input.projectId,
          input.machineId,
          input.daemonId ?? null,
          input.status ?? "spawning",
          input.startedAt ?? null,
          input.triggerContext,
          input.outputContext,
          input.configurationRevisionId,
          input.completionTokenHash ?? null,
          input.deadlineAt ?? null,
          input.idleDeadlineAt ?? null,
          input.launchIntent ?? null,
          input.workflowStepRunId ?? null,
          input.result ?? null,
        ],
      );
      const execution = rows.rows[0];
      return execution === undefined ? undefined : toAgentExecutionRecord(execution);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async createAcceptedTriggerRun(
    input: CreateAcceptedTriggerRunInput,
  ): Promise<{ run: AcceptedTriggerRunRecord; created: boolean }> {
    try {
      return await this.pool.transaction(async (client) => {
        const inserted = await client.query<TriggerRunRow>(
          `insert into trigger_runs
           (id, organization_id, project_id, configuration_revision_id, provider_event_receipt_id,
           configured_trigger_name, outcome, status,
            prompt, inputs, values, trigger_context, output_context, deadline_at, deadline_kind, rejection, created_at)
         values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, 'accepted', 'running', $7, $8, '{}'::jsonb, $9, $10, $11, null, null, $12)
         on conflict (provider_event_receipt_id, project_id, configured_trigger_name) do nothing
         returning *`,
          [
            input.id ?? null,
            input.organizationId,
            input.projectId,
            input.configurationRevisionId,
            input.providerEventReceiptId,
            input.configuredTriggerName,
            input.prompt,
            input.inputs,
            input.triggerContext,
            input.outputContext,
            input.deadlineAt,
            input.createdAt ?? new Date(),
          ],
        );
        let run = inserted.rows[0];
        const created = run !== undefined;
        if (run === undefined) {
          const existing = await client.query<TriggerRunRow>(
            `select * from trigger_runs
           where provider_event_receipt_id = $1 and project_id = $2 and configured_trigger_name = $3
           for update`,
            [input.providerEventReceiptId, input.projectId, input.configuredTriggerName],
          );
          run = existing.rows[0];
        }
        if (run === undefined) throw new Error("trigger run insert returned no row");
        if (run.outcome !== "accepted") throw new Error("trigger branch outcome conflict");
        for (const [ordinal, stepId] of input.stepIds.entries()) {
          await client.query(
            `insert into workflow_step_runs
             (trigger_run_id, step_id, ordinal, status, deadline_kind, deadline_at, idle_deadline_at)
           values ($1, $2, $3, 'pending', null, null, null)
           on conflict (trigger_run_id, ordinal) do nothing`,
            [run.id, stepId, ordinal],
          );
        }
        await client.query(
          `insert into workflow_wakeups (trigger_run_id, available_at, lease_expires_at)
         values ($1, $2, null)
         on conflict (trigger_run_id) do nothing`,
          [run.id, input.createdAt ?? new Date()],
        );
        const record = toTriggerRunRecord(run);
        if (record.outcome !== "accepted") throw new Error("trigger branch outcome conflict");
        return { run: record, created };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async createRejectedTriggerRun(
    input: CreateRejectedTriggerRunInput,
  ): Promise<{ run: RejectedTriggerRunRecord; created: boolean }> {
    try {
      return await this.pool.transaction(async (client) => {
        const createdAt = input.createdAt ?? new Date();
        const inserted = await client.query<TriggerRunRow>(
          `insert into trigger_runs
           (id, organization_id, project_id, configuration_revision_id, provider_event_receipt_id,
           configured_trigger_name, outcome, status,
            prompt, inputs, values, trigger_context, output_context, deadline_at, rejection, created_at, completed_at)
         values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, 'rejected', 'rejected',
                 $7, $8, '{}'::jsonb, $9, $10, null, $12, $11, $11)
         on conflict (provider_event_receipt_id, project_id, configured_trigger_name) do nothing
         returning *`,
          [
            input.id ?? null,
            input.organizationId,
            input.projectId,
            input.configurationRevisionId,
            input.providerEventReceiptId,
            input.configuredTriggerName,
            input.prompt,
            input.inputs,
            input.triggerContext,
            input.outputContext,
            createdAt,
            input.rejection,
          ],
        );
        let run = inserted.rows[0];
        const created = run !== undefined;
        if (run === undefined) {
          const existing = await client.query<TriggerRunRow>(
            `select * from trigger_runs
           where provider_event_receipt_id = $1 and project_id = $2 and configured_trigger_name = $3
           for update`,
            [input.providerEventReceiptId, input.projectId, input.configuredTriggerName],
          );
          run = existing.rows[0];
        }
        if (run === undefined) throw new Error("trigger run insert returned no row");
        if (run.outcome !== "rejected") throw new Error("trigger branch outcome conflict");
        const record = toTriggerRunRecord(run);
        if (record.outcome !== "rejected") throw new Error("trigger branch outcome conflict");
        return { run: record, created };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findTriggerRunById(id: string) {
    const rows = await query<TriggerRunRow>(this.pool, `select * from trigger_runs where id = $1`, [
      id,
    ]);
    return rows.rows[0] === undefined ? undefined : toTriggerRunRecord(rows.rows[0]);
  }

  async findTriggerRunsByProviderEventReceiptId(providerEventReceiptId: string) {
    const rows = await query<TriggerRunRow>(
      this.pool,
      `select * from trigger_runs
       where provider_event_receipt_id = $1
       order by created_at, configured_trigger_name, id`,
      [providerEventReceiptId],
    );
    return rows.rows.map(toTriggerRunRecord);
  }

  async listTriggerRunsForProject(projectId: string, limit: number) {
    const rows = await query<TriggerRunRow>(
      this.pool,
      `select * from trigger_runs
       where project_id = $1
       order by created_at desc, configured_trigger_name, id desc
       limit $2`,
      [projectId, limit],
    );
    return rows.rows.map(toTriggerRunRecord);
  }

  async findWorkflowStepRunById(id: string) {
    const rows = await query<WorkflowStepRunRow>(
      this.pool,
      `select * from workflow_step_runs where id = $1`,
      [id],
    );
    return rows.rows[0] === undefined ? undefined : toWorkflowStepRunRecord(rows.rows[0]);
  }

  async findWorkflowStepRunByTriggerRun(triggerRunId: string) {
    const rows = await query<WorkflowStepRunRow>(
      this.pool,
      `select * from workflow_step_runs where trigger_run_id = $1 order by ordinal limit 1`,
      [triggerRunId],
    );
    return rows.rows[0] === undefined ? undefined : toWorkflowStepRunRecord(rows.rows[0]);
  }

  async listWorkflowStepRunsForTriggerRun(triggerRunId: string) {
    const rows = await query<WorkflowStepRunRow>(
      this.pool,
      `select * from workflow_step_runs where trigger_run_id = $1 order by ordinal`,
      [triggerRunId],
    );
    return rows.rows.map(toWorkflowStepRunRecord);
  }

  async findAgentExecutionByWorkflowStepRunId(stepRunId: string) {
    const rows = await query<AgentExecutionRow>(
      this.pool,
      `select * from agent_executions where workflow_step_run_id = $1 limit 1`,
      [stepRunId],
    );
    return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
  }

  async claimWorkflowWakeup(now: Date, leaseMs: number) {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<WorkflowWakeupRow>(
          `select * from workflow_wakeups
         where available_at <= $1
           and (lease_expires_at is null or lease_expires_at <= $1)
         order by available_at, trigger_run_id
         for update skip locked limit 1`,
          [now],
        );
        const wakeup = selected.rows[0];
        if (wakeup === undefined) {
          return undefined;
        }
        const updated = await client.query<WorkflowWakeupRow>(
          `update workflow_wakeups set lease_expires_at = $2 where trigger_run_id = $1 returning *`,
          [wakeup.trigger_run_id, new Date(now.getTime() + leaseMs)],
        );
        return toWorkflowWakeupRecord(updated.rows[0]!, wakeup.lease_expires_at !== null);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async wakeWorkflowRun(triggerRunId: string, availableAt: Date) {
    await query(
      this.pool,
      `insert into workflow_wakeups (trigger_run_id, available_at, lease_expires_at)
       values ($1, $2, null)
       on conflict (trigger_run_id) do update
       set available_at = least(workflow_wakeups.available_at, excluded.available_at),
           lease_expires_at = null`,
      [triggerRunId, availableAt],
    );
  }

  async deleteWorkflowWakeup(triggerRunId: string) {
    await query(this.pool, `delete from workflow_wakeups where trigger_run_id = $1`, [
      triggerRunId,
    ]);
  }

  async createWorkflowStepExecution(input: WorkflowStepExecutionInput) {
    try {
      return await this.pool.transaction(async (client) => {
        const startedAt = input.execution.startedAt;
        const runRows = await client.query<TriggerRunRow>(
          `select * from trigger_runs where id = $1 for update`,
          [input.triggerRunId],
        );
        const run = runRows.rows[0];
        if (run === undefined) throw new Error("workflow trigger run not found");
        if (run.outcome !== "accepted" || run.status !== "running") {
          const stepRows = await client.query<WorkflowStepRunRow>(
            `select * from workflow_step_runs where trigger_run_id = $1 and step_id = $2 and ordinal = $3`,
            [input.triggerRunId, input.stepId, input.ordinal],
          );
          const step = stepRows.rows[0];
          if (step === undefined) throw new Error("workflow step run not found");
          return { stepRun: toWorkflowStepRunRecord(step), execution: undefined, created: false };
        }
        if (run.deadline_at === null || run.deadline_at.getTime() <= startedAt.getTime()) {
          await timeoutWorkflowRunOnClient(client, run, startedAt);
          const stepRows = await client.query<WorkflowStepRunRow>(
            `select * from workflow_step_runs where trigger_run_id = $1 and step_id = $2 and ordinal = $3`,
            [input.triggerRunId, input.stepId, input.ordinal],
          );
          const step = stepRows.rows[0];
          if (step === undefined) throw new Error("workflow step run not found");
          return { stepRun: toWorkflowStepRunRecord(step), execution: undefined, created: false };
        }
        const deadlineAt = new Date(
          Math.min(input.execution.deadlineAt.getTime(), run.deadline_at.getTime()),
        );
        const idleDeadlineAt = new Date(
          Math.min(
            input.execution.idleDeadlineAt.getTime(),
            deadlineAt.getTime(),
            run.deadline_at.getTime(),
          ),
        );
        const selected = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs where trigger_run_id = $1 and step_id = $2 and ordinal = $3 for update`,
          [input.triggerRunId, input.stepId, input.ordinal],
        );
        let step = selected.rows[0];
        if (step === undefined) throw new Error("workflow step run not found");
        if (step.agent_execution_id !== null) {
          const existing = await client.query<AgentExecutionRow>(
            `select * from agent_executions where id = $1`,
            [step.agent_execution_id],
          );
          return {
            stepRun: toWorkflowStepRunRecord(step),
            execution:
              existing.rows[0] === undefined ? undefined : toAgentExecutionRecord(existing.rows[0]),
            created: false,
          };
        }
        const execution = await insertAgentExecutionOnClient(client, {
          ...input.execution,
          id: input.executionId,
          deadlineAt,
          idleDeadlineAt,
          workflowStepRunId: step.id,
        });
        // Reserve one meter unit in the same transaction that creates the execution. If the
        // reservation is denied the whole transaction rolls back, so no execution is created and
        // nothing is dispatched — metering is atomic with the work it permits.
        if (input.reservation !== undefined) {
          const reserved = await reserveOrganizationUsageOnClient(client, {
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
            const usage = await client.query<OrganizationUsageRow>(
              `select used from organization_usage
             where organization_id = $1 and meter = $2 and period_start = $3`,
              [
                input.execution.organizationId,
                input.reservation.meter,
                input.reservation.periodStart,
              ],
            );
            return client.rollback({
              stepRun: toWorkflowStepRunRecord(step),
              execution: undefined,
              created: false,
              reservationDenied: {
                meter: input.reservation.meter,
                limit: input.reservation.limit,
                current: Number(usage.rows[0]?.used ?? 0),
              },
            });
          }
        }
        const updated = await client.query<WorkflowStepRunRow>(
          `update workflow_step_runs
         set status = 'running', agent_execution_id = $2, started_at = coalesce(started_at, $3),
             deadline_at = $4, idle_deadline_at = $5, dispatch_intent = coalesce($6, dispatch_intent)
         where id = $1 and agent_execution_id is null
         returning *`,
          [
            step.id,
            execution.id,
            execution.started_at,
            execution.deadline_at,
            execution.idle_deadline_at,
            input.execution.launchIntent ?? null,
          ],
        );
        step = updated.rows[0] ?? step;
        return {
          stepRun: toWorkflowStepRunRecord(step),
          execution: toAgentExecutionRecord(execution),
          created: true,
        };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async linkWorkflowStepRunExecution(
    stepRunId: string,
    executionId: string,
    dispatchIntent?: LaunchMachineIntent,
  ) {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs where id = $1 for update`,
          [stepRunId],
        );
        const step = selected.rows[0];
        if (step === undefined) throw new Error(`workflow step run not found: ${stepRunId}`);
        if (step.agent_execution_id !== null && step.agent_execution_id !== executionId) {
          throw new Error(`workflow step run already linked: ${stepRunId}`);
        }
        if (step.agent_execution_id === executionId) {
          return toWorkflowStepRunRecord(step);
        }
        const execution = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1`,
          [executionId],
        );
        const executionRow = execution.rows[0];
        if (executionRow === undefined)
          throw new Error(`agent execution not found: ${executionId}`);
        const updated = await client.query<WorkflowStepRunRow>(
          `update workflow_step_runs
         set status = case when status = 'pending' then 'running' else status end,
             agent_execution_id = $2, started_at = coalesce(started_at, $3),
             dispatch_intent = coalesce($4, dispatch_intent)
         where id = $1 and agent_execution_id is null
         returning *`,
          [stepRunId, executionId, executionRow.started_at, dispatchIntent ?? null],
        );
        return toWorkflowStepRunRecord(updated.rows[0] ?? step);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
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
    const step = await this.findWorkflowStepRunById(execution.workflowStepRunId);
    return step === undefined
      ? undefined
      : {
          stepRun: step,
          run: (await this.findTriggerRunById(step.triggerRunId))!,
        };
  }

  async completeWorkflowAgentExecution(input: WorkflowAgentCompletionInput) {
    try {
      return await this.pool.transaction(async (client) => {
        const initialExecution = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1`,
          [input.executionId],
        );
        const initial = initialExecution.rows[0];
        if (initial === undefined)
          throw new Error(`agent execution not found: ${input.executionId}`);
        if (initial.workflow_step_run_id === null) {
          return this.transitionAgentExecution(input.executionId, input.executionStatus, {
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

        const stepLookup = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs where id = $1`,
          [initial.workflow_step_run_id],
        );
        const stepCandidate = stepLookup.rows[0];
        if (stepCandidate === undefined) throw new Error("workflow step run not found");
        const runRows = await client.query<TriggerRunRow>(
          `select * from trigger_runs where id = $1 for update`,
          [stepCandidate.trigger_run_id],
        );
        const run = runRows.rows[0];
        if (run === undefined) throw new Error("workflow trigger run not found");
        const stepRows = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs where id = $1 for update`,
          [initial.workflow_step_run_id],
        );
        const step = stepRows.rows[0];
        if (step === undefined) throw new Error("workflow step run not found");

        const executionRows = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1 for update`,
          [input.executionId],
        );
        const execution = executionRows.rows[0];
        if (execution === undefined)
          throw new Error(`agent execution not found: ${input.executionId}`);
        const observedAt = input.observedAt ?? new Date();
        if (execution.status === "spawning" || execution.status === "running") {
          const deadlineKind = workflowDeadlineKind(execution, step, run, observedAt);
          if (deadlineKind === "whole_run") {
            const recovery = await timeoutWorkflowRunOnClient(client, run, observedAt);
            const terminalRun = await findTriggerRunOnClient(client, run.id);
            const updatedExecution = await findAgentExecutionOnClient(client, input.executionId);
            return transitionWithTerminalRun(
              {
                execution: updatedExecution ?? toAgentExecutionRecord(execution),
                transitioned: recovery.executionIds.includes(input.executionId),
                deadlineKind,
              },
              terminalRun,
            );
          }
          if (deadlineKind !== undefined) {
            const updated = await timeoutWorkflowStepOnClient(
              client,
              execution,
              step,
              run,
              deadlineKind,
              observedAt,
            );
            const terminalRun = await findTriggerRunOnClient(client, run.id);
            return transitionWithTerminalRun(
              {
                execution: toAgentExecutionRecord(updated),
                transitioned: true,
                deadlineKind,
              },
              terminalRun,
            );
          }
        }

        const liveTransition = await transitionWorkflowAgentExecution(client, execution, input);
        if (liveTransition === undefined) {
          return { execution: toAgentExecutionRecord(execution), transitioned: false };
        }

        await finishWorkflowStepAndRun(client, step, run, input);
        const terminalRun = await findTriggerRunOnClient(client, run.id);

        return transitionWithTerminalRun(
          {
            execution: toAgentExecutionRecord(liveTransition.execution),
            transitioned: liveTransition.transitioned,
            ...(input.deadlineKind === undefined ? {} : { deadlineKind: input.deadlineKind }),
          },
          terminalRun,
        );
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async markWorkflowStepSkipped(triggerRunId: string, stepId: string, reason: string) {
    try {
      return await this.pool.transaction(async (client) => {
        const stepRows = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs where trigger_run_id = $1 and step_id = $2 for update`,
          [triggerRunId, stepId],
        );
        const step = stepRows.rows[0];
        const runRows = await client.query<TriggerRunRow>(
          `select * from trigger_runs where id = $1 for update`,
          [triggerRunId],
        );
        const run = runRows.rows[0];
        if (step === undefined || run === undefined) {
          return undefined;
        }
        if (step.status !== "pending") {
          return { stepRun: toWorkflowStepRunRecord(step), run: toTriggerRunRecord(run) };
        }
        const completedAt = new Date();
        const updatedRows = await client.query<WorkflowStepRunRow>(
          `update workflow_step_runs
         set status = 'skipped', failure_reason = $2, completed_at = $3
         where id = $1 and status = 'pending' returning *`,
          [step.id, reason, completedAt],
        );
        await client.query(
          `insert into workflow_wakeups (trigger_run_id, available_at, lease_expires_at)
         values ($1, $2, null)
         on conflict (trigger_run_id) do update
         set available_at = least(workflow_wakeups.available_at, excluded.available_at), lease_expires_at = null`,
          [triggerRunId, completedAt],
        );
        return {
          stepRun: toWorkflowStepRunRecord(updatedRows.rows[0] ?? step),
          run: toTriggerRunRecord(run),
        };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async succeedTriggerRun(triggerRunId: string) {
    const rows = await query<TriggerRunRow>(
      this.pool,
      `update trigger_runs
       set status = 'succeeded', completed_at = now(),
           terminal_notification_pending_at = coalesce(terminal_notification_pending_at, now()),
           terminal_notification_lease_expires_at = null
       where id = $1 and status = 'running' returning *`,
      [triggerRunId],
    );
    if (rows.rows[0] === undefined) {
      const run = await this.findTriggerRunById(triggerRunId);
      return run === undefined ? undefined : { run, transitioned: false };
    }
    await this.deleteWorkflowWakeup(triggerRunId);
    return { run: toTriggerRunRecord(rows.rows[0]), transitioned: true };
  }

  async failWorkflowRun(
    triggerRunId: string,
    status: "failed" | "timed_out",
    failureReason: string,
    stepId?: string,
  ) {
    try {
      return await this.pool.transaction(async (client) => {
        const runRows = await client.query<TriggerRunRow>(
          `select * from trigger_runs where id = $1 for update`,
          [triggerRunId],
        );
        const run = runRows.rows[0];
        const stepRows = await client.query<WorkflowStepRunRow>(
          `select * from workflow_step_runs
         where trigger_run_id = $1 and ($2::text is null or step_id = $2)
         order by ordinal limit 1 for update`,
          [triggerRunId, stepId ?? null],
        );
        const step = stepRows.rows[0];
        if (run === undefined || step === undefined) {
          return undefined;
        }
        if (run.status !== "running") {
          return {
            stepRun: toWorkflowStepRunRecord(step),
            run: toTriggerRunRecord(run),
            transitioned: false,
          };
        }
        const completedAt = new Date();
        const updatedStep = await client.query<WorkflowStepRunRow>(
          `update workflow_step_runs
         set status = case when status in ('pending', 'running') then $2 else status end,
             failure_reason = case when status in ('pending', 'running') then $3 else failure_reason end,
             completed_at = case when status in ('pending', 'running') then $4 else completed_at end
         where id = $1 returning *`,
          [step.id, status, failureReason, completedAt],
        );
        const updatedRun = await client.query<TriggerRunRow>(
          `update trigger_runs
         set status = $2, failure_reason = $3, completed_at = $4,
             terminal_notification_pending_at = coalesce(terminal_notification_pending_at, $4),
             terminal_notification_lease_expires_at = null
         where id = $1 returning *`,
          [triggerRunId, status, failureReason, completedAt],
        );
        await client.query(`delete from workflow_wakeups where trigger_run_id = $1`, [
          triggerRunId,
        ]);
        return {
          stepRun: toWorkflowStepRunRecord(updatedStep.rows[0] ?? step),
          run: toTriggerRunRecord(updatedRun.rows[0]!),
          transitioned: true,
        };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async recoverWorkflowWakeups(now: Date) {
    await query(
      this.pool,
      `insert into workflow_wakeups (trigger_run_id, available_at, lease_expires_at)
       select runs.id, $1, null
       from trigger_runs runs
       left join workflow_wakeups wakeups on wakeups.trigger_run_id = runs.id
       where runs.status = 'running'
         and runs.deadline_at > $1
         and not exists (
           select 1 from agent_executions executions
           join workflow_step_runs live_steps on live_steps.id = executions.workflow_step_run_id
           where live_steps.trigger_run_id = runs.id
             and executions.status in ('spawning', 'running')
         )
         and wakeups.trigger_run_id is null
       on conflict (trigger_run_id) do nothing`,
      [now],
    );
  }

  async claimPendingWorkflowRunTerminalNotification(now: Date, leaseMs: number) {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<TriggerRunRow>(
          `select * from trigger_runs
         where outcome = 'accepted'
           and status <> 'running'
           and terminal_notification_pending_at is not null
           and terminal_notification_delivered_at is null
           and (
             terminal_notification_lease_expires_at is null
             or terminal_notification_lease_expires_at <= $1
           )
         order by terminal_notification_pending_at, id
         for update skip locked limit 1`,
          [now],
        );
        const run = selected.rows[0];
        if (run === undefined) {
          return undefined;
        }
        const updated = await client.query<TriggerRunRow>(
          `update trigger_runs
         set terminal_notification_lease_expires_at = $2
         where id = $1
         returning *`,
          [run.id, new Date(now.getTime() + leaseMs)],
        );
        return toTriggerRunRecord(updated.rows[0]!);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async markWorkflowRunTerminalNotificationDelivered(
    triggerRunId: string,
    deliveredAt: Date,
    reactionState: JsonValue | null,
  ) {
    await query(
      this.pool,
      `update trigger_runs
       set reaction_state = $3,
           terminal_notification_delivered_at = coalesce(terminal_notification_delivered_at, $2),
           terminal_notification_lease_expires_at = null
       where id = $1
         and terminal_notification_pending_at is not null
         and terminal_notification_delivered_at is null`,
      [triggerRunId, deliveredAt, reactionState],
    );
  }

  async setWorkflowRunReactionState(triggerRunId: string, reactionState: JsonValue | null) {
    const rows = await query<TriggerRunRow>(
      this.pool,
      `update trigger_runs
       set reaction_state = $2
       where id = $1 and outcome = 'accepted'
       returning *`,
      [triggerRunId, reactionState],
    );
    const row = rows.rows[0];
    if (row === undefined) return undefined;
    const run = toTriggerRunRecord(row);
    if (run.outcome !== "accepted") throw new Error("trigger branch outcome conflict");
    return run;
  }

  async recoverWorkflowDeadlines(now: Date): Promise<readonly WorkflowDeadlineRecovery[]> {
    try {
      return await this.pool.transaction(async (client) => {
        const recoveries: WorkflowDeadlineRecovery[] = [];
        const overdueRuns = await client.query<TriggerRunRow>(
          `select * from trigger_runs
         where outcome = 'accepted' and status = 'running' and deadline_at <= $1
         order by deadline_at, id
         for update skip locked`,
          [now],
        );
        for (const run of overdueRuns.rows) {
          recoveries.push(await timeoutWorkflowRunOnClient(client, run, now));
        }

        const activeRuns = await client.query<TriggerRunRow>(
          `select * from trigger_runs
         where outcome = 'accepted' and status = 'running' and deadline_at > $1
         order by deadline_at, id
         for update skip locked`,
          [now],
        );
        for (const run of activeRuns.rows) {
          const steps = await client.query<WorkflowStepRunRow>(
            `select * from workflow_step_runs
           where trigger_run_id = $1 and status = 'running'
           order by ordinal
           for update`,
            [run.id],
          );
          for (const step of steps.rows) {
            const executionRows =
              step.agent_execution_id === null
                ? { rows: [] as AgentExecutionRow[] }
                : await client.query<AgentExecutionRow>(
                    `select * from agent_executions where id = $1 for update`,
                    [step.agent_execution_id],
                  );
            const execution = executionRows.rows[0];
            if (
              execution !== undefined &&
              (execution.status === "succeeded" || execution.status === "failed")
            ) {
              continue;
            }
            const deadlineKind = workflowDeadlineKind(execution, step, run, now);
            if (deadlineKind === undefined || deadlineKind === "whole_run") continue;
            if (execution === undefined) {
              const reason =
                deadlineKind === "step_idle" ? "step_idle_timeout" : "step_hard_timeout";
              await client.query(
                `update workflow_step_runs
               set status = 'timed_out', failure_reason = $2, deadline_kind = $3, completed_at = $4
               where id = $1 and status = 'running'`,
                [step.id, reason, deadlineKind, now],
              );
              await client.query(
                `update trigger_runs
               set status = 'failed', deadline_kind = $2, failure_reason = $3, completed_at = $4
               where id = $1 and status = 'running'`,
                [run.id, deadlineKind, reason, now],
              );
              await client.query(`delete from workflow_wakeups where trigger_run_id = $1`, [
                run.id,
              ]);
              recoveries.push({ triggerRunId: run.id, executionIds: [] });
            } else {
              const updated = await timeoutWorkflowStepOnClient(
                client,
                execution,
                step,
                run,
                deadlineKind,
                now,
              );
              recoveries.push({ triggerRunId: run.id, executionIds: [updated.id] });
            }
          }
        }
        return recoveries;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async issueEnrollmentToken(input: EnrollmentTokenRecord): Promise<boolean> {
    if (input.issuedByCliCredentialId !== undefined && input.issuedByCliCredentialId !== null) {
      return this.pool.transaction(async (client) => {
        await this.locks.withTxLock(client, input.issuedByCliCredentialId!);
        const credential = await client.query(
          `select id from organization_cli_credentials
           where id = $1 and organization_id = $2 and revoked_at is null for update`,
          [input.issuedByCliCredentialId, input.organizationId],
        );
        if (credential.rowCount !== 1) return false;
        await client.query(
          `insert into daemon_enrollment_tokens
             (id, verifier, organization_id, issued_by_cli_credential_id,
              expires_at)
           values ($1, $2, $3, $4, $5)`,
          [
            input.id,
            input.verifier,
            input.organizationId,
            input.issuedByCliCredentialId,
            input.expiresAt,
          ],
        );
        return true;
      });
    }
    if (input.issuedByApiKeyId === undefined || input.issuedByApiKeyId === null) {
      await query(
        this.pool,
        `insert into daemon_enrollment_tokens
           (id, verifier, organization_id, issued_by_api_key_id, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [input.id, input.verifier, input.organizationId, null, input.expiresAt],
      );
      return true;
    }

    return withApiKeySerialization(input.issuedByApiKeyId, async () => {
      return this.pool.transaction(async (client) => {
        await this.locks.withTxLock(client, input.issuedByApiKeyId!);
        const key = await client.query(
          `select id
           from organization_api_keys
           where id = $1 and organization_id = $2 and revoked_at is null
           for update`,
          [input.issuedByApiKeyId, input.organizationId],
        );
        if (key.rowCount !== 1) return false;
        await client.query(
          `insert into daemon_enrollment_tokens
             (id, verifier, organization_id, issued_by_api_key_id, expires_at)
           values ($1, $2, $3, $4, $5)`,
          [input.id, input.verifier, input.organizationId, input.issuedByApiKeyId, input.expiresAt],
        );
        return true;
      });
    });
  }

  async startCliAuthorization(
    input: StartCliAuthorizationInput,
  ): Promise<CliAuthorizationRecord | undefined> {
    try {
      return await this.pool.transaction(async (client) => {
        await this.locks.withTxLock(client, "paseo-cli-authorization-issuance");
        const capacity = await client.query<{
          fingerprint_count: number;
          global_count: number;
        }>(
          `select
           count(*) filter (where fingerprint_verifier = $1)::integer as fingerprint_count,
           count(*)::integer as global_count
         from cli_authorizations
         where status in ('pending', 'approved') and expires_at > now()`,
          [input.fingerprintVerifier],
        );
        const counts = capacity.rows[0]!;
        if (
          counts.fingerprint_count >= input.perFingerprintLimit ||
          counts.global_count >= input.globalLimit
        ) {
          return client.rollback(undefined);
        }
        const inserted = await client.query<CliAuthorizationRow>(
          `insert into cli_authorizations
           (id, device_verifier, user_code_verifier, fingerprint_verifier,
            status, poll_interval_seconds, next_poll_at, expires_at)
         values ($1, $2, $3, $4, 'pending', $5, now(),
                 now() + ($6 * interval '1 second'))
         returning *`,
          [
            input.id,
            input.deviceVerifier,
            input.userCodeVerifier,
            input.fingerprintVerifier,
            input.pollIntervalSeconds,
            input.lifetimeSeconds,
          ],
        );
        return toCliAuthorization(inserted.rows[0]!);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async inspectCliAuthorization(
    userCodeVerifier: string,
  ): Promise<CliAuthorizationRecord | undefined> {
    await query(
      this.pool,
      `update cli_authorizations set status = 'expired'
       where user_code_verifier = $1 and status in ('pending', 'approved')
         and expires_at <= now()`,
      [userCodeVerifier],
    );
    const rows = await query<CliAuthorizationRow>(
      this.pool,
      `select * from cli_authorizations
       where user_code_verifier = $1 and status = 'pending' and expires_at > now()`,
      [userCodeVerifier],
    );
    return rows.rows[0] === undefined ? undefined : toCliAuthorization(rows.rows[0]);
  }

  async decideCliAuthorization(
    input: CliAuthorizationDecisionInput,
  ): Promise<"approved" | "denied" | "unavailable" | "forbidden"> {
    try {
      return await this.pool.transaction(async (client) => {
        await client.query(
          `update cli_authorizations set status = 'expired'
         where user_code_verifier = $1 and status in ('pending', 'approved')
           and expires_at <= now()`,
          [input.userCodeVerifier],
        );
        const authorization = await client.query<CliAuthorizationRow>(
          `select * from cli_authorizations
         where user_code_verifier = $1 and status = 'pending' and expires_at > now()
         for update`,
          [input.userCodeVerifier],
        );
        if (authorization.rows[0] === undefined) {
          return client.rollback("unavailable" as const);
        }
        const authority = await client.query(
          `select 1
         from session
         join member on member.id = $3 and member.user_id = session.user_id
           and member.organization_id = session.active_organization_id
         where session.id = $1 and session.user_id = $2
           and session.active_organization_id = $4 and session.expires_at > now()
           and member.role in ('owner', 'admin')
         for update of session, member`,
          [
            input.access.sessionId,
            input.access.userId,
            input.access.membershipId,
            input.access.organizationId,
          ],
        );
        if (authority.rowCount !== 1) {
          return client.rollback("forbidden" as const);
        }
        const status = input.decision === "approve" ? "approved" : "denied";
        await client.query(
          `update cli_authorizations
         set status = $2, approved_organization_id = case when $2 = 'approved' then $3 end,
             approved_by_user_id = case when $2 = 'approved' then $4 end,
             decided_at = now()
         where id = $1`,
          [authorization.rows[0].id, status, input.access.organizationId, input.access.userId],
        );
        return status;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async pollCliAuthorization(input: {
    deviceVerifier: string;
    credential: { id: string; prefix: string; verifier: string };
  }): Promise<CliAuthorizationPollResult> {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<CliAuthorizationRow>(
          `select *, now() as database_now
         from cli_authorizations where device_verifier = $1 for update`,
          [input.deviceVerifier],
        );
        const authorization = selected.rows[0];
        if (authorization !== undefined && authorization.expires_at <= authorization.database_now) {
          await client.query(`update cli_authorizations set status = 'expired' where id = $1`, [
            authorization.id,
          ]);
          return {
            status: "expired",
            intervalSeconds: authorization.poll_interval_seconds,
          };
        }
        if (authorization === undefined) {
          return client.rollback({ status: "expired" as const, intervalSeconds: 5 });
        }
        if (
          authorization.status === "denied" ||
          authorization.status === "expired" ||
          authorization.status === "disclosed"
        ) {
          return {
            status: authorization.status,
            intervalSeconds: authorization.poll_interval_seconds,
          };
        }
        if (authorization.next_poll_at > authorization.database_now) {
          const intervalSeconds = authorization.poll_interval_seconds + 5;
          await client.query(
            `update cli_authorizations
           set poll_interval_seconds = $2::integer,
               next_poll_at = now() + ($2::integer * interval '1 second')
           where id = $1`,
            [authorization.id, intervalSeconds],
          );
          return { status: "slow_down", intervalSeconds };
        }
        await client.query(
          `update cli_authorizations
         set next_poll_at = now() + (poll_interval_seconds * interval '1 second')
         where id = $1`,
          [authorization.id],
        );
        if (authorization.status === "approved") {
          await client.query(
            `insert into organization_cli_credentials
             (id, organization_id, prefix, verifier, created_by_user_id)
           values ($1, $2, $3, $4, $5)`,
            [
              input.credential.id,
              authorization.approved_organization_id,
              input.credential.prefix,
              input.credential.verifier,
              authorization.approved_by_user_id,
            ],
          );
          await client.query(
            `update cli_authorizations set status = 'disclosed', credential_id = $2 where id = $1`,
            [authorization.id, input.credential.id],
          );
          return {
            status: "authorized",
            intervalSeconds: authorization.poll_interval_seconds,
            organizationId: authorization.approved_organization_id!,
          };
        }
        return {
          status: authorization.status,
          intervalSeconds: authorization.poll_interval_seconds,
        };
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async enrollDaemon(input: EnrollDaemonInput) {
    let requestedSlug: string | undefined;
    try {
      return await this.pool.transaction(async (client) => {
        const existing = await client.query<DaemonRow>(
          `select * from daemons where idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (
          existing.rows[0] &&
          existing.rows[0].id === input.daemonId &&
          existing.rows[0].enrollment_verifier === input.tokenVerifier
        ) {
          return toDaemon(existing.rows[0]);
        }
        const token = await client.query<{
          id: string;
          organization_id: string | null;
          issued_by_api_key_id: string | null;
          issued_by_cli_credential_id: string | null;
        }>(
          `update daemon_enrollment_tokens
         set consumed_at = $2
         where verifier = $1 and organization_id is not null and consumed_at is null
           and expires_at > $2
         returning id, organization_id, issued_by_api_key_id, issued_by_cli_credential_id`,
          [input.tokenVerifier, input.now],
        );
        const consumedToken = token.rows[0];
        if (consumedToken?.organization_id === null || consumedToken === undefined)
          return client.rollback(undefined);
        const machine = await client.query<MachineRow>(
          `insert into machines (org_id, source, status) values ($1, $2, 'alive') returning *`,
          [consumedToken.organization_id, { kind: "daemon", daemonId: input.daemonId }],
        );
        const suggestedSlug = input.suggestedSlug ?? `daemon-${input.daemonId.slice(0, 8)}`;
        requestedSlug = suggestedSlug;
        let daemon = await client.query<DaemonRow>(
          `insert into daemons
           (id, idempotency_key, enrollment_verifier, slug, machine_id, organization_id, server_id,
            daemon_public_key, credential_verifier, scopes,
            registered_by_api_key_id, registered_by_cli_credential_id, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
         on conflict (organization_id, slug) do nothing
         returning *`,
          [
            input.daemonId,
            input.idempotencyKey,
            input.tokenVerifier,
            suggestedSlug,
            machine.rows[0]!.id,
            consumedToken.organization_id,
            input.serverId,
            input.daemonPublicKey,
            input.credentialVerifier,
            JSON.stringify(input.scopes),
            consumedToken.issued_by_api_key_id,
            consumedToken.issued_by_cli_credential_id,
          ],
        );
        if (daemon.rows[0] === undefined) {
          const uniqueSlug = `${suggestedSlug}-${input.daemonId.slice(0, 8)}`;
          requestedSlug = uniqueSlug;
          daemon = await client.query<DaemonRow>(
            `insert into daemons
             (id, idempotency_key, enrollment_verifier, slug, machine_id, organization_id, server_id,
              daemon_public_key, credential_verifier, scopes,
              registered_by_api_key_id, registered_by_cli_credential_id, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active') returning *`,
            [
              input.daemonId,
              input.idempotencyKey,
              input.tokenVerifier,
              uniqueSlug,
              machine.rows[0]!.id,
              consumedToken.organization_id,
              input.serverId,
              input.daemonPublicKey,
              input.credentialVerifier,
              JSON.stringify(input.scopes),
              consumedToken.issued_by_api_key_id,
              consumedToken.issued_by_cli_credential_id,
            ],
          );
        }
        return toDaemon(daemon.rows[0]!);
      });
    } catch (error) {
      if (requestedSlug !== undefined && isDaemonSlugConflict(error)) {
        return { status: "slug_conflict" as const, slug: requestedSlug };
      }
      throw toDatabaseError(error);
    }
  }

  async findDaemonBySlugForOrganization(
    organizationId: string,
    slug: string,
  ): Promise<DaemonRecord | undefined> {
    const rows = await query<DaemonRow>(
      this.pool,
      `select daemons.* from daemons
       join machines on machines.id = daemons.machine_id
       where machines.org_id = $1 and daemons.slug = $2
       limit 2`,
      [organizationId, slug],
    );
    if (rows.rows.length > 1) {
      throw new Error("daemon organization slug invariant violated");
    }
    return rows.rows[0] ? toDaemon(rows.rows[0]) : undefined;
  }

  async findDaemonById(id: string): Promise<DaemonRecord | undefined> {
    const rows = await query<DaemonRow>(this.pool, `select * from daemons where id = $1`, [id]);
    return rows.rows[0] ? toDaemon(rows.rows[0]) : undefined;
  }

  async findDaemonForOrganization(
    organizationId: string,
    id: string,
  ): Promise<DaemonRecord | undefined> {
    const rows = await query<DaemonRow>(
      this.pool,
      `select daemons.*
       from daemons
       inner join machines on machines.id = daemons.machine_id
       where daemons.id = $1 and machines.org_id = $2
       limit 1`,
      [id, organizationId],
    );
    return rows.rows[0] ? toDaemon(rows.rows[0]) : undefined;
  }

  async listDaemonsForOrganization(organizationId: string): Promise<DaemonRecord[]> {
    const rows = await query<DaemonRow>(
      this.pool,
      `select daemons.* from daemons
       join machines on machines.id = daemons.machine_id
       where machines.org_id = $1
       order by lower(daemons.slug), daemons.id`,
      [organizationId],
    );
    return rows.rows.map(toDaemon);
  }

  async renameDaemonForOrganization(organizationId: string, id: string, slug: string) {
    try {
      const rows = await query<DaemonRow>(
        this.pool,
        `update daemons set slug = $3
         from machines
         where daemons.id = $2 and machines.id = daemons.machine_id and machines.org_id = $1
         returning daemons.*`,
        [organizationId, id, slug],
      );
      return rows.rows[0] === undefined ? undefined : toDaemon(rows.rows[0]);
    } catch (error) {
      if (isDaemonSlugConflict(error)) return { status: "slug_conflict" as const, slug };
      throw toDatabaseError(error);
    }
  }

  async touchDaemon(id: string): Promise<void> {
    await query(this.pool, `update daemons set last_seen_at = now() where id = $1`, [id]);
  }

  async setDaemonPresence(id: string, presence: "offline" | "connected"): Promise<void> {
    await query(
      this.pool,
      `update daemons set presence = $2, connected_at = case when $2 = 'connected' then now() else connected_at end, disconnected_at = case when $2 = 'offline' then now() else disconnected_at end where id = $1`,
      [id, presence],
    );
  }

  async revokeDaemon(id: string): Promise<boolean> {
    const rows = await query(
      this.pool,
      `update daemons set status = 'revoked', presence = 'offline', disconnected_at = now() where id = $1 and status = 'active' returning id`,
      [id],
    );
    return rows.rowCount === 1;
  }

  async attachAgentToExecution(
    executionId: string,
    daemonId: string,
    agentId: string,
  ): Promise<AgentExecutionRecord> {
    const rows = await query<AgentExecutionRow>(
      this.pool,
      `update agent_executions set daemon_id = $2, daemon_agent_id = $3 where id = $1 returning *`,
      [executionId, daemonId, agentId],
    );
    if (!rows.rows[0]) throw new Error(`agent execution not found: ${executionId}`);
    return toAgentExecutionRecord(rows.rows[0]);
  }

  async setAgentExecutionIdleDeadline(
    executionId: string,
    idleDeadlineAt: Date | null,
    observedAt: Date,
    processedAt: Date,
  ): Promise<AgentExecutionRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const existingRows = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1`,
          [executionId],
        );
        const existing = existingRows.rows[0];
        if (existing === undefined) throw new Error(`agent execution not found: ${executionId}`);

        let workflowRefreshAllowed = true;
        if (existing.workflow_step_run_id !== null) {
          const stepRows = await client.query<WorkflowStepRunRow>(
            `select * from workflow_step_runs where id = $1`,
            [existing.workflow_step_run_id],
          );
          const stepCandidate = stepRows.rows[0];
          if (stepCandidate !== undefined) {
            const runRows = await client.query<TriggerRunRow>(
              `select * from trigger_runs where id = $1 for update`,
              [stepCandidate.trigger_run_id],
            );
            const lockedStepRows = await client.query<WorkflowStepRunRow>(
              `select * from workflow_step_runs where id = $1 for update`,
              [stepCandidate.id],
            );
            const step = lockedStepRows.rows[0];
            const run = runRows.rows[0];
            workflowRefreshAllowed =
              step !== undefined &&
              step.status === "running" &&
              run !== undefined &&
              run.status === "running" &&
              (run.deadline_at === null || run.deadline_at > processedAt);
          } else {
            workflowRefreshAllowed = false;
          }
        }

        let row: AgentExecutionRow | undefined;
        if (workflowRefreshAllowed) {
          const rows = await client.query<AgentExecutionRow>(
            `update agent_executions
           set idle_deadline_at = case
             when $2::timestamptz is null then null
             when deadline_at is null then $2::timestamptz
             else least(deadline_at, $2::timestamptz)
           end
           where id = $1 and status in ('spawning', 'running')
             and ($3::timestamptz is null or deadline_at is null or deadline_at > $3)
             and (idle_deadline_at is null or idle_deadline_at > $4)
           returning *`,
            [executionId, idleDeadlineAt, processedAt, observedAt],
          );
          row = rows.rows[0];
        }
        if (row !== undefined && row.workflow_step_run_id !== null) {
          await client.query(
            `update workflow_step_runs
           set idle_deadline_at = $2
           where id = $1 and status = 'running'`,
            [row.workflow_step_run_id, row.idle_deadline_at],
          );
        }
        const current =
          row === undefined
            ? ((
                await client.query<AgentExecutionRow>(
                  `select * from agent_executions where id = $1`,
                  [executionId],
                )
              ).rows[0] ?? existing)
            : row;
        return toAgentExecutionRecord(current);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async prepareAgentExecutionForDispatch(
    executionId: string,
    daemonId: string,
    machineId: string,
    completionTokenHash: string,
  ): Promise<AgentExecutionRecord> {
    const rows = await query<AgentExecutionRow>(
      this.pool,
      `update agent_executions
       set daemon_id = $2, machine_id = $3,
           completion_token_hash = coalesce(completion_token_hash, $4)
       where id = $1 and status in ('spawning', 'running')
       returning *`,
      [executionId, daemonId, machineId, completionTokenHash],
    );
    if (rows.rows[0] !== undefined) return toAgentExecutionRecord(rows.rows[0]);
    const execution = await this.findAgentExecutionById(executionId);
    if (execution === undefined) throw new Error(`agent execution not found: ${executionId}`);
    return execution;
  }

  async findAgentExecutionById(id: string): Promise<AgentExecutionRecord | undefined> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        "select * from agent_executions where id = $1 limit 1",
        [id],
      );

      return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async setAgentExecutionReactionState(
    executionId: string,
    reactionState: JsonValue | null,
  ): Promise<AgentExecutionRecord> {
    const rows = await query<AgentExecutionRow>(
      this.pool,
      `update agent_executions
       set reaction_state = $2
       where id = $1
       returning *`,
      [executionId, reactionState],
    );
    const row = rows.rows[0];
    if (row === undefined) throw new Error(`agent execution not found: ${executionId}`);
    return toAgentExecutionRecord(row);
  }

  async findAgentExecutionForOrganization(
    organizationId: string,
    id: string,
  ): Promise<AgentExecutionRecord | undefined> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `select * from agent_executions
         where id = $1 and organization_id = $2 limit 1`,
        [id, organizationId],
      );

      return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findAgentExecutionForProject(projectId: string, id: string) {
    const rows = await query<AgentExecutionRow>(
      this.pool,
      `select * from agent_executions where id = $1 and project_id = $2 limit 1`,
      [id, projectId],
    );
    return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
  }

  async updateTriggerRunValues(triggerRunId: string, values: unknown): Promise<TriggerRunRecord> {
    const rows = await query<TriggerRunRow>(
      this.pool,
      `update trigger_runs set values = $2 where id = $1 returning *`,
      [triggerRunId, values],
    );
    const row = rows.rows[0];
    if (row === undefined) throw new Error(`trigger run not found: ${triggerRunId}`);
    return toTriggerRunRecord(row);
  }

  async listProjectActivityRuns(
    projectId: string,
    limit: number,
  ): Promise<ProjectActivityRunListRecord[]> {
    const rows = await query<ProjectActivityRunListRow>(
      this.pool,
      `select runs.*, receipts.provider, receipts.connection_id, receipts.resource_id,
              receipts.delivery_id, receipts.signature_hash, receipts.provider_application_id,
              receipts.provider_configuration_version, receipts.source, receipts.repo,
              receipts.received_at, receipts.dropped_reason
       from trigger_runs runs
       join provider_event_receipts receipts
         on receipts.id = runs.provider_event_receipt_id
        and receipts.organization_id = runs.organization_id
       where runs.project_id = $1
       order by runs.created_at desc, runs.id desc
       limit $2`,
      [projectId, limit],
    );
    return rows.rows.map((row) => this.toProjectActivityRunList(row));
  }

  async findProjectActivityRun(projectId: string, runId: string) {
    const rows = await query<ProjectActivityRunRow>(
      this.pool,
      `select runs.*, receipts.provider, receipts.connection_id, receipts.resource_id,
              receipts.delivery_id, receipts.signature_hash, receipts.provider_application_id,
              receipts.provider_configuration_version, receipts.source, receipts.repo,
              receipts.payload, receipts.received_at, receipts.dropped_reason,
              receipts.accepted_routes
       from trigger_runs runs
       join provider_event_receipts receipts
         on receipts.id = runs.provider_event_receipt_id
        and receipts.organization_id = runs.organization_id
       where runs.project_id = $1 and runs.id = $2
       limit 1`,
      [projectId, runId],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : this.toProjectActivityRun(row);
  }

  private async toProjectActivityRun(
    row: ProjectActivityRunRow,
  ): Promise<ProjectActivityRunRecord> {
    const steps = await query<WorkflowStepRunRow>(
      this.pool,
      `select * from workflow_step_runs where trigger_run_id = $1 order by ordinal`,
      [row.id],
    );
    return {
      run: toTriggerRunRecord(row),
      receipt: toProviderEventReceiptRecord(row),
      steps: steps.rows.map(toWorkflowStepRunRecord),
    };
  }

  private toProjectActivityRunList(row: ProjectActivityRunListRow): ProjectActivityRunListRecord {
    return {
      run: toTriggerRunRecord(row),
      receipt: toProviderEventReceiptSummary(row),
    };
  }

  async beginAgentExecutionOutput(
    executionId: string,
    outputType: string,
    maxOutputs: number,
    startedAt: Date,
  ): Promise<AgentExecutionOutputAttempt | undefined> {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1 for update`,
          [executionId],
        );
        const row = selected.rows[0];
        if (row === undefined) {
          return undefined;
        }
        const execution = toAgentExecutionRecord(row);
        const activeAttempts = Object.values(execution.outputDeliveryAttempts).filter(
          (attempt) =>
            attempt.outputType === outputType &&
            attempt.status === "pending" &&
            attempt.leaseExpiresAt > startedAt,
        ).length;
        if (
          maxOutputs < 1 ||
          (execution.status !== "spawning" && execution.status !== "running") ||
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
        await client.query(
          `update agent_executions
         set output_delivery_attempts = $2::jsonb
         where id = $1`,
          [
            executionId,
            JSON.stringify({
              ...execution.outputDeliveryAttempts,
              [attempt.id]: attempt,
            }),
          ],
        );
        return attempt;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async completeAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    completedAt: Date,
  ): Promise<AgentExecutionRecord | undefined> {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1 for update`,
          [executionId],
        );
        const row = selected.rows[0];
        if (row === undefined) {
          return undefined;
        }
        const execution = toAgentExecutionRecord(row);
        const attempt = execution.outputDeliveryAttempts[attemptId];
        if (attempt === undefined) {
          return undefined;
        }
        if (attempt.status === "succeeded") {
          return execution;
        }
        if (attempt.status !== "pending") {
          return undefined;
        }
        if (attempt.leaseExpiresAt <= completedAt) {
          await client.query(
            `update agent_executions
           set output_delivery_attempts = $2::jsonb
           where id = $1`,
            [
              executionId,
              JSON.stringify({
                ...execution.outputDeliveryAttempts,
                [attemptId]: { ...attempt, status: "failed" as const, completedAt: null },
              }),
            ],
          );
          return undefined;
        }
        const outputEmissions = {
          ...execution.outputEmissions,
          [attempt.outputType]: (execution.outputEmissions[attempt.outputType] ?? 0) + 1,
        };
        const updated = await client.query<AgentExecutionRow>(
          `update agent_executions
         set output_emissions = $2::jsonb,
             output_delivery_attempts = $3::jsonb
         where id = $1
         returning *`,
          [
            executionId,
            JSON.stringify(outputEmissions),
            JSON.stringify({
              ...execution.outputDeliveryAttempts,
              [attemptId]: { ...attempt, status: "succeeded" as const, completedAt },
            }),
          ],
        );
        return updated.rows[0] === undefined ? undefined : toAgentExecutionRecord(updated.rows[0]);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async failAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    _failedAt: Date,
  ): Promise<boolean> {
    try {
      return await this.pool.transaction(async (client) => {
        const selected = await client.query<AgentExecutionRow>(
          `select * from agent_executions where id = $1 for update`,
          [executionId],
        );
        const row = selected.rows[0];
        if (row === undefined) {
          return false;
        }
        const execution = toAgentExecutionRecord(row);
        const attempt = execution.outputDeliveryAttempts[attemptId];
        if (attempt === undefined || attempt.status !== "pending") {
          return false;
        }
        await client.query(
          `update agent_executions
         set output_delivery_attempts = $2::jsonb
         where id = $1`,
          [
            executionId,
            JSON.stringify({
              ...execution.outputDeliveryAttempts,
              [attemptId]: { ...attempt, status: "failed" as const, completedAt: null },
            }),
          ],
        );
        return true;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async transitionAgentExecution(
    id: string,
    toStatus: AgentExecutionStatus,
    fields: TransitionAgentExecutionFields = {},
  ): Promise<TransitionAgentExecutionResult> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `
          update agent_executions
          set
            status = $2,
            completed_at = case
              when $2 = any($3::agent_execution_status[]) then now()
              else completed_at
            end,
            result = case when $4::boolean then $5 else result end,
            completed_by_agent_at = case
              when $6::boolean and $2 = 'succeeded'::agent_execution_status then now()
              else completed_by_agent_at
            end,
            idle_deadline_at = case
              when $2 = any($3::agent_execution_status[]) then null
              else idle_deadline_at
            end,
            hub_action = case when $10::boolean then $11 else hub_action end,
            hub_action_completed_at = case
              when $10::boolean and $11::text is null then now()
              when $10::boolean then null
              else hub_action_completed_at
            end
          where id = $1
            and status in ('spawning', 'running')
            and (
              $7::text is null
              or ($7 = 'hard' and deadline_at = $8 and deadline_at <= $9)
              or ($7 = 'idle' and idle_deadline_at = $8 and idle_deadline_at <= $9)
            )
          returning *
        `,
        [
          id,
          toStatus,
          TERMINAL_AGENT_EXECUTION_STATUSES,
          fields.result !== undefined,
          fields.result ?? null,
          fields.completedByAgent === true,
          fields.deadlineCondition?.kind ?? null,
          fields.deadlineCondition?.deadlineAt ?? null,
          fields.deadlineCondition?.observedAt ?? null,
          fields.hubAction !== undefined,
          fields.hubAction ?? null,
        ],
      );
      const execution = rows.rows[0];

      if (execution === undefined) {
        const existing = await this.findAgentExecutionById(id);
        if (existing === undefined) {
          throw new Error(`agent execution not found: ${id}`);
        }

        return { execution: existing, transitioned: false };
      }

      return {
        execution: toAgentExecutionRecord(execution),
        transitioned: true,
      };
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findRunningAgentExecutionsForMachine(machineId: string): Promise<AgentExecutionRecord[]> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `
          select *
          from agent_executions
          where machine_id = $1
            and status in ('spawning', 'running')
          order by started_at asc
        `,
        [machineId],
      );

      return rows.rows.map(toAgentExecutionRecord);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findPendingAgentExecutions(): Promise<AgentExecutionRecord[]> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        "select * from agent_executions where status in ('spawning', 'running') order by started_at asc",
      );
      return rows.rows.map(toAgentExecutionRecord);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findPendingHubActions(daemonId?: string): Promise<AgentExecutionRecord[]> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `select * from agent_executions
         where hub_action is not null
           and hub_action_completed_at is null
           and ($1::uuid is null or daemon_id = $1)
         order by completed_at asc`,
        [daemonId ?? null],
      );
      return rows.rows.map(toAgentExecutionRecord);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async markAgentExecutionHubActionReady(
    executionId: string,
    observedAt = new Date(),
  ): Promise<AgentExecutionRecord | undefined> {
    try {
      const rows = await query<AgentExecutionRow>(
        this.pool,
        `update agent_executions
           set hub_action_ready_at = $2
           where id = $1
             and status = 'succeeded'
             and completed_by_agent_at is not null
             and hub_action = 'archive'
             and hub_action_completed_at is null
             and hub_action_ready_at is null
             and hub_action_acknowledgements->>'terminal_at' is not null
             and hub_action_acknowledgements->>'idle_at' is not null
             and hub_action_acknowledgements->'finish_execution_call'->>'status' = 'completed'
         returning *`,
        [executionId, observedAt],
      );
      return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async recordAgentExecutionHubAcknowledgement(
    executionId: string,
    acknowledgement: AgentExecutionHubAcknowledgementInput,
  ): Promise<AgentExecutionRecord | undefined> {
    try {
      const state = `coalesce(hub_action_acknowledgements, '{"terminal_at":null,"idle_at":null,"finish_execution_call":null}'::jsonb)`;
      let statement: string;
      let parameters: unknown[];
      if (acknowledgement.kind === "terminal" || acknowledgement.kind === "idle") {
        const field = acknowledgement.kind === "terminal" ? "terminal_at" : "idle_at";
        statement = `
          update agent_executions
          set hub_action_acknowledgements = jsonb_set(
            ${state},
            '{${field}}',
            case
              when ${state}->>'${field}' is null
                or (${state}->>'${field}')::timestamptz < $2::timestamptz
                then to_jsonb($2::timestamptz)
              else ${state}->'${field}'
            end,
            true
          )
          where id = $1
            and (
              ${state}->>'${field}' is null
              or (${state}->>'${field}')::timestamptz < $2::timestamptz
            )
          returning *`;
        parameters = [executionId, acknowledgement.observedAt];
      } else {
        statement = `
          update agent_executions
          set hub_action_acknowledgements = jsonb_set(
            ${state},
            '{finish_execution_call}',
            jsonb_build_object(
              'call_id', $3::text,
              'status', $4::text,
              'observed_at', $2::timestamptz
            ),
            true
          )
          where id = $1
            and (
              ${state}->'finish_execution_call'->>'observed_at' is null
              or (
                ${state}->'finish_execution_call'->>'status' <> 'completed'
                and (
                  $4::text = 'completed'
                  or (${state}->'finish_execution_call'->>'observed_at')::timestamptz < $2::timestamptz
                )
              )
            )
          returning *`;
        parameters = [
          executionId,
          acknowledgement.observedAt,
          acknowledgement.callId ?? null,
          acknowledgement.status,
        ];
      }
      const rows = await query<AgentExecutionRow>(this.pool, statement, parameters);
      return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async completeHubAction(executionId: string, action: "interrupt" | "archive"): Promise<boolean> {
    try {
      const rows = await query(
        this.pool,
        `update agent_executions
         set hub_action_completed_at = now()
         where id = $1 and hub_action = $2 and hub_action_completed_at is null
         returning id`,
        [executionId, action],
      );
      return rows.rowCount === 1;
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const rows = await query<ProjectRow>(
      this.pool,
      `insert into projects (organization_id, name, slug, created_by_user_id)
       select $1, $2, $3, $4
       where $4::text is null or exists (
         select 1 from member where organization_id = $1 and user_id = $4
       )
       returning *`,
      [input.organizationId, input.name, input.slug, input.createdByUserId],
    );
    const project = rows.rows[0];
    if (project === undefined) throw new Error("project access denied");
    await query(
      this.pool,
      `insert into project_configuration_sources
         (project_id, organization_id, kind, automatic_deployment_enabled, selected_by_user_id)
       values ($1, $2, 'manual', false, $3)`,
      [project.id, input.organizationId, input.createdByUserId],
    );
    return toProjectRecord(project);
  }

  async restoreProject(organizationId: string, projectId: string): Promise<ProjectRecord> {
    const rows = await query<ProjectRow>(
      this.pool,
      `update projects
       set status = 'active', archived_at = null, updated_at = clock_timestamp()
       where organization_id = $1 and id = $2
       returning *`,
      [organizationId, projectId],
    );
    const project = rows.rows[0];
    if (project === undefined) throw new Error("project not found");
    return toProjectRecord(project);
  }

  async getOrganizationEntitlements(
    organizationId: string,
  ): Promise<OrganizationEntitlementsRecord | undefined> {
    const rows = await query<OrganizationEntitlementsRow>(
      this.pool,
      `select * from organization_entitlements where organization_id = $1 limit 1`,
      [organizationId],
    );
    return rows.rows[0] === undefined ? undefined : toOrganizationEntitlementsRecord(rows.rows[0]);
  }

  async stampOrganizationEntitlements(
    input: StampOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const record = await stampEntitlementsWithinTransaction(client, input);
        return record;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async overrideOrganizationEntitlements(
    input: OverrideOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const existing = await client.query<OrganizationEntitlementsRow>(
          `select * from organization_entitlements where organization_id = $1 for update`,
          [input.organizationId],
        );
        const before = existing.rows[0];
        if (before === undefined) {
          throw new Error(`organization has no entitlements record: ${input.organizationId}`);
        }
        // Merge the patch against the row we hold locked, so a concurrent override serializes
        // behind this one instead of reading a stale base and clobbering its keys.
        const overrides = mergeOverrides(
          entitlementOverridesSchema.parse(before.overrides),
          input.patch,
        );
        const updated = await client.query<OrganizationEntitlementsRow>(
          `update organization_entitlements
           set overrides = $2::jsonb, updated_at = now()
         where organization_id = $1
         returning *`,
          [input.organizationId, JSON.stringify(overrides)],
        );
        const after = updated.rows[0];
        if (after === undefined) throw new Error("entitlements override returned no row");
        await client.query(
          `insert into entitlement_changes (organization_id, actor, source, before, after, reason)
         values ($1, $2, 'override', $3::jsonb, $4::jsonb, $5)`,
          [
            input.organizationId,
            input.actor,
            JSON.stringify(entitlementSnapshot(before)),
            JSON.stringify(entitlementSnapshot(after)),
            input.reason,
          ],
        );
        return toOrganizationEntitlementsRecord(after);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async clearOrganizationEntitlementsOverride(
    input: ClearOrganizationEntitlementsOverrideInput,
  ): Promise<OrganizationEntitlementsRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const existing = await client.query<OrganizationEntitlementsRow>(
          `select * from organization_entitlements where organization_id = $1 for update`,
          [input.organizationId],
        );
        const before = existing.rows[0];
        if (before === undefined) {
          throw new Error(`organization has no entitlements record: ${input.organizationId}`);
        }
        // Remove the key from the row we hold locked, the same lock the merge takes, so a clear and
        // a concurrent override serialize instead of racing on a stale base.
        const overrides = clearOverrideKey(
          entitlementOverridesSchema.parse(before.overrides),
          input.key,
        );
        const updated = await client.query<OrganizationEntitlementsRow>(
          `update organization_entitlements
           set overrides = $2::jsonb, updated_at = now()
         where organization_id = $1
         returning *`,
          [input.organizationId, JSON.stringify(overrides)],
        );
        const after = updated.rows[0];
        if (after === undefined) throw new Error("entitlements override clear returned no row");
        await client.query(
          `insert into entitlement_changes (organization_id, actor, source, before, after, reason)
         values ($1, $2, 'override', $3::jsonb, $4::jsonb, $5)`,
          [
            input.organizationId,
            input.actor,
            JSON.stringify(entitlementSnapshot(before)),
            JSON.stringify(entitlementSnapshot(after)),
            input.reason,
          ],
        );
        return toOrganizationEntitlementsRecord(after);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async listEntitlementChanges(
    organizationId: string,
    limit: number,
  ): Promise<EntitlementChangeRecord[]> {
    const rows = await query<EntitlementChangeRow>(
      this.pool,
      `select change.id, change.organization_id, change.actor, actor_user.name as actor_name,
              change.source, change.before, change.after, change.reason, change.created_at
       from entitlement_changes change
       left join "user" actor_user on actor_user.id = change.actor
       where change.organization_id = $1
       order by change.created_at desc, change.id desc
       limit $2`,
      [organizationId, limit],
    );
    return rows.rows.map(toEntitlementChangeRecord);
  }

  async listOrganizationsForOperator(): Promise<OperatorOrganizationRecord[]> {
    const rows = await query<OperatorOrganizationRow>(
      this.pool,
      `select id, name, slug from organization order by lower(name), id`,
    );
    return rows.rows.map(toOperatorOrganizationRecord);
  }

  async findOrganizationForOperator(slug: string): Promise<OperatorOrganizationRecord | undefined> {
    const rows = await query<OperatorOrganizationRow>(
      this.pool,
      `select id, name, slug from organization where slug = $1 limit 1`,
      [slug],
    );
    return rows.rows[0] === undefined ? undefined : toOperatorOrganizationRecord(rows.rows[0]);
  }

  async consumeOrganizationUsage(
    input: ConsumeOrganizationUsageInput,
  ): Promise<OrganizationUsageRecord | undefined> {
    return reserveOrganizationUsageOnClient(this.pool, input);
  }

  async getOrganizationUsage(
    organizationId: string,
    meter: string,
    periodStart: Date,
  ): Promise<OrganizationUsageRecord | undefined> {
    const rows = await query<OrganizationUsageRow>(
      this.pool,
      `select * from organization_usage
       where organization_id = $1 and meter = $2 and period_start = $3
       limit 1`,
      [organizationId, meter, periodStart],
    );
    return rows.rows[0] === undefined ? undefined : toOrganizationUsageRecord(rows.rows[0]);
  }

  async syncBillingPlan(input: SyncBillingPlanInput): Promise<BillingPlanRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const planRow = await client.query<BillingPlanRow>(
          `insert into billing_plans (id, slug, name, template, template_hash, marketing, active, synced_at)
         values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, now())
         on conflict (id) do update
           set slug = excluded.slug,
               name = excluded.name,
               template = excluded.template,
               template_hash = excluded.template_hash,
               marketing = excluded.marketing,
               active = excluded.active,
               synced_at = now()
         returning *`,
          [
            input.id,
            input.slug,
            input.name,
            JSON.stringify(input.template),
            input.templateHash,
            JSON.stringify(input.marketing),
            input.active,
          ],
        );
        const plan = planRow.rows[0];
        if (plan === undefined) throw new Error("billing plan sync returned no row");
        // Prices are replaced wholesale rather than diffed: the catalog is small and this runs
        // only on boot or a product/price webhook, so a delete-and-reinsert is simple and correct.
        await client.query(`delete from billing_plan_prices where plan_id = $1`, [input.id]);
        const prices: BillingPlanPriceRow[] = [];
        for (const price of input.prices) {
          const priceRow = await client.query<BillingPlanPriceRow>(
            `insert into billing_plan_prices (id, plan_id, lookup_key, interval, unit_amount, currency, active)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
            [
              price.id,
              input.id,
              price.lookupKey,
              price.interval,
              price.unitAmount,
              price.currency,
              price.active,
            ],
          );
          const insertedPrice = priceRow.rows[0];
          if (insertedPrice === undefined)
            throw new Error("billing plan price insert returned no row");
          prices.push(insertedPrice);
        }
        return toBillingPlanRecord(plan, prices);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async deactivateBillingPlansExcept(activeIds: readonly string[]): Promise<void> {
    // An empty snapshot means no Paseo plans remain, so every mirrored plan is deactivated.
    await query(
      this.pool,
      `update billing_plans set active = false where id <> all($1::text[]) and active`,
      [activeIds],
    );
  }

  async listBillingPlans(): Promise<BillingPlanRecord[]> {
    const plans = await query<BillingPlanRow>(
      this.pool,
      `select * from billing_plans order by name`,
      [],
    );
    const prices = await query<BillingPlanPriceRow>(
      this.pool,
      `select * from billing_plan_prices`,
      [],
    );
    const pricesByPlan = new Map<string, BillingPlanPriceRow[]>();
    for (const row of prices.rows) {
      const list = pricesByPlan.get(row.plan_id) ?? [];
      list.push(row);
      pricesByPlan.set(row.plan_id, list);
    }
    return plans.rows.map((row) => toBillingPlanRecord(row, pricesByPlan.get(row.id) ?? []));
  }

  async reconcileOrganizationSubscription(
    input: ReconcileOrganizationSubscriptionInput,
  ): Promise<OrganizationSubscriptionRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const rows = await client.query<OrganizationSubscriptionRow>(
          `insert into organization_subscriptions
           (organization_id, stripe_customer_id, stripe_subscription_id, plan_id, status,
            current_period_end, cancel_at_period_end, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (organization_id) do update
           set stripe_customer_id = excluded.stripe_customer_id,
               stripe_subscription_id = excluded.stripe_subscription_id,
               plan_id = excluded.plan_id,
               status = excluded.status,
               current_period_end = excluded.current_period_end,
               cancel_at_period_end = excluded.cancel_at_period_end,
               updated_at = now()
         returning *`,
          [
            input.organizationId,
            input.stripeCustomerId,
            input.stripeSubscriptionId,
            input.planId,
            input.status,
            input.currentPeriodEnd,
            input.cancelAtPeriodEnd,
          ],
        );
        const row = rows.rows[0];
        if (row === undefined) throw new Error("organization subscription upsert returned no row");
        // Same transaction as the mirror upsert: the plan the org is billed on and the entitlements
        // it enforces can never diverge across a crash between the two writes.
        if (input.stamp !== undefined) {
          await stampEntitlementsWithinTransaction(client, {
            organizationId: input.organizationId,
            ...input.stamp,
          });
        }
        return toOrganizationSubscriptionRecord(row);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.withLock(key, fn);
  }

  async getOrganizationSubscription(
    organizationId: string,
  ): Promise<OrganizationSubscriptionRecord | undefined> {
    const rows = await query<OrganizationSubscriptionRow>(
      this.pool,
      `select * from organization_subscriptions where organization_id = $1`,
      [organizationId],
    );
    return rows.rows[0] === undefined ? undefined : toOrganizationSubscriptionRecord(rows.rows[0]);
  }

  async listProjectsForOrganization(organizationId: string): Promise<ProjectRecord[]> {
    const rows = await query<ProjectRow>(
      this.pool,
      `select * from projects where organization_id = $1 order by name, id`,
      [organizationId],
    );
    return rows.rows.map(toProjectRecord);
  }

  async findProjectForOrganization(organizationId: string, projectId: string) {
    const rows = await query<ProjectRow>(
      this.pool,
      `select * from projects where organization_id = $1 and id = $2 limit 1`,
      [organizationId, projectId],
    );
    return rows.rows[0] === undefined ? undefined : toProjectRecord(rows.rows[0]);
  }

  async findProjectById(projectId: string) {
    const rows = await query<ProjectRow>(this.pool, `select * from projects where id = $1`, [
      projectId,
    ]);
    return rows.rows[0] === undefined ? undefined : toProjectRecord(rows.rows[0]);
  }

  async findProjectBySlugForOrganization(organizationId: string, slug: string) {
    const rows = await query<ProjectRow>(
      this.pool,
      `select * from projects where organization_id = $1 and slug = $2 limit 1`,
      [organizationId, slug],
    );
    return rows.rows[0] === undefined ? undefined : toProjectRecord(rows.rows[0]);
  }

  async resolveTenantRouteAccess(userId: string, organizationSlug: string, projectSlug?: string) {
    const rows = await query<TenantRouteAccessRow>(
      this.pool,
      `select organization.id as organization_id,
              organization.name as organization_name,
              organization.slug as organization_slug,
              member.id as membership_id,
              member.role as membership_role,
              projects.id as project_id,
              projects.organization_id as project_organization_id,
              projects.name as project_name,
              projects.slug as project_slug,
              projects.status as project_status,
              projects.created_by_user_id as project_created_by_user_id,
              projects.created_at as project_created_at,
              projects.updated_at as project_updated_at,
              projects.archived_at as project_archived_at,
              projects.active_configuration_revision_id as project_active_configuration_revision_id
       from organization
       join member on member.organization_id = organization.id and member.user_id = $1
       left join projects on projects.organization_id = organization.id
         and projects.slug = $3 and projects.status = 'active'
       where organization.slug = $2
         and ($3::text is null or projects.id is not null)
       limit 1`,
      [userId, organizationSlug, projectSlug ?? null],
    );
    const row = rows.rows[0];
    if (row === undefined) return undefined;
    return {
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        slug: row.organization_slug,
      },
      membership: { id: row.membership_id, role: row.membership_role },
      ...(row.project_id === null
        ? {}
        : {
            project: toProjectRecord({
              id: row.project_id,
              organization_id: row.project_organization_id!,
              name: row.project_name!,
              slug: row.project_slug!,
              status: row.project_status!,
              created_by_user_id: row.project_created_by_user_id,
              created_at: row.project_created_at!,
              updated_at: row.project_updated_at!,
              archived_at: row.project_archived_at,
              active_configuration_revision_id: row.project_active_configuration_revision_id,
            }),
          }),
    };
  }

  async archiveProject(organizationId: string, projectId: string, userId: string) {
    try {
      return await this.pool.transaction(async (client) => {
        const access = await client.query<ProjectRow>(
          `select projects.*
         from projects
         join member on member.organization_id = projects.organization_id
         where projects.id = $1 and projects.organization_id = $2
           and member.user_id = $3 and member.role in ('owner', 'admin')
         for update of projects`,
          [projectId, organizationId, userId],
        );
        if (access.rows[0] === undefined) throw new Error("project access denied");
        await client.query(
          `update project_configuration_sources
         set kind = 'manual', github_connection_id = null, github_repository_id = null,
             github_repository_full_name = null, github_default_branch = null,
             automatic_deployment_enabled = false, updated_at = clock_timestamp()
         where project_id = $1`,
          [projectId],
        );
        await client.query(`delete from project_trigger_routes where project_id = $1`, [projectId]);
        const archived = await client.query<ProjectRow>(
          `update projects
         set status = 'archived', active_configuration_revision_id = null,
             archived_at = clock_timestamp(), updated_at = clock_timestamp()
         where id = $1 returning *`,
          [projectId],
        );
        await client.query(
          `insert into audit_events
           (organization_id, project_id, actor_kind, actor_identity, action,
            subject_type, subject_id, evidence)
         values ($1, $2, 'user', $3, 'project.archived', 'project', $4,
                 '{"releasedRoutes":true}')`,
          [organizationId, projectId, userId, projectId],
        );
        return toProjectRecord(archived.rows[0]!);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async updateProjectSlug(organizationId: string, projectId: string, slug: string, userId: string) {
    const rows = await query<ProjectRow>(
      this.pool,
      `update projects
       set slug = $3, updated_at = clock_timestamp()
       where id = $2 and organization_id = $1
         and exists (
           select 1 from member
           where organization_id = $1 and user_id = $4 and role in ('owner', 'admin')
         )
       returning *`,
      [organizationId, projectId, slug, userId],
    );
    if (rows.rows[0] === undefined) throw new Error("project access denied");
    return toProjectRecord(rows.rows[0]);
  }

  async insertProjectConfigurationRevision(
    input: InsertProjectConfigurationRevisionInput,
  ): Promise<ProjectConfigurationRevisionRecord> {
    const rows = await query<ProjectConfigurationRevisionRow>(
      this.pool,
      `insert into project_configuration_revisions (
         project_id, organization_id, version, source_kind, source_evidence, raw_yaml,
         normalized_configuration, validation_errors, content_hash,
         created_by_user_id, received_at, validated_at
       ) select
         $1,
         projects.organization_id,
         coalesce((select max(version) + 1 from project_configuration_revisions where project_id = $1), 1),
         $2, $3, $4, $5, $6, $7, $8, clock_timestamp(),
         case when $6::jsonb is null then clock_timestamp() else null end
       from projects
       where projects.id = $1 and projects.status = 'active'
       returning *`,
      [
        input.projectId,
        input.sourceKind,
        input.sourceEvidence,
        input.rawYaml ?? null,
        // A rejected save has no compiled document. The column is not-null, so that is
        // stored as the jsonb value `null` — passing JS null would be SQL NULL.
        input.normalizedConfiguration ?? "null",
        input.validationErrors ?? null,
        input.contentHash,
        input.createdByUserId ?? null,
      ],
    );
    return toProjectConfigurationRevisionRecord(rows.rows[0]!);
  }

  async activateProjectConfigurationRevision(
    projectId: string,
    revisionId: string,
    routes?: readonly ProjectTriggerRoute[],
  ) {
    try {
      return await this.pool.transaction(async (client) => {
        const revision = await lockValidProjectRevision(client, projectId, revisionId);
        const compiledRoutes =
          routes ??
          (
            await client.query<{
              provider: ConnectionProvider;
              connection_id: string;
              resource_id: string | null;
              trigger_name: string;
            }>(
              `select provider, connection_id, resource_id, trigger_name
             from project_trigger_routes where configuration_revision_id = $1`,
              [revisionId],
            )
          ).rows.map((row) => ({
            provider: row.provider,
            connectionId: row.connection_id,
            resourceId: row.resource_id,
            triggerName: row.trigger_name,
          }));
        await client.query(`delete from project_trigger_routes where project_id = $1`, [projectId]);
        for (const route of compiledRoutes) {
          await client.query(
            `insert into project_trigger_routes
             (organization_id, project_id, configuration_revision_id, provider,
              connection_id, resource_id, trigger_name)
           values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              revision.organization_id,
              projectId,
              revisionId,
              route.provider,
              route.connectionId,
              route.resourceId,
              route.triggerName,
            ],
          );
        }
        await client.query(
          `update projects
         set active_configuration_revision_id = $2, updated_at = clock_timestamp()
         where id = $1`,
          [projectId, revisionId],
        );
        await client.query(
          `insert into audit_events
           (organization_id, project_id, actor_kind, actor_identity, action,
            subject_type, subject_id, evidence)
         select organization_id, id, 'system', 'configuration', 'configuration.activated',
                'configuration_revision', $2::text, jsonb_build_object('version', $3::integer)
         from projects where id = $1`,
          [projectId, revisionId, revision.version],
        );
        return toProjectConfigurationRevisionRecord(revision);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findProjectConfigurationRollbackTarget(projectId: string) {
    const candidates = await query<ProjectConfigurationRevisionRow>(
      this.pool,
      `select prior.*
       from projects
       join project_configuration_revisions current
         on current.id = projects.active_configuration_revision_id
       join lateral (
         select * from project_configuration_revisions
         where project_id = projects.id and version < current.version
           and validation_errors is null
         order by version desc limit 1
       ) prior on true
       where projects.id = $1`,
      [projectId],
    );
    return candidates.rows[0] === undefined
      ? undefined
      : toProjectConfigurationRevisionRecord(candidates.rows[0]);
  }

  async rollbackProjectConfiguration(
    projectId: string,
    targetRevisionId: string,
    routes: readonly ProjectTriggerRoute[],
  ) {
    try {
      return await this.pool.transaction(async (client) => {
        const candidates = await client.query<ProjectConfigurationRevisionRow>(
          `select prior.*
         from projects
         join project_configuration_revisions current
           on current.id = projects.active_configuration_revision_id
         join lateral (
           select * from project_configuration_revisions
           where project_id = projects.id and version < current.version
             and validation_errors is null and id = $2
           order by version desc limit 1
         ) prior on true
         where projects.id = $1
         for update of projects`,
          [projectId, targetRevisionId],
        );
        const target = candidates.rows[0];
        if (target === undefined) throw new Error("configuration rollback target changed");
        await client.query(`delete from project_trigger_routes where project_id = $1`, [projectId]);
        for (const route of routes) {
          await client.query(
            `insert into project_trigger_routes
             (organization_id, project_id, configuration_revision_id, provider,
              connection_id, resource_id, trigger_name)
           values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              target.organization_id,
              projectId,
              target.id,
              route.provider,
              route.connectionId,
              route.resourceId,
              route.triggerName,
            ],
          );
        }
        await client.query(
          `update projects set active_configuration_revision_id = $2, updated_at = clock_timestamp()
         where id = $1`,
          [projectId, target.id],
        );
        return toProjectConfigurationRevisionRecord(target);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findActiveProjectConfiguration(projectId: string) {
    const rows = await query<ProjectConfigurationRevisionRow>(
      this.pool,
      `select revisions.*
       from projects
       join project_configuration_revisions revisions
         on revisions.id = projects.active_configuration_revision_id
       where projects.id = $1`,
      [projectId],
    );
    return rows.rows[0] === undefined
      ? undefined
      : toProjectConfigurationRevisionRecord(rows.rows[0]);
  }

  async findProjectConfigurationRevision(projectId: string, revisionId: string) {
    const rows = await query<ProjectConfigurationRevisionRow>(
      this.pool,
      `select * from project_configuration_revisions where project_id = $1 and id = $2`,
      [projectId, revisionId],
    );
    return rows.rows[0] === undefined
      ? undefined
      : toProjectConfigurationRevisionRecord(rows.rows[0]);
  }

  async switchProjectConfigurationToManual(
    input: SwitchProjectConfigurationToManualInput,
  ): Promise<ProjectConfigurationRevisionRecord> {
    try {
      return await this.pool.transaction(async (client) => {
        const project = await client.query<ProjectRow>(
          `select project.*
         from projects project
         join member on member.organization_id = project.organization_id
         where project.id = $1 and project.status = 'active'
           and member.user_id = $2 and member.role in ('owner', 'admin')
           and project.active_configuration_revision_id is not null
         for update of project`,
          [input.projectId, input.userId],
        );
        const projectRow = project.rows[0];
        if (projectRow === undefined) throw new Error("project access denied");
        const inserted = await client.query<ProjectConfigurationRevisionRow>(
          `insert into project_configuration_revisions (
           project_id, organization_id, version, source_kind, source_evidence, raw_yaml,
           normalized_configuration, content_hash, created_by_user_id, received_at, validated_at
         ) values (
           $1, $2,
           coalesce((select max(version) + 1 from project_configuration_revisions where project_id = $1), 1),
           'manual', $3, $4, $5, $6, $7, clock_timestamp(), clock_timestamp()
         ) returning *`,
          [
            input.projectId,
            projectRow.organization_id,
            {
              kind: "authority-switch",
              fromRevisionId: projectRow.active_configuration_revision_id,
              formattingPreserved: true,
              bundle: input.bundle,
            },
            input.rawYaml,
            input.normalizedConfiguration,
            input.contentHash,
            input.userId,
          ],
        );
        const revision = inserted.rows[0]!;
        await client.query(
          `update project_configuration_sources
         set kind = 'manual', github_connection_id = null, github_repository_id = null,
             github_repository_full_name = null, github_default_branch = null,
             automatic_deployment_enabled = false, selected_by_user_id = $2,
             updated_at = clock_timestamp()
         where project_id = $1`,
          [input.projectId, input.userId],
        );
        await client.query(`delete from project_trigger_routes where project_id = $1`, [
          input.projectId,
        ]);
        for (const route of input.routes) {
          await client.query(
            `insert into project_trigger_routes
             (organization_id, project_id, configuration_revision_id, provider,
              connection_id, resource_id, trigger_name)
           values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              revision.organization_id,
              input.projectId,
              revision.id,
              route.provider,
              route.connectionId,
              route.resourceId,
              route.triggerName,
            ],
          );
        }
        await client.query(
          `update projects set active_configuration_revision_id = $2,
             updated_at = clock_timestamp() where id = $1`,
          [input.projectId, revision.id],
        );
        return toProjectConfigurationRevisionRecord(revision);
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async setProjectGitHubConfigurationSource(
    input: SetProjectGitHubConfigurationSourceInput,
  ): Promise<void> {
    const result = await query(
      this.pool,
      `insert into project_configuration_sources
         (organization_id, project_id, kind, github_connection_id, github_repository_id,
          github_repository_full_name, github_default_branch,
          automatic_deployment_enabled, selected_by_user_id)
       select p.organization_id, p.id, 'github', $2, r.repository_id,
              r.full_name, r.default_branch, $4, $5
       from projects p
       join member m on m.organization_id = p.organization_id
       join github_repositories r
         on r.organization_id = p.organization_id and r.connection_id = $2
        and r.repository_id = $3
       join github_connections c
         on c.id = r.connection_id and c.organization_id = p.organization_id
       where p.id = $1 and p.status = 'active'
         and m.user_id = $5 and m.role in ('owner', 'admin')
       on conflict (project_id) do update
         set kind = 'github',
             github_connection_id = excluded.github_connection_id,
             github_repository_id = excluded.github_repository_id,
             github_repository_full_name = excluded.github_repository_full_name,
             github_default_branch = excluded.github_default_branch,
             automatic_deployment_enabled = excluded.automatic_deployment_enabled,
             selected_by_user_id = excluded.selected_by_user_id,
             updated_at = clock_timestamp()
       returning project_id`,
      [
        input.projectId,
        input.githubConnectionId,
        input.githubRepositoryId,
        input.automaticDeploymentEnabled,
        input.userId,
      ],
    );
    if (result.rowCount !== 1) throw new Error("project access denied");
  }

  async recordConfigurationSyncAttempt(
    input: RecordConfigurationSyncAttemptInput,
  ): Promise<ConfigurationSyncAttemptRecord> {
    const result = await query<{
      id: string;
      project_id: string;
      github_connection_id: string | null;
      github_repository_id: number | null;
      webhook_delivery_id: string | null;
      commit_sha: string | null;
      outcome: string;
      evidence: unknown;
      created_at: Date;
    }>(
      this.pool,
      `insert into configuration_sync_attempts
         (organization_id, project_id, github_connection_id, github_repository_id,
          webhook_delivery_id, commit_sha, outcome, evidence)
       select p.organization_id, p.id, $2, $3, $4, $5, $6, $7::jsonb
       from projects p
       where p.id = $1 and p.organization_id = (select organization_id from github_connections where id = $2)
       returning id, project_id, github_connection_id, github_repository_id, webhook_delivery_id,
                 commit_sha, outcome, evidence, created_at`,
      [
        input.projectId,
        input.githubConnectionId,
        input.githubRepositoryId,
        input.webhookDeliveryId,
        input.commitSha,
        input.outcome,
        JSON.stringify(input.evidence),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("configuration source unavailable");
    return {
      id: row.id,
      projectId: row.project_id,
      githubConnectionId: row.github_connection_id,
      githubRepositoryId: row.github_repository_id,
      webhookDeliveryId: row.webhook_delivery_id,
      commitSha: row.commit_sha,
      outcome: row.outcome,
      evidence: row.evidence,
      createdAt: row.created_at,
    };
  }

  async projectConfigurationReadModel(projectId: string): Promise<ProjectConfigurationReadModel> {
    const source = await query<{
      kind: "manual" | "github";
      github_connection_id: string | null;
      github_repository_id: number | null;
      github_repository_full_name: string | null;
      github_default_branch: string | null;
      automatic_deployment_enabled: boolean;
    }>(
      this.pool,
      `select kind, github_connection_id, github_repository_id, github_repository_full_name,
              github_default_branch, automatic_deployment_enabled
       from project_configuration_sources where project_id = $1`,
      [projectId],
    );
    const sourceRow = source.rows[0];
    if (sourceRow === undefined) throw new Error("configuration authority not found");
    const activeRevision = (await this.findActiveProjectConfiguration(projectId)) ?? null;
    const attempts = await query<{
      id: string;
      project_id: string;
      github_connection_id: string | null;
      github_repository_id: number | null;
      webhook_delivery_id: string | null;
      commit_sha: string | null;
      outcome: string;
      evidence: unknown;
      created_at: Date;
    }>(
      this.pool,
      `select * from configuration_sync_attempts
       where project_id = $1 order by created_at desc, id desc limit 1`,
      [projectId],
    );
    const attempt = attempts.rows[0];
    const lastSyncAttempt =
      attempt === undefined
        ? null
        : {
            id: attempt.id,
            projectId: attempt.project_id,
            githubConnectionId: attempt.github_connection_id,
            githubRepositoryId: attempt.github_repository_id,
            webhookDeliveryId: attempt.webhook_delivery_id,
            commitSha: attempt.commit_sha,
            outcome: attempt.outcome,
            evidence: attempt.evidence,
            createdAt: attempt.created_at,
          };
    if (sourceRow.kind === "manual") {
      const evidence = activeRevision?.sourceEvidence;
      const formattingPreserved =
        typeof evidence === "object" &&
        evidence !== null &&
        "formattingPreserved" in evidence &&
        evidence.formattingPreserved === true;
      return {
        authority: "manual",
        activeRevision,
        lastSyncAttempt,
        sourceState: { kind: "manual", formattingPreserved },
      };
    }
    if (
      sourceRow.github_connection_id === null ||
      sourceRow.github_repository_id === null ||
      sourceRow.github_repository_full_name === null ||
      sourceRow.github_default_branch === null
    ) {
      throw new Error("github configuration authority has no repository");
    }
    return {
      authority: "github",
      activeRevision,
      lastSyncAttempt,
      sourceState: {
        kind: "github",
        githubConnectionId: sourceRow.github_connection_id,
        githubRepositoryId: sourceRow.github_repository_id,
        githubRepositoryFullName: sourceRow.github_repository_full_name,
        githubDefaultBranch: sourceRow.github_default_branch,
        automaticDeploymentEnabled: sourceRow.automatic_deployment_enabled,
      },
    };
  }

  async organizationConnectionUsage(organizationId: string): Promise<OrganizationConnectionUsage> {
    const github = await query<{
      id: string;
      organization_id: string;
      slug: string;
      installation_id: number | string;
      account_id: string;
      account_login: string;
      account_type: string;
      status: "active" | "suspended";
      provider_application_id: string | null;
    }>(
      this.pool,
      `select connection.id, connection.organization_id, connection.slug,
              connection.installation_id,
              connection.account_id, connection.account_login, connection.account_type,
              connection.status, connection.provider_application_id
       from github_connections connection
       where connection.organization_id = $1
       order by connection.account_login, connection.id`,
      [organizationId],
    );
    const [discord, slack] = await Promise.all([
      query<{
        id: string;
        organization_id: string;
        slug: string;
        guild_id: string;
        guild_name: string;
        provider_application_id: string | null;
      }>(
        this.pool,
        `select id, organization_id, slug, guild_id, guild_name, provider_application_id
         from discord_connections where organization_id = $1
         order by guild_name, id`,
        [organizationId],
      ),
      query<{
        id: string;
        organization_id: string;
        slug: string;
        team_id: string;
        team_name: string;
        bot_user_id: string;
        bot_access_token: string;
        scopes: unknown;
        provider_application_id: string | null;
      }>(
        this.pool,
        `select id, organization_id, slug, team_id, team_name, bot_user_id, bot_access_token, scopes,
                provider_application_id
         from slack_connections where organization_id = $1
         order by team_name, id`,
        [organizationId],
      ),
    ]);
    return {
      github: github.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        slug: row.slug,
        installationId: Number(row.installation_id),
        accountId: row.account_id,
        accountLogin: row.account_login,
        accountType: row.account_type,
        status: row.status,
        providerApplicationId: row.provider_application_id,
      })),
      discord: discord.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        slug: row.slug,
        guildId: row.guild_id,
        guildName: row.guild_name,
        providerApplicationId: row.provider_application_id,
      })),
      slack: slack.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        slug: row.slug,
        teamId: row.team_id,
        teamName: row.team_name,
        botUserId: row.bot_user_id,
        botAccessToken: row.bot_access_token,
        scopes: stringArray(row.scopes),
        providerApplicationId: row.provider_application_id,
      })),
    };
  }

  async listGitHubRepositories(organizationId: string): Promise<GitHubRepositoryRecord[]> {
    const rows = await query<GitHubRepositoryRow>(
      this.pool,
      `select repository.id, repository.organization_id, repository.connection_id,
              connection.installation_id, repository.repository_id,
              repository.full_name, repository.default_branch
       from github_repositories repository
       join github_connections connection on connection.id = repository.connection_id
       where repository.organization_id = $1
       order by repository.full_name, repository.id`,
      [organizationId],
    );
    return rows.rows.map(toGitHubRepositoryRecord);
  }

  async findGitHubRepositoryForOrganization(organizationId: string, fullName: string) {
    const rows = await query<GitHubRepositoryRow>(
      this.pool,
      `select repository.id, repository.organization_id, repository.connection_id,
              connection.installation_id, repository.repository_id,
              repository.full_name, repository.default_branch
       from github_repositories repository
       join github_connections connection on connection.id = repository.connection_id
       where repository.organization_id = $1 and repository.full_name = $2
       order by repository.id limit 2`,
      [organizationId, fullName],
    );
    if (rows.rows.length > 1) throw new Error("github repository resource is ambiguous");
    return rows.rows[0] === undefined ? undefined : toGitHubRepositoryRecord(rows.rows[0]);
  }

  async upsertGitHubRepositories(
    organizationId: string,
    connectionId: string,
    repositories: Array<
      Pick<GitHubRepositoryRecord, "repositoryId" | "fullName" | "defaultBranch">
    >,
  ): Promise<void> {
    for (const repository of repositories) {
      await query(
        this.pool,
        `insert into github_repositories
           (organization_id, connection_id, repository_id, full_name, default_branch)
         values ($1, $2, $3, $4, $5)
         on conflict (connection_id, repository_id) do update
           set full_name = excluded.full_name,
               default_branch = excluded.default_branch,
               updated_at = clock_timestamp()`,
        [
          organizationId,
          connectionId,
          repository.repositoryId,
          repository.fullName,
          repository.defaultBranch,
        ],
      );
    }
  }

  async findGitHubConfigurationTarget(
    projectId: string,
    repositoryId?: number,
  ): Promise<GitHubConfigurationTarget | undefined> {
    const rows = await query<GitHubConfigurationTargetRow>(
      this.pool,
      `select project.id as project_id,
              repository.id, repository.organization_id, repository.connection_id,
              connection.installation_id,
              repository.repository_id, repository.full_name, repository.default_branch,
              source.automatic_deployment_enabled
       from project_configuration_sources source
       join projects project on project.id = source.project_id and project.status = 'active'
       join github_repositories repository
         on repository.organization_id = project.organization_id
        and repository.connection_id = source.github_connection_id
        and repository.repository_id = source.github_repository_id
       join github_connections connection on connection.id = repository.connection_id
       where source.project_id = $1 and source.kind = 'github'
         and ($2::bigint is null or repository.repository_id = $2)
       limit 1`,
      [projectId, repositoryId ?? null],
    );
    const row = rows.rows[0];
    return row === undefined
      ? undefined
      : {
          ...toGitHubRepositoryRecord(row),
          projectId: row.project_id,
          installationId: Number(row.installation_id),
          automaticDeploymentEnabled: row.automatic_deployment_enabled,
        };
  }

  async listGitHubConfigurationTargets(
    organizationId: string,
    connectionId: string,
    repositoryId: number,
  ): Promise<GitHubConfigurationTarget[]> {
    const rows = await query<GitHubConfigurationTargetRow>(
      this.pool,
      `select project.id as project_id,
              repository.id, repository.organization_id, repository.connection_id,
              connection.installation_id,
              repository.repository_id, repository.full_name, repository.default_branch,
              source.automatic_deployment_enabled
       from project_configuration_sources source
       join projects project
         on project.id = source.project_id
        and project.organization_id = $1
        and project.status = 'active'
       join github_repositories repository
         on repository.organization_id = project.organization_id
        and repository.connection_id = source.github_connection_id
        and repository.repository_id = source.github_repository_id
       join github_connections connection
         on connection.id = repository.connection_id
        and connection.organization_id = project.organization_id
       where source.kind = 'github'
         and source.github_connection_id = $2
         and source.github_repository_id = $3
       order by project.id`,
      [organizationId, connectionId, repositoryId],
    );
    return rows.rows.map((row) =>
      Object.assign(toGitHubRepositoryRecord(row), {
        projectId: row.project_id,
        installationId: Number(row.installation_id),
        automaticDeploymentEnabled: row.automatic_deployment_enabled,
      }),
    );
  }

  async listUnroutedProviderEventsForOrganization(
    organizationId: string,
  ): Promise<ProviderEventReceiptSummary[]> {
    const rows = await query<ProjectActivityRunListRow>(
      this.pool,
      `select receipts.id, receipts.organization_id, receipts.provider, receipts.connection_id,
              receipts.resource_id, receipts.delivery_id, receipts.signature_hash, receipts.source,
              receipts.repo, receipts.received_at, receipts.dropped_reason
       from provider_event_receipts receipts
       where receipts.organization_id = $1
         and receipts.dropped_reason in (
           'no_project_route',
           'no_trigger_for_source',
           'trigger_filters_rejected',
           'configuration_unavailable'
         )
         and not exists (
           select 1 from trigger_runs runs
           where runs.provider_event_receipt_id = receipts.id
         )
       order by receipts.received_at desc, receipts.id desc
       limit 50`,
      [organizationId],
    );
    return rows.rows.map(toProviderEventReceiptSummary);
  }

  async isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
    const rows = await query(
      this.pool,
      `select 1 from member where user_id = $1 and organization_id = $2 limit 1`,
      [userId, organizationId],
    );
    return rows.rowCount === 1;
  }

  startConnectionAttempt(input: StartConnectionAttemptInput): Promise<void> {
    return this.connections.startAttempt(input);
  }

  findConnectionAttemptConfiguration(stateVerifier: string) {
    return this.connections.findAttemptConfiguration(stateVerifier);
  }

  readConnectionAttempt(input: ReadConnectionAttemptInput) {
    return this.connections.readAttempt(input);
  }

  consumeConnectionAttempt(input: ReadConnectionAttemptInput): Promise<void> {
    return this.connections.consumeAttempt(input);
  }

  advanceGitHubConnectionAttempt(input: AdvanceGitHubConnectionAttemptInput): Promise<void> {
    return this.connections.advanceGitHubAttempt(input);
  }

  bindGitHubConnection(input: BindGitHubConnectionInput): Promise<void> {
    return this.connections.bindGitHub(input);
  }

  bindDiscordConnection(input: BindDiscordConnectionInput): Promise<void> {
    return this.connections.bindDiscord(input);
  }

  bindSlackConnection(input: BindSlackConnectionInput): Promise<void> {
    return this.connections.bindSlack(input);
  }

  completeSlackProviderApplication(input: CompleteSlackProviderApplicationInput): Promise<void> {
    return this.connections.completeSlackProviderApplication(input);
  }

  disconnectConnection(
    provider: ConnectionProvider,
    connectionId: string,
    access: ConnectionStartAuthority,
  ) {
    return this.connections.disconnect(provider, connectionId, access);
  }

  findGitHubConnection(installationId: number) {
    return this.connections.findGitHub(installationId);
  }

  findDiscordConnection(guildId: string) {
    return this.connections.findDiscord(guildId);
  }

  findSlackConnection(teamId: string) {
    return this.connections.findSlack(teamId);
  }

  findSlackConnectionForOrganization(organizationId: string, teamId: string) {
    return this.connections.findSlackForOrganization(organizationId, teamId);
  }

  findDiscordConnectionForOrganization(organizationId: string, guildId: string) {
    return this.connections.findDiscordForOrganization(organizationId, guildId);
  }

  removeDiscordConnection(guildId: string): Promise<void> {
    return this.connections.removeDiscord(guildId);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }

  async findProviderEventReceiptById(id: string): Promise<ProviderEventReceiptRecord | undefined> {
    const rows = await query<ProviderEventReceiptRow>(
      this.pool,
      "select * from provider_event_receipts where id = $1 limit 1",
      [id],
    );

    return rows.rows[0] === undefined ? undefined : toProviderEventReceiptRecord(rows.rows[0]);
  }

  async insertAttachment(input: InsertAttachmentInput): Promise<AttachmentRecord> {
    try {
      const rows = await query<AttachmentRow>(
        this.pool,
        `insert into attachment_capabilities (
           provider_event_receipt_id,
           organization_id,
           connection_id,
           provider,
           source_id,
           locator,
           filename,
           content_type,
           byte_size
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (provider_event_receipt_id, provider, source_id) do nothing
         returning *`,
        [
          input.providerEventReceiptId,
          input.organizationId,
          input.connectionId,
          input.provider,
          input.sourceId,
          JSON.stringify(input.locator),
          input.filename,
          input.contentType ?? null,
          input.byteSize ?? null,
        ],
      );
      const inserted = rows.rows[0];
      if (inserted !== undefined) return toAttachmentRecord(inserted);
      const existing = await this.findAttachmentBySource(
        input.providerEventReceiptId,
        input.provider,
        input.sourceId,
      );
      if (existing === undefined) throw new Error("attachment insert conflict without row");
      return existing;
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findAttachmentBySource(
    providerEventReceiptId: string,
    provider: AttachmentProvider,
    sourceId: string,
  ): Promise<AttachmentRecord | undefined> {
    const rows = await query<AttachmentRow>(
      this.pool,
      `select * from attachment_capabilities
       where provider_event_receipt_id = $1 and provider = $2 and source_id = $3 limit 1`,
      [providerEventReceiptId, provider, sourceId],
    );
    return rows.rows[0] === undefined ? undefined : toAttachmentRecord(rows.rows[0]);
  }

  async findAttachmentForExecution(
    executionId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | undefined> {
    const rows = await query<AttachmentRow>(
      this.pool,
      `select attachment.*
       from attachment_capabilities attachment
       join agent_executions execution
         on execution.id = $1
        and execution.organization_id = attachment.organization_id
       join workflow_step_runs step_run
         on step_run.id = execution.workflow_step_run_id
       join trigger_runs trigger_run
         on trigger_run.id = step_run.trigger_run_id
        and trigger_run.provider_event_receipt_id = attachment.provider_event_receipt_id
       where attachment.id = $2 limit 1`,
      [executionId, attachmentId],
    );
    return rows.rows[0] === undefined ? undefined : toAttachmentRecord(rows.rows[0]);
  }
}

async function lockValidProjectRevision(
  client: QueryHandle,
  projectId: string,
  revisionId: string,
): Promise<ProjectConfigurationRevisionRow> {
  const selected = await client.query<ProjectConfigurationRevisionRow>(
    `select revisions.*
     from project_configuration_revisions revisions
     join projects on projects.id = revisions.project_id
     where revisions.id = $2 and revisions.project_id = $1 and projects.status = 'active'
     for update of projects, revisions`,
    [projectId, revisionId],
  );
  const revision = selected.rows[0];
  if (revision === undefined) throw new Error("configuration revision not found");
  if (revision.validation_errors !== null) throw new Error("invalid configuration revision");
  return revision;
}

async function query<T extends QueryRow = QueryRow>(
  pool: QueryHandle,
  text: string,
  values: unknown[] = [],
) {
  return pool.query<T>(text, values);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function isDaemonSlugConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const postgresError = error as { code?: unknown; constraint?: unknown };
  return (
    postgresError.code === "23505" &&
    postgresError.constraint === "daemons_organization_slug_unique"
  );
}

async function insertAgentExecutionOnClient(
  client: QueryHandle,
  input: InsertAgentExecutionInput,
): Promise<AgentExecutionRow> {
  const rows = await client.query<AgentExecutionRow>(
    `insert into agent_executions
       (id, organization_id, project_id, machine_id, daemon_id, status, started_at,
        trigger_context, output_context, configuration_revision_id, completion_token_hash,
        deadline_at, idle_deadline_at, launch_intent, workflow_step_run_id, result, completed_at)
     select coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6::agent_execution_status, coalesce($7, now()), $8, $9, $10, $11,
            $12,
            case
              when $13::timestamptz is null then null
              when $12::timestamptz is null then $13::timestamptz
              else least($12::timestamptz, $13::timestamptz)
            end,
            $14, $15, $16,
            case when $6 = 'failed'::agent_execution_status then coalesce($7, now()) else null end
     from projects
     where projects.id = $3 and projects.organization_id = $2 and projects.status = 'active'
       and exists (
         select 1 from project_configuration_revisions
         where id = $10 and project_id = $3 and organization_id = $2
       )
       and ($5::uuid is null or exists (
         select 1 from daemons daemon
         join machines daemon_machine on daemon_machine.id = daemon.machine_id
         where daemon.id = $5 and daemon_machine.org_id = $2
       ))
       and ($4::uuid is null or exists (select 1 from machines where id = $4 and org_id = $2))
     returning *`,
    [
      input.id ?? null,
      input.organizationId,
      input.projectId,
      input.machineId,
      input.daemonId ?? null,
      input.status ?? "spawning",
      input.startedAt ?? null,
      input.triggerContext,
      input.outputContext,
      input.configurationRevisionId,
      input.completionTokenHash ?? null,
      input.deadlineAt ?? null,
      input.idleDeadlineAt ?? null,
      input.launchIntent ?? null,
      input.workflowStepRunId ?? null,
      input.result ?? null,
    ],
  );
  const execution = rows.rows[0];
  if (execution === undefined) throw new Error("agent execution insert returned no row");
  return execution;
}

const TERMINAL_AGENT_EXECUTION_STATUSES = ["succeeded", "failed"] satisfies AgentExecutionStatus[];

export interface ProviderEventReceiptRow extends QueryRow {
  id: string;
  organization_id: string;
  provider: ProviderEventReceiptRecord["provider"];
  connection_id: string | null;
  resource_id: string | null;
  delivery_id: string;
  signature_hash: string | null;
  provider_application_id: string | null;
  provider_configuration_version: number | null;
  source: string;
  repo: string | null;
  payload: unknown;
  received_at: Date;
  dropped_reason: string | null;
  accepted_routes: unknown;
}

interface TriggerRunRow extends QueryRow {
  id: string;
  organization_id: string;
  project_id: string;
  configuration_revision_id: string;
  provider_event_receipt_id: string;
  configured_trigger_name: string;
  outcome: TriggerRunRecord["outcome"];
  status: TriggerRunRecord["status"];
  prompt: string;
  inputs: unknown;
  values: unknown;
  trigger_context: unknown;
  output_context: unknown;
  deadline_at: Date | null;
  deadline_kind: WorkflowDeadlineKind | null;
  failure_reason: string | null;
  reaction_state: JsonValue | null;
  terminal_notification_pending_at: Date | null;
  terminal_notification_delivered_at: Date | null;
  terminal_notification_lease_expires_at: Date | null;
  rejection: unknown;
  created_at: Date;
  completed_at: Date | null;
}

interface ProjectActivityRunRow extends TriggerRunRow {
  provider: ProviderEventReceiptRecord["provider"];
  connection_id: string | null;
  resource_id: string | null;
  delivery_id: string;
  signature_hash: string | null;
  provider_application_id: string | null;
  provider_configuration_version: number | null;
  source: string;
  repo: string | null;
  payload: unknown;
  received_at: Date;
  dropped_reason: string | null;
  accepted_routes: unknown;
}

interface ProjectActivityRunListRow extends TriggerRunRow {
  provider: ProviderEventReceiptRecord["provider"];
  connection_id: string | null;
  resource_id: string | null;
  delivery_id: string;
  signature_hash: string | null;
  source: string;
  repo: string | null;
  received_at: Date;
  dropped_reason: string | null;
}

interface WorkflowStepRunRow extends QueryRow {
  id: string;
  trigger_run_id: string;
  step_id: string;
  ordinal: number;
  status: WorkflowStepRunRecord["status"];
  agent_execution_id: string | null;
  output: unknown;
  failure_reason: string | null;
  deadline_kind: WorkflowDeadlineKind | null;
  deadline_at: Date | null;
  idle_deadline_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  dispatch_intent: LaunchMachineIntent | null;
}

interface WorkflowWakeupRow extends QueryRow {
  trigger_run_id: string;
  available_at: Date;
  lease_expires_at: Date | null;
}

function toTriggerRunRecord(row: TriggerRunRow): TriggerRunRecord {
  const evidence = {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    configurationRevisionId: row.configuration_revision_id,
    providerEventReceiptId: row.provider_event_receipt_id,
    configuredTriggerName: row.configured_trigger_name,
    prompt: row.prompt,
    inputs: parseInvocationInputs(row.inputs),
    values: row.values,
    triggerContext: row.trigger_context,
    outputContext: row.output_context,
    createdAt: row.created_at,
  };
  if (row.outcome === "rejected") {
    if (row.status !== "rejected" || row.rejection === null || row.rejection === undefined) {
      throw new Error(`invalid rejected trigger run ${row.id}`);
    }
    const rejected: RejectedTriggerRunRecord = {
      ...evidence,
      outcome: "rejected",
      status: "rejected",
      rejection: parseInvocationRejection(row.rejection),
      completedAt: row.completed_at ?? row.created_at,
    };
    return rejected;
  }
  if (row.outcome !== "accepted" || row.status === "rejected" || row.rejection !== null) {
    throw new Error(`invalid accepted trigger run ${row.id}`);
  }
  if (row.deadline_at === null) throw new Error(`invalid accepted trigger run ${row.id}`);
  const accepted: AcceptedTriggerRunRecord = {
    ...evidence,
    outcome: "accepted",
    status: row.status,
    deadlineAt: row.deadline_at,
    deadlineKind: row.deadline_kind,
    failureReason: row.failure_reason,
    reactionState: row.reaction_state,
    terminalNotificationPendingAt: row.terminal_notification_pending_at,
    terminalNotificationDeliveredAt: row.terminal_notification_delivered_at,
    terminalNotificationLeaseExpiresAt: row.terminal_notification_lease_expires_at,
    completedAt: row.completed_at,
  };
  return accepted;
}

function toWorkflowStepRunRecord(row: WorkflowStepRunRow): WorkflowStepRunRecord {
  return {
    id: row.id,
    triggerRunId: row.trigger_run_id,
    stepId: row.step_id,
    ordinal: row.ordinal,
    status: row.status,
    agentExecutionId: row.agent_execution_id,
    output: row.output,
    failureReason: row.failure_reason,
    deadlineKind: row.deadline_kind,
    deadlineAt: row.deadline_at,
    idleDeadlineAt: row.idle_deadline_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    dispatchIntent: row.dispatch_intent,
  };
}

function toWorkflowWakeupRecord(
  row: WorkflowWakeupRow,
  leasedBeforeClaim = false,
): WorkflowWakeupRecord {
  return {
    triggerRunId: row.trigger_run_id,
    availableAt: row.available_at,
    leaseExpiresAt: row.lease_expires_at,
    leasedBeforeClaim,
  };
}

export interface MachineRow extends QueryRow {
  id: string;
  org_id: string;
  source: MachineSource;
  status: MachineStatus;
  started_at: Date;
  terminated_at: Date | null;
  shutdown_reason: string | null;
  trigger_name: string | null;
  trigger_context: unknown;
  specs: unknown;
}

export interface AgentExecutionRow extends QueryRow {
  id: string;
  organization_id: string;
  project_id: string;
  machine_id: string | null;
  status: AgentExecutionStatus;
  started_at: Date;
  completed_at: Date | null;
  completed_by_agent_at: Date | null;
  deadline_at: Date | null;
  idle_deadline_at: Date | null;
  result: unknown;
  trigger_context: unknown;
  output_context: unknown;
  reaction_state: JsonValue | null;
  configuration_revision_id: string;
  completion_token_hash: string | null;
  reply_claimed_at: Date | null;
  reply_claim_count: number;
  output_emissions: unknown;
  output_delivery_attempts: unknown;
  launch_intent: AgentExecutionRecord["launchIntent"];
  daemon_id: string | null;
  daemon_agent_id: string | null;
  workflow_step_run_id: string | null;
  hub_action: "interrupt" | "archive" | null;
  hub_action_completed_at: Date | null;
  hub_action_ready_at: Date | null;
  hub_action_acknowledgements: unknown;
}

export interface AttachmentRow extends QueryRow {
  id: string;
  provider_event_receipt_id: string;
  organization_id: string;
  connection_id: string;
  provider: AttachmentProvider;
  source_id: string;
  locator: unknown;
  filename: string;
  content_type: string | null;
  byte_size: number | string | null;
  created_at: Date;
}

interface DaemonRow extends QueryRow {
  id: string;
  enrollment_verifier: string;
  slug: string;
  machine_id: string;
  server_id: string;
  daemon_public_key: string;
  credential_verifier: string;
  scopes: string[];
  registered_by_api_key_id: string | null;
  registered_by_cli_credential_id: string | null;
  status: "active" | "revoked";
  presence: "offline" | "connected";
  connected_at: Date | null;
  disconnected_at: Date | null;
  last_seen_at: Date;
  created_at: Date;
}

interface CliAuthorizationRow extends QueryRow {
  id: string;
  device_verifier: string;
  user_code_verifier: string;
  fingerprint_verifier: string;
  status: "pending" | "approved" | "denied" | "expired" | "disclosed";
  poll_interval_seconds: number;
  next_poll_at: Date;
  approved_organization_id: string | null;
  approved_by_user_id: string | null;
  created_at: Date;
  expires_at: Date;
  database_now: Date;
}

function toDaemon(row: DaemonRow): DaemonRecord {
  return {
    id: row.id,
    slug: row.slug,
    machineId: row.machine_id,
    serverId: row.server_id,
    daemonPublicKey: row.daemon_public_key,
    credentialVerifier: row.credential_verifier,
    scopes: row.scopes,
    registeredByApiKeyId: row.registered_by_api_key_id,
    registeredByCliCredentialId: row.registered_by_cli_credential_id,
    status: row.status,
    presence: row.presence,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function toCliAuthorization(row: CliAuthorizationRow): CliAuthorizationRecord {
  return {
    id: row.id,
    status: row.status,
    pollIntervalSeconds: row.poll_interval_seconds,
    approvedOrganizationId: row.approved_organization_id,
    approvedByUserId: row.approved_by_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export interface OrganizationEntitlementsRow extends QueryRow {
  organization_id: string;
  granted: unknown;
  overrides: unknown;
  plan_id: string | null;
  plan_version: string | null;
  stamped_at: Date;
  updated_at: Date;
}

/**
 * The audit before/after snapshot. Carries planId and planVersion so two plans with identical
 * templates stay historically distinguishable — the off-template query depends on it.
 */
/**
 * The idempotent entitlement stamp, scoped to a transaction the caller already opened. A stamp
 * that lands the same granted template and the same plan provenance is a no-op — no timestamp
 * bump, no duplicate audit row — which is what stops the webhook re-stamp ping-pong. jsonb
 * `is distinct from` compares granted structurally. Shared by `stampOrganizationEntitlements`
 * and `reconcileOrganizationSubscription` so the subscription mirror and the stamp commit
 * together.
 */
async function stampEntitlementsWithinTransaction(
  client: QueryHandle,
  input: StampOrganizationEntitlementsInput,
): Promise<OrganizationEntitlementsRecord> {
  const existing = await client.query<OrganizationEntitlementsRow & { changed: boolean }>(
    `select *,
        (granted is distinct from $2::jsonb
         or plan_id is distinct from $3
         or plan_version is distinct from $4) as changed
     from organization_entitlements where organization_id = $1 for update`,
    [input.organizationId, JSON.stringify(input.granted), input.planId, input.planVersion],
  );
  const before = existing.rows[0];
  if (before !== undefined && !before.changed) {
    return toOrganizationEntitlementsRecord(before);
  }
  const stamped = await client.query<OrganizationEntitlementsRow>(
    `insert into organization_entitlements
       (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
     values ($1, $2::jsonb, '{}'::jsonb, $3, $4, now(), now())
     on conflict (organization_id) do update
       set granted = excluded.granted,
           plan_id = excluded.plan_id,
           plan_version = excluded.plan_version,
           stamped_at = now(),
           updated_at = now()
     returning *`,
    [input.organizationId, JSON.stringify(input.granted), input.planId, input.planVersion],
  );
  const after = stamped.rows[0];
  if (after === undefined) throw new Error("entitlements stamp returned no row");
  await client.query(
    `insert into entitlement_changes (organization_id, actor, source, before, after, reason)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      input.organizationId,
      input.actor,
      input.source,
      before === undefined ? null : JSON.stringify(entitlementSnapshot(before)),
      JSON.stringify(entitlementSnapshot(after)),
      input.reason,
    ],
  );
  return toOrganizationEntitlementsRecord(after);
}

function entitlementSnapshot(row: OrganizationEntitlementsRow): {
  granted: unknown;
  overrides: unknown;
  planId: string | null;
  planVersion: string | null;
} {
  return {
    granted: row.granted,
    overrides: row.overrides,
    planId: row.plan_id,
    planVersion: row.plan_version,
  };
}

function toOrganizationEntitlementsRecord(
  row: OrganizationEntitlementsRow,
): OrganizationEntitlementsRecord {
  return {
    organizationId: row.organization_id,
    granted: row.granted,
    overrides: row.overrides,
    planId: row.plan_id,
    planVersion: row.plan_version,
    stampedAt: row.stamped_at,
    updatedAt: row.updated_at,
  };
}

interface OperatorOrganizationRow extends QueryRow {
  id: string;
  name: string;
  slug: string;
}

function toOperatorOrganizationRecord(row: OperatorOrganizationRow): OperatorOrganizationRecord {
  return { id: row.id, name: row.name, slug: row.slug };
}

export interface EntitlementChangeRow extends QueryRow {
  id: string;
  organization_id: string;
  actor: string | null;
  actor_name: string | null;
  source: EntitlementChangeSource;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: Date;
}

function toEntitlementChangeRecord(row: EntitlementChangeRow): EntitlementChangeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actor: row.actor,
    actorName: row.actor_name,
    source: row.source,
    before: row.before,
    after: row.after,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export interface OrganizationUsageRow extends QueryRow {
  organization_id: string;
  meter: string;
  period_start: Date;
  used: number | string;
}

function toOrganizationUsageRecord(row: OrganizationUsageRow): OrganizationUsageRecord {
  return {
    organizationId: row.organization_id,
    meter: row.meter,
    periodStart: row.period_start,
    used: Number(row.used),
  };
}

export interface BillingPlanRow extends QueryRow {
  id: string;
  slug: string;
  name: string;
  template: unknown;
  template_hash: string;
  marketing: unknown;
  active: boolean;
  synced_at: Date;
}

export interface BillingPlanPriceRow extends QueryRow {
  id: string;
  plan_id: string;
  lookup_key: string;
  interval: BillingPlanPriceRecord["interval"];
  unit_amount: number;
  currency: string;
  active: boolean;
}

function toBillingPlanRecord(
  row: BillingPlanRow,
  priceRows: readonly BillingPlanPriceRow[],
): BillingPlanRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    template: row.template,
    templateHash: row.template_hash,
    marketing: row.marketing,
    active: row.active,
    syncedAt: row.synced_at,
    prices: priceRows.map((price) => ({
      id: price.id,
      planId: price.plan_id,
      lookupKey: price.lookup_key,
      interval: price.interval,
      unitAmount: price.unit_amount,
      currency: price.currency,
      active: price.active,
    })),
  };
}

export interface OrganizationSubscriptionRow extends QueryRow {
  organization_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan_id: string | null;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  updated_at: Date;
}

function toOrganizationSubscriptionRecord(
  row: OrganizationSubscriptionRow,
): OrganizationSubscriptionRecord {
  return {
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    planId: row.plan_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    updatedAt: row.updated_at,
  };
}

/**
 * The single conditional upsert behind both standalone consumption and the durable engine's
 * per-execution reservation, run against a pool or an open transaction client. On conflict the
 * accumulation guard (`where` on the update) makes concurrent consumers race-safe: Postgres
 * serializes concurrent inserts on the same conflict key, so one attempt wins the fresh insert
 * and every other is forced through the guarded update. Returns `undefined` — usage unchanged —
 * when a non-null limit would be exceeded.
 */
async function reserveOrganizationUsageOnClient(
  client: QueryHandle,
  input: ConsumeOrganizationUsageInput,
): Promise<OrganizationUsageRecord | undefined> {
  const rows = await client.query<OrganizationUsageRow>(
    `insert into organization_usage (organization_id, meter, period_start, used)
       select $1, $2, $3, $4::bigint
       where $5::bigint is null or $4::bigint <= $5::bigint
       on conflict (organization_id, meter, period_start) do update
         set used = organization_usage.used + excluded.used
       where $5::bigint is null or organization_usage.used + excluded.used <= $5::bigint
       returning *`,
    [input.organizationId, input.meter, input.periodStart, input.amount, input.limit],
  );
  return rows.rows[0] === undefined ? undefined : toOrganizationUsageRecord(rows.rows[0]);
}

export interface ProjectRow extends QueryRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  active_configuration_revision_id: string | null;
}

export interface ProjectConfigurationRevisionRow extends QueryRow {
  id: string;
  project_id: string;
  organization_id: string;
  version: number;
  source_kind: "github" | "manual";
  source_evidence: unknown;
  raw_yaml: string | null;
  normalized_configuration: unknown;
  validation_errors: unknown;
  content_hash: string;
  created_by_user_id: string | null;
  received_at: Date | null;
  created_at: Date;
  validated_at: Date | null;
}

interface GitHubRepositoryRow extends QueryRow {
  id: string;
  organization_id: string;
  connection_id: string;
  installation_id: number | string;
  repository_id: number | string;
  full_name: string;
  default_branch: string;
}

function deadlineConditionAllows(
  execution: AgentExecutionRow,
  condition: WorkflowAgentCompletionInput["deadlineCondition"],
): boolean {
  if (condition === undefined) return true;
  const current = condition.kind === "hard" ? execution.deadline_at : execution.idle_deadline_at;
  return (
    current !== null &&
    current.getTime() === condition.deadlineAt.getTime() &&
    current.getTime() <= condition.observedAt.getTime()
  );
}

function workflowDeadlineKind(
  execution: AgentExecutionRow | undefined,
  step: WorkflowStepRunRow,
  run: TriggerRunRow,
  observedAt: Date,
): WorkflowDeadlineKind | undefined {
  if (run.status === "running" && run.deadline_at !== null && run.deadline_at <= observedAt) {
    return "whole_run";
  }
  const hardDeadline = execution?.deadline_at ?? step.deadline_at;
  const idleDeadline = execution?.idle_deadline_at ?? step.idle_deadline_at;
  if (hardDeadline !== null && hardDeadline <= observedAt) {
    if (idleDeadline !== null && idleDeadline <= observedAt && idleDeadline < hardDeadline) {
      return "step_idle";
    }
    return "step_hard";
  }
  if (idleDeadline !== null && idleDeadline <= observedAt) return "step_idle";
  return undefined;
}

async function timeoutWorkflowStepOnClient(
  client: QueryHandle,
  execution: AgentExecutionRow,
  step: WorkflowStepRunRow,
  run: TriggerRunRow,
  deadlineKind: Exclude<WorkflowDeadlineKind, "whole_run">,
  observedAt: Date,
): Promise<AgentExecutionRow> {
  const reason = deadlineKind === "step_idle" ? "step_idle_timeout" : "step_hard_timeout";
  const updatedExecution = await client.query<AgentExecutionRow>(
    `update agent_executions
     set status = 'failed', completed_at = $2,
         result = jsonb_build_object('status', 'failed', 'reason', $3::text),
         idle_deadline_at = null,
         hub_action = case
           when daemon_id is null then null
           when coalesce((launch_intent ->> 'autoArchive')::boolean, false) then 'archive'
           else 'interrupt'
         end,
         hub_action_completed_at = null::timestamptz
     where id = $1 and status in ('spawning', 'running')
     returning *`,
    [execution.id, observedAt, reason],
  );
  const updated = updatedExecution.rows[0] ?? execution;
  await client.query(
    `update workflow_step_runs
     set status = 'timed_out', failure_reason = $2, deadline_kind = $3, completed_at = $4
     where id = $1 and status in ('pending', 'running')`,
    [step.id, reason, deadlineKind, observedAt],
  );
  if (run.status === "running") {
    await client.query(
      `update trigger_runs
       set status = 'failed', deadline_kind = $2, failure_reason = $3, completed_at = $4,
           terminal_notification_pending_at = coalesce(terminal_notification_pending_at, $4),
           terminal_notification_lease_expires_at = null
       where id = $1 and status = 'running'`,
      [run.id, deadlineKind, reason, observedAt],
    );
  }
  await client.query(`delete from workflow_wakeups where trigger_run_id = $1`, [run.id]);
  return updated;
}

async function timeoutWorkflowRunOnClient(
  client: QueryHandle,
  run: TriggerRunRow,
  observedAt: Date,
): Promise<WorkflowDeadlineRecovery> {
  const executionRows = await client.query<{ id: string }>(
    `update agent_executions
     set status = 'failed', completed_at = $2,
         result = jsonb_build_object('status', 'failed', 'reason', 'whole_run_timeout'),
         idle_deadline_at = null,
         hub_action = case
           when daemon_id is null then null
           when coalesce((launch_intent ->> 'autoArchive')::boolean, false) then 'archive'
           else 'interrupt'
         end,
         hub_action_completed_at = null::timestamptz
     where workflow_step_run_id in (
       select id from workflow_step_runs where trigger_run_id = $1
     )
       and status in ('spawning', 'running')
     returning id`,
    [run.id, observedAt],
  );
  await client.query(
    `update workflow_step_runs
     set status = 'timed_out', failure_reason = 'whole_run_timeout',
         deadline_kind = 'whole_run', completed_at = $2
     where trigger_run_id = $1 and status in ('pending', 'running')`,
    [run.id, observedAt],
  );
  await client.query(
    `update trigger_runs
     set status = 'timed_out', deadline_kind = 'whole_run',
         failure_reason = 'whole_run_timeout', completed_at = $2,
         terminal_notification_pending_at = coalesce(terminal_notification_pending_at, $2),
         terminal_notification_lease_expires_at = null
     where id = $1 and status = 'running'`,
    [run.id, observedAt],
  );
  await client.query(`delete from workflow_wakeups where trigger_run_id = $1`, [run.id]);
  return {
    triggerRunId: run.id,
    executionIds: executionRows.rows.map((row) => row.id),
  };
}

async function transitionWorkflowAgentExecution(
  client: QueryHandle,
  execution: AgentExecutionRow,
  input: WorkflowAgentCompletionInput,
): Promise<{ execution: AgentExecutionRow; transitioned: boolean } | undefined> {
  if (execution.status !== "spawning" && execution.status !== "running") {
    return { execution, transitioned: false };
  }
  if (!deadlineConditionAllows(execution, input.deadlineCondition)) return undefined;

  const completedAt = input.observedAt ?? new Date();
  const updatedRows = await client.query<AgentExecutionRow>(
    `update agent_executions
     set status = $2, completed_at = $3,
         completed_by_agent_at = case
           when $4::boolean and $2 = 'succeeded'::agent_execution_status then $3
           else completed_by_agent_at
         end,
         result = case when $5::boolean then $6 else result end,
         idle_deadline_at = null,
         hub_action = case when $7::boolean then $8 else hub_action end,
         hub_action_completed_at = case
           when $7::boolean and $8::text is null then $3
           when $7::boolean then null
           else hub_action_completed_at
         end
     where id = $1 and status in ('spawning', 'running')
     returning *`,
    [
      input.executionId,
      input.executionStatus,
      completedAt,
      input.completedByAgent === true,
      input.result !== undefined,
      input.result ?? null,
      input.hubAction !== undefined,
      input.hubAction ?? null,
    ],
  );
  return {
    execution: updatedRows.rows[0] ?? execution,
    transitioned: updatedRows.rows.length === 1,
  };
}

async function finishWorkflowStepAndRun(
  client: QueryHandle,
  step: WorkflowStepRunRow,
  run: TriggerRunRow,
  input: WorkflowAgentCompletionInput,
): Promise<void> {
  if (isTerminalWorkflowStepStatus(step.status)) return;

  const completedAt = input.observedAt ?? new Date();
  await client.query(
    `update workflow_step_runs
     set status = $2, output = $3, failure_reason = $4,
         deadline_kind = coalesce($6, deadline_kind), completed_at = $5
     where id = $1`,
    [
      step.id,
      input.stepStatus,
      input.stepOutput !== undefined ? input.stepOutput : (input.result ?? null),
      input.failureReason ?? null,
      completedAt,
      input.deadlineKind ?? null,
    ],
  );
  if (input.stepStatus === "succeeded") {
    if (run.status === "running") await wakeWorkflowRun(client, step.trigger_run_id, completedAt);
    return;
  }
  if (run.status === "running") {
    await client.query(
      `update trigger_runs
       set status = case
             when $5 = 'whole_run' then 'timed_out'
             when $5 is null then $2
             else 'failed'
           end,
           deadline_kind = coalesce($5, deadline_kind), failure_reason = $3, completed_at = $4,
           terminal_notification_pending_at = coalesce(terminal_notification_pending_at, $4),
           terminal_notification_lease_expires_at = null
       where id = $1`,
      [
        step.trigger_run_id,
        input.stepStatus,
        input.failureReason ?? null,
        completedAt,
        input.deadlineKind ?? null,
      ],
    );
  }
  await client.query(`delete from workflow_wakeups where trigger_run_id = $1`, [
    step.trigger_run_id,
  ]);
}

async function findTriggerRunOnClient(
  client: QueryHandle,
  triggerRunId: string,
): Promise<TriggerRunRecord | undefined> {
  const rows = await client.query<TriggerRunRow>(`select * from trigger_runs where id = $1`, [
    triggerRunId,
  ]);
  return rows.rows[0] === undefined ? undefined : toTriggerRunRecord(rows.rows[0]);
}

async function findAgentExecutionOnClient(
  client: QueryHandle,
  executionId: string,
): Promise<AgentExecutionRecord | undefined> {
  const rows = await client.query<AgentExecutionRow>(
    `select * from agent_executions where id = $1`,
    [executionId],
  );
  return rows.rows[0] === undefined ? undefined : toAgentExecutionRecord(rows.rows[0]);
}

async function wakeWorkflowRun(
  client: QueryHandle,
  triggerRunId: string,
  availableAt: Date,
): Promise<void> {
  await client.query(
    `insert into workflow_wakeups (trigger_run_id, available_at, lease_expires_at)
     values ($1, $2, null)
     on conflict (trigger_run_id) do update
     set available_at = least(workflow_wakeups.available_at, excluded.available_at),
         lease_expires_at = null`,
    [triggerRunId, availableAt],
  );
}

function isTerminalWorkflowStepStatus(status: WorkflowStepRunRow["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "timed_out";
}

interface GitHubConfigurationTargetRow extends GitHubRepositoryRow {
  project_id: string;
  automatic_deployment_enabled: boolean;
}

function toGitHubRepositoryRecord(row: GitHubRepositoryRow): GitHubRepositoryRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectionId: row.connection_id,
    repositoryId: Number(row.repository_id),
    fullName: row.full_name,
    defaultBranch: row.default_branch,
  };
}

interface TenantRouteAccessRow extends QueryRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  membership_id: string;
  membership_role: "owner" | "admin" | "member";
  project_id: string | null;
  project_organization_id: string | null;
  project_name: string | null;
  project_slug: string | null;
  project_status: "active" | "archived" | null;
  project_created_by_user_id: string | null;
  project_created_at: Date | null;
  project_updated_at: Date | null;
  project_archived_at: Date | null;
  project_active_configuration_revision_id: string | null;
}
