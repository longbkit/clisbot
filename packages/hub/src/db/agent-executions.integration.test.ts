import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "./test-utils/runtime.js";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDatabase } from "./test-utils/runtime.js";
import {
  compileHubConfig,
  compiledConfigurationHash,
  type CompiledHubConfig,
} from "../config/compiler.js";
import type { AgentExecutionRecord, Database } from "./types.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import type { DurableProviderEvent } from "../db/types.js";
import type { RejectedTriggerProviderMatch, TriggerProviderMatch } from "../triggers/index.js";
import { createDurableWorkflowHandler } from "../workflows/engine.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";

describe("agent execution PostgreSQL repository", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
  }, 120_000);

  afterAll(async () => {
    await postgres.stop();
  }, 120_000);

  it("commits one complete terminal outcome under concurrent finality", async () => {
    const fixture = await executionFixture(postgres);
    const terminals = [
      {
        status: "succeeded" as const,
        result: { status: "succeeded" },
        hubAction: "archive" as const,
      },
      {
        status: "failed" as const,
        result: { status: "failed", reason: "timeout" },
        hubAction: "interrupt" as const,
      },
    ];

    try {
      const attempts = await Promise.all(
        terminals.map(async (terminal) => ({
          terminal,
          transition: await fixture.database.transitionAgentExecution(
            fixture.execution.id,
            terminal.status,
            { result: terminal.result, hubAction: terminal.hubAction },
          ),
        })),
      );

      assert.equal(attempts.filter(({ transition }) => transition.transitioned).length, 1);
      const winner = attempts.find(({ transition }) => transition.transitioned);
      assert.ok(winner);
      const persisted = await fixture.database.findAgentExecutionById(fixture.execution.id);
      assert.ok(persisted);
      assert.deepEqual(
        { status: persisted.status, result: persisted.result, hubAction: persisted.hubAction },
        winner.terminal,
      );
    } finally {
      await fixture.database.close();
    }
  });

  it("persists one run, one step, explicit execution ownership, and idempotent finish", async () => {
    const fixture = await executionFixture(postgres);
    try {
      const receipt = await fixture.database.persistManualEvent({
        organizationId: "org-1",
        projectId: fixture.execution.projectId,
        deliveryId: randomUUID(),
        source: "manual.test_workflow",
        payload: {},
        receivedAt: new Date(),
      });
      if (receipt.status !== "accepted") throw new Error("workflow receipt was not accepted");
      const baseIntent = launchIntent(
        "run-placeholder",
        fixture.execution.configurationRevisionId,
        "one-step",
      );
      const created = await fixture.database.createAcceptedTriggerRun({
        organizationId: "org-1",
        projectId: fixture.execution.projectId,
        configurationRevisionId: fixture.execution.configurationRevisionId,
        providerEventReceiptId: receipt.event.providerEventReceiptId,
        configuredTriggerName: "one-step",
        prompt: "@Paseo repo=hub investigate",
        inputs: { repo: "hub" },
        triggerContext: baseIntent.triggerContext,
        outputContext: baseIntent.outputContext,
        deadlineAt: new Date(Date.now() + 60_000),
        stepIds: ["step-one"],
      });
      const intent = launchIntent(
        created.run.id,
        fixture.execution.configurationRevisionId,
        "one-step",
      );
      assert.deepEqual(
        (
          await fixture.database.findTriggerRunsByProviderEventReceiptId(
            receipt.event.providerEventReceiptId,
          )
        )[0],
        {
          ...created.run,
          prompt: "@Paseo repo=hub investigate",
          inputs: { repo: "hub" },
        },
      );
      const step = await fixture.database.findWorkflowStepRunByTriggerRun(created.run.id);
      assert.ok(step);
      const execution = await fixture.database.insertAgentExecution({
        organizationId: "org-1",
        projectId: fixture.execution.projectId,
        machineId: fixture.execution.machineId,
        triggerContext: intent.triggerContext,
        outputContext: intent.outputContext,
        configurationRevisionId: fixture.execution.configurationRevisionId,
        workflowStepRunId: step.id,
        launchIntent: intent,
      });
      await fixture.database.linkWorkflowStepRunExecution(step.id, execution.id);
      assert.equal(
        (await fixture.database.findWorkflowStepRunById(step.id))?.agentExecutionId,
        execution.id,
      );
      await fixture.database.transitionAgentExecution(execution.id, "succeeded", {
        result: { status: "succeeded" },
      });
      const first = await fixture.database.completeWorkflowStep(execution.id, "succeeded", {
        status: "succeeded",
      });
      const second = await fixture.database.completeWorkflowStep(execution.id, "succeeded", {
        status: "succeeded",
      });
      await fixture.database.succeedTriggerRun(created.run.id);
      assert.equal(
        (await fixture.database.findTriggerRunById(created.run.id))?.status,
        "succeeded",
      );
      assert.deepEqual(second, first);
    } finally {
      await fixture.database.close();
    }
  });

  it("keeps delivery, wakeup lease, deadline, and finish idempotent in PostgreSQL", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    try {
      const providerMatch = phaseOneMatch(fixture.execution.configurationRevisionId);
      const { handler, engine } = createDurableWorkflowHandler({
        database: fixture.database,
        entitlements: createUnlimitedEntitlementsService(),
        providers: [
          {
            name: "test",
            eventNames: ["test.event"],
            async match() {
              return [providerMatch];
            },
          },
        ],
        now: () => now,
        leaseMs: 1_000,
        dispatchLaunchMachineIntent: async (intent) => {
          const execution = await persistedWorkflowExecution(fixture.database, intent);
          return { execution };
        },
      });
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-delivery",
      );
      const durableTrigger = toDurableEvent(trigger.event);

      await Promise.all([handler(durableTrigger), handler(durableTrigger)]);

      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          trigger.event.providerEventReceiptId,
        )
      )[0];
      assert.ok(run);
      if (run.outcome !== "accepted") throw new Error("expected accepted trigger run");
      const step = await fixture.database.findWorkflowStepRunByTriggerRun(run.id);
      assert.ok(step);
      assert.equal(run.deadlineAt.toISOString(), "2026-08-05T13:00:00.000Z");
      assert.equal((await fixture.database.claimWorkflowWakeup(now, 1_000)) !== undefined, true);
      assert.equal(
        await fixture.database.claimWorkflowWakeup(new Date(now.getTime() + 500), 1_000),
        undefined,
      );

      now = new Date("2026-08-05T12:00:04.500Z");
      await engine.processAvailable();
      const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
      assert.ok(execution);
      assert.equal(execution.deadlineAt?.toISOString(), "2026-08-05T12:00:34.500Z");
      assert.equal(execution.workflowStepRunId, step.id);

      await fixture.database.transitionAgentExecution(execution.id, "succeeded", {
        result: { status: "succeeded" },
      });
      const first = await fixture.database.completeWorkflowStep(execution.id, "succeeded", {
        status: "succeeded",
      });
      const second = await fixture.database.completeWorkflowStep(execution.id, "succeeded", {
        status: "succeeded",
      });
      assert.equal(first?.run.status, "running");
      assert.deepEqual(second, first);
      await fixture.database.succeedTriggerRun(run.id);
      assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "succeeded");
      assert.equal(await fixture.database.claimWorkflowWakeup(now, 1_000), undefined);
    } finally {
      await fixture.database.close();
    }
  });

  it("recovers persisted step idle deadlines without extending hard or run deadlines", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    const configuration = deadlineWorkflowConfiguration({ idleTimeout: "5s" });
    const revision = await fixture.database.insertProjectConfigurationRevision({
      projectId: fixture.execution.projectId,
      sourceKind: "manual",
      sourceEvidence: { kind: "phase-5-test" },
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
    });
    const dispatches: string[] = [];
    const createEngine = () =>
      postgresDeadlineEngine(fixture.database, configuration, revision.id, () => now, dispatches);
    try {
      const trigger = await insertWorkflowTrigger(fixture.database, revision.id, "phase-five-idle");
      const first = createEngine();
      await first.handler(toDurableEvent(trigger.event));
      await first.engine.processAvailable();
      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          trigger.event.providerEventReceiptId,
        )
      )[0]!;
      assert.equal(run.outcome, "accepted");
      const step = (await fixture.database.findWorkflowStepRunByTriggerRun(run.id))!;
      const execution = (await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id))!;
      assert.equal(step.deadlineAt?.toISOString(), "2026-08-05T12:01:00.000Z");
      assert.equal(step.idleDeadlineAt?.toISOString(), "2026-08-05T12:00:05.000Z");
      assert.equal(execution.deadlineAt?.toISOString(), "2026-08-05T12:01:00.000Z");
      assert.equal(run.deadlineAt.toISOString(), "2026-08-05T12:02:00.000Z");

      now = new Date("2026-08-05T12:00:03.000Z");
      await fixture.database.setAgentExecutionIdleDeadline(
        execution.id,
        new Date("2026-08-05T12:00:08.000Z"),
        now,
        now,
      );
      const refreshed = (await fixture.database.findAgentExecutionById(execution.id))!;
      assert.equal(refreshed.deadlineAt?.toISOString(), "2026-08-05T12:01:00.000Z");
      assert.equal(refreshed.idleDeadlineAt?.toISOString(), "2026-08-05T12:00:08.000Z");

      const persistedRun = await fixture.database.findTriggerRunById(run.id);
      if (persistedRun?.outcome !== "accepted") throw new Error("accepted run was not persisted");
      const persistedStep = await fixture.database.findWorkflowStepRunById(step.id);
      if (persistedStep === undefined) throw new Error("step was not persisted");
      const persistedExecution = await fixture.database.findAgentExecutionById(execution.id);
      if (persistedExecution === undefined) throw new Error("execution was not persisted");
      const persistedDeadlines = {
        run: persistedRun.deadlineAt.toISOString(),
        step: persistedStep.deadlineAt!.toISOString(),
        idle: persistedStep.idleDeadlineAt!.toISOString(),
        execution: persistedExecution.deadlineAt!.toISOString(),
        executionIdle: persistedExecution.idleDeadlineAt!.toISOString(),
      };
      now = new Date("2026-08-05T12:00:04.000Z");
      const beforeExpiryRestart = createEngine();
      await beforeExpiryRestart.engine.processAvailable();
      const restartedRun = await fixture.database.findTriggerRunById(run.id);
      if (restartedRun?.outcome !== "accepted") throw new Error("accepted run was not persisted");
      const restartedStep = await fixture.database.findWorkflowStepRunById(step.id);
      if (restartedStep === undefined) throw new Error("step was not persisted");
      const restartedExecution = await fixture.database.findAgentExecutionById(execution.id);
      if (restartedExecution === undefined) throw new Error("execution was not persisted");
      assert.deepEqual(
        {
          run: restartedRun.deadlineAt.toISOString(),
          step: restartedStep.deadlineAt!.toISOString(),
          idle: restartedStep.idleDeadlineAt!.toISOString(),
          execution: restartedExecution.deadlineAt!.toISOString(),
          executionIdle: restartedExecution.idleDeadlineAt!.toISOString(),
        },
        persistedDeadlines,
      );

      now = new Date("2026-08-05T12:00:08.000Z");
      const restarted = createEngine();
      await restarted.engine.processAvailable();
      const completedRun = (await fixture.database.findTriggerRunById(run.id))!;
      const completedStep = (await fixture.database.findWorkflowStepRunById(step.id))!;
      const failedExecution = (await fixture.database.findAgentExecutionById(execution.id))!;
      assert.equal(completedRun.status, "failed");
      assert.equal(completedRun.deadlineKind, "step_idle");
      assert.equal(completedStep.status, "timed_out");
      assert.equal(completedStep.deadlineKind, "step_idle");
      assert.equal(failedExecution.status, "failed");
      assert.equal(failedExecution.deadlineAt?.toISOString(), "2026-08-05T12:01:00.000Z");
      assert.equal(completedRun.deadlineAt.toISOString(), "2026-08-05T12:02:00.000Z");
      await restarted.engine.processAvailable();
      assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "failed");
      assert.deepEqual(dispatches, ["run"]);
    } finally {
      await fixture.database.close();
    }
  });

  it("stops between-step and live workflows at the absolute whole-run deadline", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    const configuration = deadlineWorkflowConfiguration({
      maxRuntime: "10s",
      stepCount: 2,
      stepRuntime: "1m",
      idleTimeout: "1m",
    });
    const revision = await fixture.database.insertProjectConfigurationRevision({
      projectId: fixture.execution.projectId,
      sourceKind: "manual",
      sourceEvidence: { kind: "phase-5-test" },
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
    });
    const dispatches: string[] = [];
    const createEngine = () =>
      postgresDeadlineEngine(fixture.database, configuration, revision.id, () => now, dispatches);
    try {
      const betweenTrigger = await insertWorkflowTrigger(
        fixture.database,
        revision.id,
        "phase-five-between-steps",
      );
      const firstEngine = createEngine();
      await firstEngine.handler(toDurableEvent(betweenTrigger.event));
      await firstEngine.engine.processAvailable();
      const betweenRun = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          betweenTrigger.event.providerEventReceiptId,
        )
      )[0]!;
      const firstStep = (await fixture.database.findWorkflowStepRunByTriggerRun(betweenRun.id))!;
      const firstExecution = (await fixture.database.findAgentExecutionByWorkflowStepRunId(
        firstStep.id,
      ))!;
      assert.equal(firstStep.deadlineAt?.toISOString(), "2026-08-05T12:00:10.000Z");
      assert.equal(firstStep.idleDeadlineAt?.toISOString(), "2026-08-05T12:00:10.000Z");
      assert.equal(firstExecution.deadlineAt?.toISOString(), "2026-08-05T12:00:10.000Z");
      await fixture.database.transitionAgentExecution(firstExecution.id, "succeeded", {
        result: { status: "succeeded" },
      });
      await fixture.database.completeWorkflowStep(firstExecution.id, "succeeded", {
        status: "succeeded",
      });
      now = new Date("2026-08-05T12:00:10.000Z");
      const betweenRestart = createEngine();
      await betweenRestart.engine.processAvailable();
      const betweenStepRuns = await fixture.database.listWorkflowStepRunsForTriggerRun(
        betweenRun.id,
      );
      assert.equal((await fixture.database.findTriggerRunById(betweenRun.id))?.status, "timed_out");
      assert.equal(betweenStepRuns[1]?.status, "timed_out");
      assert.equal(betweenStepRuns[1]?.deadlineKind, "whole_run");

      now = new Date("2026-08-05T12:00:00.000Z");
      const live = await insertWorkflowTrigger(fixture.database, revision.id, "phase-five-live");
      const liveEngine = createEngine();
      await liveEngine.handler(toDurableEvent(live.event));
      await liveEngine.engine.processAvailable();
      const liveRun = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          live.event.providerEventReceiptId,
        )
      )[0]!;
      const liveStep = (await fixture.database.findWorkflowStepRunByTriggerRun(liveRun.id))!;
      const liveExecution = (await fixture.database.findAgentExecutionByWorkflowStepRunId(
        liveStep.id,
      ))!;
      now = new Date("2026-08-05T12:00:10.000Z");
      const liveRestart = createEngine();
      await liveRestart.engine.processAvailable();
      assert.equal((await fixture.database.findTriggerRunById(liveRun.id))?.status, "timed_out");
      assert.equal(
        (await fixture.database.findWorkflowStepRunById(liveStep.id))?.status,
        "timed_out",
      );
      assert.equal(
        (await fixture.database.findAgentExecutionById(liveExecution.id))?.status,
        "failed",
      );
      assert.equal(dispatches.length, 2);
    } finally {
      await fixture.database.close();
    }
  });

  it("rejects a workflow completion observed exactly at the step hard deadline", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    const configuration = deadlineWorkflowConfiguration({ idleTimeout: "1m" });
    const revision = await fixture.database.insertProjectConfigurationRevision({
      projectId: fixture.execution.projectId,
      sourceKind: "manual",
      sourceEvidence: { kind: "phase-5-test" },
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
    });
    try {
      const dispatches: string[] = [];
      const engine = postgresDeadlineEngine(
        fixture.database,
        configuration,
        revision.id,
        () => now,
        dispatches,
      );
      const trigger = await insertWorkflowTrigger(fixture.database, revision.id, "phase-five-race");
      await engine.handler(toDurableEvent(trigger.event));
      await engine.engine.processAvailable();
      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          trigger.event.providerEventReceiptId,
        )
      )[0]!;
      const step = (await fixture.database.findWorkflowStepRunByTriggerRun(run.id))!;
      const execution = (await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id))!;
      now = execution.deadlineAt!;
      const completion = await fixture.database.completeWorkflowAgentExecution({
        executionId: execution.id,
        executionStatus: "succeeded",
        stepStatus: "succeeded",
        result: { status: "succeeded" },
        observedAt: now,
      });
      assert.equal(completion.deadlineKind, "step_hard");
      assert.equal(completion.execution.status, "failed");
      assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "failed");
    } finally {
      await fixture.database.close();
    }
  });

  it.each([
    { terminalStatus: "succeeded" as const, expectedRunStatus: "running" as const },
    { terminalStatus: "failed" as const, expectedRunStatus: "failed" as const },
  ])(
    "reconciles a terminal $terminalStatus execution after PostgreSQL restart recovery",
    async ({ terminalStatus, expectedRunStatus }) => {
      const fixture = await executionFixture(postgres);
      const dispatches: string[] = [];
      const match = restartMatch(fixture.execution.configurationRevisionId);
      const createEngine = () =>
        createDurableWorkflowHandler({
          database: fixture.database,
          entitlements: createUnlimitedEntitlementsService(),
          providers: [
            {
              name: "test",
              eventNames: ["test.event"],
              async match() {
                return [match];
              },
            },
          ],
          dispatchLaunchMachineIntent: async (intent) => {
            if (intent.prompt === "Downstream") {
              const prior = await fixture.database.findWorkflowStepRunById(firstStepId!);
              assert.equal(prior?.status, "succeeded");
            }
            dispatches.push(intent.prompt);
            const execution = await persistedWorkflowExecution(fixture.database, intent);
            return { execution };
          },
        });
      let firstStepId: string | undefined;
      try {
        const firstEngine = createEngine();
        const trigger = await insertWorkflowTrigger(
          fixture.database,
          fixture.execution.configurationRevisionId,
          `postgres-restart-${terminalStatus}`,
        );
        await firstEngine.handler(toDurableEvent(trigger.event));
        await firstEngine.engine.processAvailable();

        const run = (
          await fixture.database.findTriggerRunsByProviderEventReceiptId(
            trigger.event.providerEventReceiptId,
          )
        )[0];
        assert.ok(run);
        const firstStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0];
        assert.ok(firstStep);
        firstStepId = firstStep.id;
        const firstExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          firstStep.id,
        );
        assert.ok(firstExecution);
        assert.deepEqual(dispatches, ["First"]);

        await fixture.database.transitionAgentExecution(firstExecution.id, terminalStatus, {
          result: { status: terminalStatus },
        });

        const restarted = createEngine();
        await restarted.engine.processAvailable();
        await restarted.engine.processAvailable();

        assert.equal(
          (await fixture.database.findTriggerRunById(run.id))?.status,
          expectedRunStatus,
        );
        assert.equal(
          (await fixture.database.findWorkflowStepRunById(firstStep.id))?.status,
          terminalStatus,
        );
        assert.deepEqual(
          dispatches,
          terminalStatus === "succeeded" ? ["First", "Downstream"] : ["First"],
        );
      } finally {
        await fixture.database.close();
      }
    },
  );

  it("reuses a pre-handoff spawning workflow execution after PostgreSQL lease recovery", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    let successfulHandoffs = 0;
    const createEngine = (crashBeforeHandoff: boolean) =>
      createDurableWorkflowHandler({
        database: fixture.database,
        entitlements: createUnlimitedEntitlementsService(),
        providers: [
          {
            name: "test",
            eventNames: ["test.event"],
            async match() {
              return [phaseOneMatch(fixture.execution.configurationRevisionId)];
            },
          },
        ],
        now: () => now,
        leaseMs: 1_000,
        dispatchLaunchMachineIntent: async (intent) => {
          if (crashBeforeHandoff) throw new Error("crash before daemon handoff");
          successfulHandoffs += 1;
          const execution = await persistedWorkflowExecution(fixture.database, intent);
          return { execution };
        },
      });
    try {
      const first = createEngine(true);
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-pre-handoff-recovery",
      );
      await first.handler(toDurableEvent(trigger.event));
      await first.engine.processAvailable();

      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          trigger.event.providerEventReceiptId,
        )
      )[0]!;
      const step = (await fixture.database.findWorkflowStepRunByTriggerRun(run.id))!;
      const execution = (await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id))!;
      assert.equal(execution.status, "spawning");
      assert.equal(execution.machineId, null);
      assert.equal(execution.daemonId, null);
      assert.equal(execution.daemonAgentId, null);
      assert.equal(successfulHandoffs, 0);

      now = new Date("2026-08-05T12:00:01.001Z");
      const restarted = createEngine(false);
      await restarted.engine.processAvailable();

      const recoveredExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
        step.id,
      );
      assert.equal(recoveredExecution?.id, execution.id);
      assert.equal(successfulHandoffs, 1);
      const client = await createPostgresQueryRuntime(fixture.databaseUrl);

      try {
        const count = await client.query<{ count: string }>(
          `select count(*)::text as count
           from agent_executions execution
           join workflow_step_runs step on step.id = execution.workflow_step_run_id
           where step.trigger_run_id = $1`,
          [run.id],
        );
        assert.equal(count.rows[0]?.count, "1");
      } finally {
        await client.close();
      }
    } finally {
      await fixture.database.close();
    }
  });

  it("delivers a terminal workflow notification after restart when the crash happened before the hook", async () => {
    const fixture = await executionFixture(postgres);
    const delivered: string[] = [];
    const restarted = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [],
      onWorkflowRunTerminal: async (terminalRun) => {
        delivered.push(terminalRun.id);
      },
    });
    try {
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-terminal-crash-before-hook",
      );
      const run = (
        await fixture.database.createAcceptedTriggerRun({
          organizationId: trigger.event.organizationId,
          projectId: trigger.event.projectId,
          configurationRevisionId: fixture.execution.configurationRevisionId,
          providerEventReceiptId: trigger.event.providerEventReceiptId,
          configuredTriggerName: "one-step",
          prompt: "raw",
          inputs: {},
          triggerContext: { provider: "test" },
          outputContext: { provider: "test" },
          deadlineAt: new Date("2026-08-05T13:00:00.000Z"),
          stepIds: ["step-one"],
          createdAt: new Date("2026-08-05T12:00:00.000Z"),
        })
      ).run;
      await fixture.database.succeedTriggerRun(run.id);

      await restarted.engine.processAvailable();
      await restarted.engine.processAvailable();
      await restarted.engine.stop();

      assert.deepEqual(delivered, [run.id]);
      const persisted = await fixture.database.findTriggerRunById(run.id);
      assert.equal(
        persisted?.outcome === "accepted"
          ? persisted.terminalNotificationDeliveredAt !== null
          : false,
        true,
      );
    } finally {
      await restarted.engine.stop();
      await fixture.database.close();
    }
  });

  it("retries a failed terminal workflow notification and stops after delivery", async () => {
    const fixture = await executionFixture(postgres);
    let now = new Date("2026-08-05T12:00:00.000Z");
    const delivered: string[] = [];
    let failFirst = true;
    const engines: Array<ReturnType<typeof createDurableWorkflowHandler>["engine"]> = [];
    try {
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-terminal-retry",
      );
      const run = (
        await fixture.database.createAcceptedTriggerRun({
          organizationId: trigger.event.organizationId,
          projectId: trigger.event.projectId,
          configurationRevisionId: fixture.execution.configurationRevisionId,
          providerEventReceiptId: trigger.event.providerEventReceiptId,
          configuredTriggerName: "one-step",
          prompt: "raw",
          inputs: {},
          triggerContext: { provider: "test" },
          outputContext: { provider: "test" },
          deadlineAt: new Date("2026-08-05T13:00:00.000Z"),
          stepIds: ["step-one"],
          createdAt: now,
        })
      ).run;
      await fixture.database.succeedTriggerRun(run.id);

      const createEngine = () => {
        const engine = createDurableWorkflowHandler({
          database: fixture.database,
          entitlements: createUnlimitedEntitlementsService(),
          providers: [],
          now: () => now,
          leaseMs: 1_000,
          onWorkflowRunTerminal: async (terminalRun) => {
            delivered.push(terminalRun.id);
            if (failFirst) {
              failFirst = false;
              throw new Error("provider unavailable");
            }
          },
        }).engine;
        engines.push(engine);
        return engine;
      };

      const firstEngine = createEngine();
      await firstEngine.processAvailable();
      await firstEngine.stop();
      assert.deepEqual(delivered, [run.id]);
      const failedDelivery = await fixture.database.findTriggerRunById(run.id);
      assert.equal(failedDelivery?.outcome, "accepted");
      assert.equal(failedDelivery.terminalNotificationDeliveredAt, null);

      now = new Date("2026-08-05T12:00:01.001Z");
      const retryEngine = createEngine();
      await retryEngine.processAvailable();
      await retryEngine.stop();

      const persisted = await fixture.database.findTriggerRunById(run.id);

      assert.deepEqual(delivered, [run.id, run.id]);
      assert.equal(
        persisted?.outcome === "accepted"
          ? persisted.terminalNotificationDeliveredAt !== null
          : false,
        true,
      );
    } finally {
      for (const engine of engines) await engine.stop();
      await fixture.database.close();
    }
  });

  it.each([
    { executionStatus: "succeeded" as const, stepStatus: "succeeded" as const },
    { executionStatus: "failed" as const, stepStatus: "failed" as const },
    { executionStatus: "failed" as const, stepStatus: "timed_out" as const },
  ])(
    "atomically completes workflow-owned $stepStatus agent executions in PostgreSQL",
    async ({ executionStatus, stepStatus }) => {
      const fixture = await executionFixture(postgres);
      const dispatches: string[] = [];
      const match = restartMatch(fixture.execution.configurationRevisionId);
      try {
        const { handler, engine } = createDurableWorkflowHandler({
          database: fixture.database,
          entitlements: createUnlimitedEntitlementsService(),
          providers: [
            {
              name: "test",
              eventNames: ["test.event"],
              async match() {
                return [match];
              },
            },
          ],
          dispatchLaunchMachineIntent: async (intent) => {
            dispatches.push(intent.prompt);
            const execution = await persistedWorkflowExecution(fixture.database, intent);
            return { execution };
          },
        });
        const trigger = await insertWorkflowTrigger(
          fixture.database,
          fixture.execution.configurationRevisionId,
          `postgres-atomic-${stepStatus}`,
        );
        await handler(toDurableEvent(trigger.event));
        await engine.processAvailable();
        const run = (
          await fixture.database.findTriggerRunsByProviderEventReceiptId(
            trigger.event.providerEventReceiptId,
          )
        )[0]!;
        const firstStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          firstStep.id,
        );
        assert.ok(execution);

        const terminal = await fixture.database.completeWorkflowAgentExecution({
          executionId: execution.id,
          executionStatus,
          stepStatus,
          result: { status: executionStatus, reason: stepStatus },
          stepOutput: { status: stepStatus },
        });
        const duplicate = await fixture.database.completeWorkflowAgentExecution({
          executionId: execution.id,
          executionStatus,
          stepStatus,
          result: { status: executionStatus, reason: "duplicate" },
          stepOutput: { status: "duplicate" },
        });

        assert.equal(terminal.transitioned, true);
        assert.equal(duplicate.transitioned, false);
        assert.equal(
          (await fixture.database.findAgentExecutionById(execution.id))?.status,
          executionStatus,
        );
        assert.equal(
          (await fixture.database.findWorkflowStepRunById(firstStep.id))?.status,
          stepStatus,
        );
        assert.equal(
          (await fixture.database.findTriggerRunById(run.id))?.status,
          stepStatus === "succeeded" ? "running" : stepStatus,
        );
        await engine.processAvailable();
        assert.deepEqual(
          dispatches,
          stepStatus === "succeeded" ? ["First", "Downstream"] : ["First"],
        );
      } finally {
        await fixture.database.close();
      }
    },
  );

  it("fans one PostgreSQL receipt into independently idempotent configured-trigger branches", async () => {
    const fixture = await executionFixture(postgres);
    let dispatches = 0;
    try {
      const matches = [
        phaseOneMatch(fixture.execution.configurationRevisionId, "first-route", "first-step"),
        phaseOneMatch(fixture.execution.configurationRevisionId, "second-route", "second-step"),
      ];
      const { handler, engine } = createDurableWorkflowHandler({
        database: fixture.database,
        entitlements: createUnlimitedEntitlementsService(),
        providers: [
          {
            name: "test",
            eventNames: ["test.event"],
            async match() {
              return matches;
            },
          },
        ],
        dispatchLaunchMachineIntent: async (intent) => {
          dispatches += 1;
          const execution = await persistedWorkflowExecution(fixture.database, intent);
          return { execution };
        },
      });
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-fanout",
      );
      const durableTrigger = toDurableEvent(trigger.event);

      await Promise.all([handler(durableTrigger), handler(durableTrigger)]);
      const runs = await fixture.database.findTriggerRunsByProviderEventReceiptId(
        trigger.event.providerEventReceiptId,
      );
      assert.equal(runs.length, 2);
      assert.deepEqual(runs.map((run) => run.configuredTriggerName).sort(), [
        "first-route",
        "second-route",
      ]);
      const activity = await fixture.database.listProjectActivityRuns(
        fixture.execution.projectId,
        10,
      );
      assert.deepEqual(activity.map(({ run }) => run.configuredTriggerName).toSorted(), [
        "first-route",
        "second-route",
      ]);
      await Promise.all(
        runs.flatMap((run) => [
          fixture.database.wakeWorkflowRun(run.id, new Date()),
          fixture.database.wakeWorkflowRun(run.id, new Date()),
        ]),
      );

      await engine.processAvailable();
      const branches = await Promise.all(
        runs.map(async (run) => {
          const step = await fixture.database.findWorkflowStepRunByTriggerRun(run.id);
          assert.ok(step);
          const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
          assert.ok(execution);
          return { run, execution };
        }),
      );
      assert.equal(dispatches, 2);
      assert.equal(new Set(branches.map(({ execution }) => execution.id)).size, 2);

      const first = branches[0]!;
      const second = branches[1]!;
      await fixture.database.transitionAgentExecution(first.execution.id, "succeeded", {
        result: { route: first.run.configuredTriggerName },
      });
      const firstFinish = await fixture.database.completeWorkflowStep(
        first.execution.id,
        "succeeded",
        {
          route: first.run.configuredTriggerName,
        },
      );
      const firstDuplicateFinish = await fixture.database.completeWorkflowStep(
        first.execution.id,
        "succeeded",
        {
          route: first.run.configuredTriggerName,
        },
      );
      assert.deepEqual(firstDuplicateFinish, firstFinish);
      assert.equal((await fixture.database.findTriggerRunById(first.run.id))?.status, "running");
      assert.equal((await fixture.database.findTriggerRunById(second.run.id))?.status, "running");

      await fixture.database.transitionAgentExecution(second.execution.id, "succeeded", {
        result: { route: second.run.configuredTriggerName },
      });
      const secondFinish = await fixture.database.completeWorkflowStep(
        second.execution.id,
        "succeeded",
        {
          route: second.run.configuredTriggerName,
        },
      );
      assert.deepEqual(
        await fixture.database.completeWorkflowStep(second.execution.id, "succeeded", {
          route: second.run.configuredTriggerName,
        }),
        secondFinish,
      );
      await handler(durableTrigger);
      await engine.processAvailable();
      assert.equal((await fixture.database.findTriggerRunById(second.run.id))?.status, "succeeded");
      assert.equal(dispatches, 2);
      assert.equal(
        (
          await fixture.database.findTriggerRunsByProviderEventReceiptId(
            trigger.event.providerEventReceiptId,
          )
        ).length,
        2,
      );
    } finally {
      await fixture.database.close();
    }
  });

  it("persists accepted and rejected PostgreSQL fan-out branches independently", async () => {
    const fixture = await executionFixture(postgres);
    let dispatches = 0;
    try {
      const accepted = phaseOneMatch(
        fixture.execution.configurationRevisionId,
        "accepted-route",
        "accepted-step",
      );
      const rejected: RejectedTriggerProviderMatch = {
        triggerName: "rejected-route",
        triggerContext: { provider: "slack" },
        outputContext: {},
        configurationRevisionId: fixture.execution.configurationRevisionId,
        hubConfig: {},
        invocation: {
          status: "rejected" as const,
          prompt: "repo=unknown investigate",
          inputs: {},
          reason: "input repo must be one of the declared choices",
          rejection: {
            code: "invalid_choice",
            inputName: "repo",
            value: "unknown",
            choices: ["hub"],
          },
        },
      };
      const secondRejected: RejectedTriggerProviderMatch = {
        ...rejected,
        triggerName: "second-rejected-route",
        invocation: {
          ...rejected.invocation,
          reason: "duplicate input repo",
          rejection: { code: "duplicate_input" as const, inputName: "repo" },
        },
      };
      const { handler, engine } = createDurableWorkflowHandler({
        database: fixture.database,
        entitlements: createUnlimitedEntitlementsService(),
        providers: [
          {
            name: "test",
            eventNames: ["test.event"],
            async match() {
              return [accepted, rejected, secondRejected];
            },
          },
        ],
        dispatchLaunchMachineIntent: async (intent) => {
          dispatches += 1;
          const execution = await persistedWorkflowExecution(fixture.database, intent);
          return {
            execution,
          };
        },
      });
      const trigger = await insertWorkflowTrigger(
        fixture.database,
        fixture.execution.configurationRevisionId,
        "postgres-mixed-fanout",
      );
      const durableTrigger = toDurableEvent(trigger.event);

      await Promise.all([handler(durableTrigger), handler(durableTrigger)]);
      await engine.processAvailable();

      const runs = await fixture.database.findTriggerRunsByProviderEventReceiptId(
        trigger.event.providerEventReceiptId,
      );
      assert.equal(runs.length, 3);
      assert.deepEqual(
        runs
          .map((run) => ({ name: run.configuredTriggerName, status: run.status }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        [
          { name: "accepted-route", status: "running" },
          { name: "rejected-route", status: "rejected" },
          { name: "second-rejected-route", status: "rejected" },
        ],
      );
      const rejectedRun = runs.find((run) => run.configuredTriggerName === "rejected-route");
      assert.ok(rejectedRun);
      if (rejectedRun.outcome !== "rejected") throw new Error("expected rejected branch");
      assert.equal(rejectedRun.rejection.code, "invalid_choice");
      assert.equal(
        await fixture.database.findWorkflowStepRunByTriggerRun(rejectedRun.id),
        undefined,
      );
      const secondRejectedRun = runs.find(
        (run) => run.configuredTriggerName === "second-rejected-route",
      );
      assert.ok(secondRejectedRun);
      if (secondRejectedRun.outcome !== "rejected") throw new Error("expected rejected branch");
      assert.equal(secondRejectedRun.rejection.code, "duplicate_input");
      assert.equal(
        await fixture.database.findWorkflowStepRunByTriggerRun(secondRejectedRun.id),
        undefined,
      );
      assert.equal(dispatches, 1);
      assert.equal(
        (await fixture.database.findProviderEventReceiptById(trigger.event.providerEventReceiptId))
          ?.droppedReason,
        null,
      );
    } finally {
      await fixture.database.close();
    }
  });

  it("replays accepted and rejected runs by receipt, project, and trigger identity", async () => {
    const fixture = await executionFixture(postgres);
    const client = await createPostgresQueryRuntime(fixture.databaseUrl);
    const projectTwoId = "00000000-0000-0000-0000-000000000002";
    try {
      await client.query(
        `insert into projects (id, organization_id, name, slug)
         values ($1, 'org-1', 'Second', 'second')`,
        [projectTwoId],
      );
      const projectTwoRevision = await fixture.database.insertProjectConfigurationRevision({
        projectId: projectTwoId,
        sourceKind: "manual",
        sourceEvidence: { kind: "test" },
        normalizedConfiguration: {},
        contentHash: "project-two-replay",
      });
      const receipt = await fixture.database.persistManualEvent({
        organizationId: "org-1",
        projectId: fixture.execution.projectId,
        deliveryId: randomUUID(),
        source: "manual.replay",
        payload: { replay: true },
        receivedAt: new Date("2026-08-05T12:00:00.000Z"),
      });
      if (receipt.status !== "accepted") throw new Error("workflow receipt was not accepted");
      const acceptedInput = (projectId: string, revisionId: string, stepIds: string[]) => ({
        organizationId: "org-1",
        projectId,
        configurationRevisionId: revisionId,
        providerEventReceiptId: receipt.event.providerEventReceiptId,
        configuredTriggerName: "shared-trigger",
        prompt: "run",
        inputs: {},
        triggerContext: {},
        outputContext: {},
        deadlineAt: new Date("2026-08-05T13:00:00.000Z"),
        stepIds,
        createdAt: new Date("2026-08-05T12:00:00.000Z"),
      });
      const first = await fixture.database.createAcceptedTriggerRun(
        acceptedInput(fixture.execution.projectId, fixture.execution.configurationRevisionId, [
          "project-one-first",
          "project-one-second",
        ]),
      );
      const second = await fixture.database.createAcceptedTriggerRun(
        acceptedInput(projectTwoId, projectTwoRevision.id, [
          "project-two-first",
          "project-two-second",
        ]),
      );
      const firstReplay = await fixture.database.createAcceptedTriggerRun(
        acceptedInput(fixture.execution.projectId, fixture.execution.configurationRevisionId, [
          "ignored-first",
          "ignored-second",
        ]),
      );
      const secondReplay = await fixture.database.createAcceptedTriggerRun(
        acceptedInput(projectTwoId, projectTwoRevision.id, ["ignored-first", "ignored-second"]),
      );
      assert.equal(firstReplay.created, false);
      assert.equal(secondReplay.created, false);
      assert.equal(firstReplay.run.id, first.run.id);
      assert.equal(secondReplay.run.id, second.run.id);
      assert.notEqual(first.run.id, second.run.id);
      for (const [projectId, runId, stepIds] of [
        [fixture.execution.projectId, first.run.id, ["project-one-first", "project-one-second"]],
        [projectTwoId, second.run.id, ["project-two-first", "project-two-second"]],
      ] as const) {
        const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(runId);
        assert.deepEqual(
          steps.map((step) => [step.triggerRunId, step.stepId, step.ordinal]),
          stepIds.map((stepId, ordinal) => [runId, stepId, ordinal]),
        );
        const wakeup = await client.query(
          "select trigger_run_id from workflow_wakeups where trigger_run_id = $1",
          [runId],
        );
        assert.deepEqual(wakeup.rows, [{ trigger_run_id: runId }]);
        assert.equal((await fixture.database.findTriggerRunById(runId))?.projectId, projectId);
      }

      const rejection = {
        code: "invalid_choice" as const,
        inputName: "repo",
        value: "unknown",
        choices: ["hub"],
      };
      const rejectedInput = (projectId: string, revisionId: string) => ({
        organizationId: "org-1",
        projectId,
        configurationRevisionId: revisionId,
        providerEventReceiptId: receipt.event.providerEventReceiptId,
        configuredTriggerName: "shared-rejected-trigger",
        prompt: "repo=unknown",
        inputs: {},
        triggerContext: {},
        outputContext: {},
        rejection,
        createdAt: new Date("2026-08-05T12:00:00.000Z"),
      });
      const rejectedFirst = await fixture.database.createRejectedTriggerRun(
        rejectedInput(fixture.execution.projectId, fixture.execution.configurationRevisionId),
      );
      const rejectedSecond = await fixture.database.createRejectedTriggerRun(
        rejectedInput(projectTwoId, projectTwoRevision.id),
      );
      const rejectedFirstReplay = await fixture.database.createRejectedTriggerRun(
        rejectedInput(fixture.execution.projectId, fixture.execution.configurationRevisionId),
      );
      const rejectedSecondReplay = await fixture.database.createRejectedTriggerRun(
        rejectedInput(projectTwoId, projectTwoRevision.id),
      );
      assert.equal(rejectedFirstReplay.run.id, rejectedFirst.run.id);
      assert.equal(rejectedSecondReplay.run.id, rejectedSecond.run.id);
      assert.equal(rejectedFirstReplay.created, false);
      assert.equal(rejectedSecondReplay.created, false);
    } finally {
      await client.close();
      await fixture.database.close();
    }
  });

  it("atomically enforces the configured reply limit under concurrent callers", async () => {
    const fixture = await executionFixture(postgres);
    try {
      const attempts = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          fixture.database.beginAgentExecutionOutput(
            fixture.execution.id,
            "discord.reply",
            3,
            new Date(`2026-08-03T00:00:0${index}.000Z`),
          ),
        ),
      );

      assert.equal(attempts.filter((attempt) => attempt !== undefined).length, 3);
      assert.equal(
        Object.values(
          (await fixture.database.findAgentExecutionById(fixture.execution.id))
            ?.outputDeliveryAttempts ?? {},
        ).filter((attempt) => attempt.status === "pending").length,
        3,
      );
    } finally {
      await fixture.database.close();
    }
  });

  it("persists failed output attempts as retryable and records a successful retry idempotently", async () => {
    const fixture = await executionFixture(postgres);
    try {
      const first = await fixture.database.beginAgentExecutionOutput(
        fixture.execution.id,
        "discord.reply",
        1,
        new Date("2026-08-03T00:00:00.000Z"),
      );
      assert.ok(first);
      assert.equal(
        await fixture.database.failAgentExecutionOutput(
          fixture.execution.id,
          first.id,
          new Date("2026-08-03T00:00:01.000Z"),
        ),
        true,
      );
      const retry = await fixture.database.beginAgentExecutionOutput(
        fixture.execution.id,
        "discord.reply",
        1,
        new Date("2026-08-03T00:00:02.000Z"),
      );
      assert.ok(retry);
      const completed = await fixture.database.completeAgentExecutionOutput(
        fixture.execution.id,
        retry.id,
        new Date("2026-08-03T00:00:03.000Z"),
      );
      assert.ok(completed);
      const duplicateCompletion = await fixture.database.completeAgentExecutionOutput(
        fixture.execution.id,
        retry.id,
        new Date("2026-08-03T00:00:04.000Z"),
      );
      assert.ok(duplicateCompletion);

      const persisted = await fixture.database.findAgentExecutionById(fixture.execution.id);
      assert.deepEqual(persisted?.outputEmissions, { "discord.reply": 1 });
      assert.equal(persisted?.outputDeliveryAttempts[first.id]?.status, "failed");
      assert.equal(persisted?.outputDeliveryAttempts[retry.id]?.status, "succeeded");
    } finally {
      await fixture.database.close();
    }
  });
});

function launchIntent(
  triggerRunId: string,
  configurationRevisionId: string,
  triggerName: string,
): LaunchMachineIntent {
  return {
    kind: "launch_machine",
    organizationId: "org-1",
    projectId: "00000000-0000-4000-8000-000000000001",
    triggerRunId,
    triggerName,
    environmentName: "work",
    environment: {
      kind: "daemon",
      daemonId: "daemon-1",
      authoredSlug: "daemon",
      cwd: "/repo",
    },
    prompt: "run",
    agent: {
      provider: "test",
      mode: "full-access",
      options: { permission: { edit: "ask", bash: "deny" } },
    },
    allowOutputs: [],
    autoArchive: false,
    triggerContext: { provider: "slack" },
    outputContext: {},
    configurationRevisionId,
    hubConfig: {},
  };
}

function phaseOneMatch(
  configurationRevisionId: string,
  triggerName = "one-step",
  stepId = "step-one",
): TriggerProviderMatch {
  const base = launchIntent("trigger-placeholder", configurationRevisionId, triggerName);
  return {
    triggerName,
    triggerContext: base.triggerContext,
    outputContext: base.outputContext,
    configurationRevisionId,
    hubConfig: workflowConfiguration(triggerName, stepId),
    invocation: {
      status: "accepted",
      prompt: "run",
      inputs: {},
    },
  };
}

function postgresDeadlineEngine(
  database: Database,
  configuration: CompiledHubConfig,
  configurationRevisionId: string,
  now: () => Date,
  dispatches: string[],
) {
  return createDurableWorkflowHandler({
    database,
    entitlements: createUnlimitedEntitlementsService(),
    now,
    providers: [
      {
        name: "phase-five",
        eventNames: ["test.event"],
        async match() {
          const trigger = configuration.triggers[0]!;
          return [
            {
              triggerName: trigger.name,
              triggerContext: { provider: "phase-five" },
              outputContext: { provider: "phase-five" },
              configurationRevisionId,
              hubConfig: configuration,
              invocation: {
                status: "accepted",
                prompt: "run",
                inputs: {},
              },
            },
          ];
        },
      },
    ],
    dispatchLaunchMachineIntent: async (intent) => {
      dispatches.push(intent.prompt);
      return { execution: await persistedWorkflowExecution(database, intent) };
    },
  });
}

function restartMatch(configurationRevisionId: string): TriggerProviderMatch {
  const configuration = restartWorkflowConfiguration();
  return {
    triggerName: "restart-route",
    triggerContext: { provider: "test" },
    outputContext: { provider: "test" },
    configurationRevisionId,
    hubConfig: configuration,
    invocation: {
      status: "accepted",
      prompt: "repo=hub work",
      inputs: { repo: "hub" },
    },
  };
}

function workflowConfiguration(triggerName: string, stepId: string): CompiledHubConfig {
  return activateWorkflowConfiguration(
    compileHubConfig({
      environments: [{ name: "work", kind: "daemon", daemon: "daemon", cwd: "/repo" }],
      triggers: [
        {
          name: triggerName,
          on: "test.event",
          max_runtime: "1h",
          filters: { from_users: ["test"] },
          steps: [
            {
              id: stepId,
              environment: "work",
              max_runtime: "30s",
              idle_timeout: "5s",
              agent: { provider: "test" },
              prompt: [{ text: "run" }],
            },
          ],
        },
      ],
    }),
  );
}

function deadlineWorkflowConfiguration(
  options: {
    maxRuntime?: string;
    stepRuntime?: string;
    idleTimeout?: string;
    stepCount?: number;
  } = {},
): CompiledHubConfig {
  const stepCount = options.stepCount ?? 1;
  return activateWorkflowConfiguration(
    compileHubConfig({
      environments: [{ name: "work", kind: "daemon", daemon: "daemon", cwd: "/repo" }],
      triggers: [
        {
          name: `phase-five-${stepCount}-step`,
          on: "test.event",
          max_runtime: options.maxRuntime ?? "2m",
          filters: { from_users: ["test"] },
          steps: Array.from({ length: stepCount }, (_, index) => ({
            id: `phase-five-step-${index + 1}`,
            environment: "work",
            max_runtime: options.stepRuntime ?? "1m",
            idle_timeout: options.idleTimeout ?? "5s",
            agent: { provider: "test" },
            prompt: [{ text: "run" }],
          })),
        },
      ],
    }),
  );
}

function allWorkflowConfigurations(): CompiledHubConfig {
  const definitions = [
    ["one-step", "step-one"],
    ["first-route", "first-step"],
    ["second-route", "second-step"],
    ["accepted-route", "accepted-step"],
    ["rejected-route", "rejected-step"],
    ["second-rejected-route", "second-rejected-step"],
  ] as const;
  const configurations = definitions.map(([triggerName, stepId]) =>
    workflowConfiguration(triggerName, stepId),
  );
  const restart = restartWorkflowConfiguration();
  return {
    environments: configurations[0]!.environments,
    triggers: [
      ...configurations.flatMap((configuration) => configuration.triggers),
      ...restart.triggers,
    ],
  };
}

function restartWorkflowConfiguration(): CompiledHubConfig {
  return activateWorkflowConfiguration(
    compileHubConfig({
      environments: [{ name: "work", kind: "daemon", daemon: "daemon", cwd: "/repo" }],
      triggers: [
        {
          name: "restart-route",
          on: "test.event",
          max_runtime: "1h",
          filters: { from_users: ["test"] },
          inputs: { repo: { type: "string", choices: ["hub"] } },
          steps: [
            {
              id: "first",
              environment: "work",
              max_runtime: "30s",
              idle_timeout: "5s",
              agent: { provider: "test" },
              prompt: [{ text: "First" }],
            },
            {
              id: "downstream",
              if: "${{ paseo.inputs.repo == 'hub' }}",
              environment: "work",
              max_runtime: "30s",
              idle_timeout: "5s",
              agent: { provider: "test" },
              prompt: [{ text: "Downstream" }],
            },
          ],
        },
      ],
    }),
  );
}

function activateWorkflowConfiguration(configuration: CompiledHubConfig): CompiledHubConfig {
  return {
    environments: configuration.environments.map((environment) => {
      if (environment.kind !== "daemon") return environment;
      return {
        name: environment.name,
        kind: "daemon",
        daemon: environment.daemon,
        daemonId: "daemon-1",
        cwd: environment.cwd,
        ...(environment.worktree === undefined ? {} : { worktree: environment.worktree }),
      };
    }),
    triggers: configuration.triggers,
  };
}

async function insertWorkflowTrigger(
  database: Database,
  configurationRevisionId: string,
  deliveryId: string,
) {
  await database.activateProjectConfigurationRevision(
    "00000000-0000-4000-8000-000000000001",
    configurationRevisionId,
  );
  const result = await database.persistManualEvent({
    organizationId: "org-1",
    projectId: "00000000-0000-4000-8000-000000000001",
    deliveryId,
    source: "test.event",
    payload: { prompt: "raw" },
    receivedAt: new Date("2026-08-05T12:00:00.000Z"),
  });
  if (result.status !== "accepted") throw new Error("workflow receipt was not accepted");
  return { event: result.event };
}

async function persistedWorkflowExecution(
  database: Database,
  intent: { workflowStepRunId?: string },
): Promise<AgentExecutionRecord> {
  if (intent.workflowStepRunId === undefined) throw new Error("workflow step is required");
  const execution = await database.findAgentExecutionByWorkflowStepRunId(intent.workflowStepRunId);
  if (execution === undefined) throw new Error("workflow execution was not persisted");
  return execution;
}

function toDurableEvent(event: DurableProviderEvent): DurableProviderEvent {
  return event;
}

async function executionFixture(
  postgres: StartedPostgreSqlContainer,
): Promise<{ database: Database; execution: AgentExecutionRecord; databaseUrl: string }> {
  const url = new URL(postgres.getConnectionUri());
  url.pathname = `/execution_finality_${randomUUID().replaceAll("-", "")}`;
  const database = await createDatabase(url.toString());
  const client = await createPostgresQueryRuntime(url.toString());

  await client.query(
    "insert into organization (id, name, slug) values ('org-1', 'Finality', 'finality')",
  );
  await client.query(
    `insert into projects (id, organization_id, name, slug)
     values ('00000000-0000-4000-8000-000000000001', 'org-1', 'Default', 'default')`,
  );
  await client.close();

  const revisionConfiguration = allWorkflowConfigurations();
  const config = await database.insertProjectConfigurationRevision({
    projectId: "00000000-0000-4000-8000-000000000001",
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    normalizedConfiguration: revisionConfiguration,
    contentHash: compiledConfigurationHash(revisionConfiguration),
  });
  await database.activateProjectConfigurationRevision(
    "00000000-0000-4000-8000-000000000001",
    config.id,
  );
  const machine = await database.insertMachine({
    orgId: "org-1",
    source: { kind: "daemon", daemonId: "daemon-1" },
    status: "alive",
  });
  const execution = await database.insertAgentExecution({
    organizationId: "org-1",
    projectId: "00000000-0000-4000-8000-000000000001",
    machineId: machine.id,
    triggerContext: null,
    outputContext: null,
    configurationRevisionId: config.id,
  });
  await database.transitionAgentExecution(execution.id, "running");
  return { database, execution, databaseUrl: url.toString() };
}
