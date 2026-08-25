import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, vi } from "vitest";
import {
  compileHubConfig,
  compiledConfigurationHash,
  type CompiledAgent,
  type CompiledHubConfig,
} from "../config/compiler.js";
import { compileHubBundle } from "../config/bundle.js";
import {
  hashPromptPartialContent,
  type ResolvedPromptPartials,
} from "../config/prompt-partials.js";
import { createMemoryDatabase } from "../db/memory.js";
import type {
  Database,
  DurableProviderEvent,
  ProviderEventReceiptRecord,
  TriggerRunRecord,
} from "../db/types.js";
import type { AcceptedTriggerProviderMatch } from "../triggers/index.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import { parseInvocation } from "../triggers/invocation.js";
import { UNLIMITED_TEMPLATE } from "../entitlements/catalog.js";
import { EntitlementsService } from "../entitlements/service.js";
import { createDurableWorkflowHandler } from "./engine.js";
import { currentProjectConfigurationFiles } from "../test-utils/current-project-configuration.js";
import { createLogger } from "../logger.js";
import { assertOneFailure, FailureLogStream } from "../test-utils/failure-logs.js";

describe("durable multi-step workflow engine", () => {
  it.each(["github", "discord"] as const)(
    "materializes one reusable environment from each %s execution identity before persistence",
    async (providerName) => {
      const rawConfiguration = executionWorktreeConfiguration();
      const fixture = await workflowFixture({ rawConfiguration });
      const baseProvider = providerMatch(fixture.configuration, fixture.revisionId);
      const provider = {
        ...baseProvider,
        name: providerName,
        async match(event) {
          const [match] = await baseProvider.match(event);
          assert.ok(match);
          return fixture.configuration.triggers.map((trigger) => ({
            ...match,
            triggerName: trigger.name,
            triggerContext: { provider: providerName },
            outputContext: { provider: providerName },
          }));
        },
      } satisfies import("../triggers/index.js").TriggerProvider;
      const intents: LaunchMachineIntent[] = [];
      const { handler, engine } = createDurableWorkflowHandler({
        database: fixture.database,
        entitlements: fixture.entitlements,
        providers: [provider],
        dispatchLaunchMachineIntent: async (intent) => {
          intents.push(intent);
          const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
            intent.workflowStepRunId!,
          );
          assert.ok(execution);
          return { execution };
        },
      });

      await handler(fixture.trigger("the triggering body"));
      await engine.processAvailable();

      assert.equal(intents.length, 2);
      const branches = intents.map((intent) => {
        assert.equal(intent.environment.worktree?.mode, "branch-off");
        if (intent.environment.worktree?.mode !== "branch-off") return "";
        assert.equal(JSON.stringify(intent.environment.worktree).includes("${{"), false);
        return intent.environment.worktree.newBranch;
      });
      assert.equal(new Set(branches).size, 2);
      for (const intent of intents) {
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        assert.ok(execution);
        assert.equal(
          execution.launchIntent?.environment.worktree?.mode === "branch-off"
            ? execution.launchIntent.environment.worktree.newBranch
            : undefined,
          `trigger-${execution.id}`,
        );
      }
    },
  );

  it("materializes ambient context only for the step that authors paseo.context", async () => {
    const fixture = await workflowFixture({ rawConfiguration: contextOptInConfiguration() });
    const prompts: string[] = [];
    const materializedExecutionIds: string[] = [];
    const baseProvider = providerMatch(fixture.configuration, fixture.revisionId);
    const provider = {
      ...baseProvider,
      async materializeContext(launch) {
        materializedExecutionIds.push(launch.executionId);
        assert.equal(launch.providerEventReceiptId, fixture.providerEventReceiptId);
        return { manual: { item: { title: "ambient" } } };
      },
    } satisfies import("../triggers/index.js").TriggerProvider;
    const { handler, engine } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [provider],
      dispatchLaunchMachineIntent: async (intent) => {
        if (intent.prompt === "Trigger: the triggering body") {
          assert.deepEqual(materializedExecutionIds, []);
        }
        prompts.push(intent.prompt);
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        assert.ok(execution);
        return { execution };
      },
    });

    await handler(fixture.trigger("the triggering body"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const firstStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const firstExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      firstStep.id,
    );
    assert.ok(firstExecution);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: firstExecution.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded" },
      stepOutput: null,
      completedByAgent: true,
    });
    await engine.processAvailable();

    assert.deepEqual(prompts, [
      "Trigger: the triggering body",
      'Context: {"manual":{"item":{"title":"ambient"}}}\nTrigger: the triggering body',
    ]);
    assert.equal(materializedExecutionIds.length, 1);
  });

  it("fails an explicit context opt-in when its provider cannot materialize context", async () => {
    const fixture = await workflowFixture({ rawConfiguration: contextOnlyConfiguration() });
    const { handler, engine } = engineFor(fixture, []);

    await handler(fixture.trigger("the triggering body"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;

    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "failed");
    assert.equal(steps[0]?.status, "failed");
    assert.equal(steps[0]?.failureReason, "trigger_context_materializer_unavailable");
  });

  it("carries provider options unchanged into persisted and dispatched launch intent", async () => {
    const rawConfiguration = deadlineConfiguration();
    const options = {
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: false,
      },
    };
    const triggers = readUnknownArray(rawConfiguration["triggers"]);
    if (triggers === undefined) throw new Error("test trigger unavailable");
    const trigger = triggers[0];
    if (!isRecord(trigger)) throw new Error("test trigger unavailable");
    const steps = readUnknownArray(trigger["steps"]);
    if (steps === undefined) throw new Error("test steps unavailable");
    const authoredStep = steps[0];
    if (!isRecord(authoredStep)) throw new Error("test step unavailable");
    const agent = authoredStep["agent"];
    if (!isRecord(agent)) throw new Error("test agent unavailable");
    Reflect.set(agent, "options", options);
    const fixture = await workflowFixture({ rawConfiguration });
    let dispatched: LaunchMachineIntent | undefined;
    const { handler, engine } = engineFor(fixture, [], async (intent) => {
      dispatched = intent;
    });

    await handler(fixture.trigger("run"));
    await engine.processAvailable();

    assert.deepEqual(dispatched?.agent, { provider: "codex", options });
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const persistedStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    assert.deepEqual(persistedStep.dispatchIntent?.agent, { provider: "codex", options });
  });

  it("logs an initial recovery rejection and retries on the next interval", async () => {
    vi.useFakeTimers();
    const canary = "workflow-recovery-secret-61f4";
    const stream = new FailureLogStream();
    const fixture = await workflowFixture();
    const recovery = vi
      .spyOn(fixture.database, "recoverWorkflowDeadlines")
      .mockRejectedValueOnce(new Error(canary));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const { engine } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [providerMatch(fixture.configuration, fixture.revisionId)],
      workerIntervalMs: 10,
      logger: createLogger(stream),
      dispatchLaunchMachineIntent: async (intent) => {
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return { execution };
      },
    });
    try {
      engine.start();
      assert.equal(recovery.mock.calls.length, 1);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      assert.equal(recovery.mock.calls.length, 2);
      assert.deepEqual(unhandled, []);
      assertOneFailure(stream, {
        operation: "workflow.worker.recover",
        component: "workflows",
        canary,
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await engine.stop();
      vi.useRealTimers();
    }
  });

  it.each([
    ["succeeded", "succeeded"],
    ["failed", "failed"],
  ] as const)(
    "notifies the provider once when the whole workflow %s",
    async (stepStatus, expected) => {
      const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
      const terminalStatuses: string[] = [];
      const { handler, engine } = engineFor(fixture, [], undefined, undefined, async (run) => {
        terminalStatuses.push(run.status);
      });
      await handler(fixture.trigger("run"));
      await engine.processAvailable();
      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          fixture.providerEventReceiptId,
        )
      )[0]!;
      let steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
      const first = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id);
      assert.ok(first);
      await fixture.database.transitionAgentExecution(first.id, stepStatus, {
        result: { status: stepStatus },
      });
      await engine.processAvailable();
      if (stepStatus === "succeeded") {
        assert.deepEqual(terminalStatuses, []);
        steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
        const second = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[1]!.id);
        assert.ok(second);
        await fixture.database.transitionAgentExecution(second.id, "succeeded", {
          result: { status: "succeeded" },
        });
        await engine.processAvailable();
      }
      await engine.processAvailable();
      assert.deepEqual(terminalStatuses, [expected]);
    },
  );

  it("retries a failed workflow terminal outbox delivery", async () => {
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    let now = new Date("2026-08-06T12:00:00.000Z");
    const delivered: string[] = [];
    let failFirst = true;
    const { handler, engine } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [providerMatch(fixture.configuration, fixture.revisionId)],
      now: () => now,
      leaseMs: 1_000,
      dispatchLaunchMachineIntent: async (intent) => {
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return { execution };
      },
      onWorkflowRunTerminal: async (run) => {
        delivered.push(run.id);
        if (failFirst) {
          failFirst = false;
          throw new Error("provider unavailable");
        }
      },
    });
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const first = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!.id,
    );
    assert.ok(first);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: first.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded" },
      observedAt: now,
    });
    await fixture.database.wakeWorkflowRun(run.id, now);
    await engine.processAvailable();
    const secondStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[1]!;
    const second = await fixture.database.findAgentExecutionByWorkflowStepRunId(secondStep.id);
    assert.ok(second);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: second.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded" },
      observedAt: now,
    });
    await fixture.database.wakeWorkflowRun(run.id, now);

    await engine.processAvailable();
    assert.deepEqual(delivered, [run.id]);
    const failedDelivery = await fixture.database.findTriggerRunById(run.id);
    assert.equal(
      failedDelivery?.outcome === "accepted"
        ? failedDelivery.terminalNotificationDeliveredAt
        : "missing",
      null,
    );

    now = new Date("2026-08-06T12:00:01.001Z");
    await engine.processAvailable();
    assert.deepEqual(delivered, [run.id, run.id]);
    const completedDelivery = await fixture.database.findTriggerRunById(run.id);
    assert.equal(
      completedDelivery?.outcome === "accepted"
        ? completedDelivery.terminalNotificationDeliveredAt !== null
        : false,
      true,
    );
  });

  it("does not lose a terminal notification requested during an empty recovery pass", async () => {
    const fixture = await workflowFixture({ rawConfiguration: allSkippedConfiguration() });
    let releaseInitialClaim!: () => void;
    const initialClaimRelease = new Promise<void>((resolve) => {
      releaseInitialClaim = resolve;
    });
    let markInitialClaimStarted!: () => void;
    const initialClaimStarted = new Promise<void>((resolve) => {
      markInitialClaimStarted = resolve;
    });
    const controlledDatabase = delayFirstEmptyTerminalClaim(
      fixture.database,
      markInitialClaimStarted,
      initialClaimRelease,
    );
    const delivered: string[] = [];
    const { handler, engine } = engineFor(
      { ...fixture, database: controlledDatabase },
      [],
      undefined,
      undefined,
      async (run) => {
        delivered.push(run.id);
      },
    );

    await handler(fixture.trigger("run"));
    const processing = engine.processAvailable();
    await initialClaimStarted;
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    await waitUntil(
      async () => (await fixture.database.findTriggerRunById(run.id))?.status === "succeeded",
    );
    releaseInitialClaim();
    await processing;
    await waitUntil(() => Promise.resolve(delivered.length === 1));

    assert.deepEqual(delivered, [run.id]);
  });

  it("keeps processing ready wakeups while a terminal provider hook is held", async () => {
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    let releaseTerminalHook: (() => void) | undefined;
    const terminalHookStarted = new Promise<void>((resolve) => {
      releaseTerminalHook = resolve;
    });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, undefined, async () => {
      await terminalHookStarted;
    });

    try {
      await handler(fixture.trigger("run"));
      await engine.processAvailable();
      const firstRun = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          fixture.providerEventReceiptId,
        )
      )[0]!;
      const firstSteps = await fixture.database.listWorkflowStepRunsForTriggerRun(firstRun.id);
      const firstExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
        firstSteps[0]!.id,
      );
      assert.ok(firstExecution);
      await fixture.database.completeWorkflowAgentExecution({
        executionId: firstExecution.id,
        executionStatus: "failed",
        stepStatus: "failed",
        result: { status: "failed" },
        observedAt: new Date(),
      });
      await fixture.database.wakeWorkflowRun(firstRun.id, new Date());

      const terminalPassCompleted = engine.processAvailable().then(() => true);
      assert.equal(await settlesQuickly(terminalPassCompleted), true);

      const secondReceipt = await fixture.database.persistManualEvent({
        organizationId: "org-1",
        projectId: fixture.projectId,
        deliveryId: randomUUID(),
        source: "manual.run",
        payload: {},
        receivedAt: new Date(),
      });
      if (secondReceipt.status !== "accepted") throw new Error("second receipt was not accepted");
      await handler({
        ...fixture.trigger("run"),
        providerEventReceiptId: secondReceipt.event.providerEventReceiptId,
        deliveryId: secondReceipt.event.deliveryId,
      });
      await engine.processAvailable();

      assert.equal(dispatches.length, 2);
    } finally {
      releaseTerminalHook?.();
      await engine.stop();
    }
  });

  it("keeps a shared accepted receipt replayable when one project route has no workflow match", async () => {
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    const secondProject = await fixture.database.createProject({
      organizationId: "org-1",
      name: "Other Workflow",
      slug: randomUUID(),
      createdByUserId: "user-1",
    });
    const secondRevision = await fixture.database.insertProjectConfigurationRevision({
      projectId: secondProject.id,
      sourceKind: "manual",
      sourceEvidence: { kind: "test" },
      normalizedConfiguration: fixture.configuration,
      contentHash: compiledConfigurationHash(fixture.configuration),
      createdByUserId: "user-1",
    });
    await fixture.database.activateProjectConfigurationRevision(
      secondProject.id,
      secondRevision.id,
      [],
    );
    const receipt = await fixture.database.findProviderEventReceiptById(
      fixture.providerEventReceiptId,
    );
    assert.ok(receipt);
    setAcceptedRoutes(fixture.database, {
      ...receipt,
      acceptedRoutes: [
        {
          projectId: fixture.projectId,
          configurationRevisionId: fixture.revisionId,
          connectionId: null,
          resourceId: null,
        },
        {
          projectId: secondProject.id,
          configurationRevisionId: secondRevision.id,
          connectionId: null,
          resourceId: null,
        },
      ],
    });
    const { handler } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [
        {
          name: "manual",
          eventNames: ["manual.run"] as const,
          async match(external) {
            if (external.projectId === fixture.projectId) return "no_trigger_for_source";
            throw new Error("enqueue unavailable");
          },
        },
      ],
    });

    await assert.rejects(
      handler({
        ...fixture.trigger("run"),
        projectId: secondProject.id,
        configurationRevisionId: secondRevision.id,
      }),
      /enqueue unavailable/iu,
    );
    assert.deepEqual(await handler(fixture.trigger("run")), {
      providerEventReceiptId: fixture.providerEventReceiptId,
    });
    const replay = await fixture.database.persistManualEvent({
      organizationId: "org-1",
      projectId: fixture.projectId,
      deliveryId: fixture.deliveryId,
      source: "manual.run",
      payload: {},
      receivedAt: new Date(),
    });
    assert.equal(replay.status, "accepted");
    const replayReceipt = await fixture.database.findProviderEventReceiptById(
      fixture.providerEventReceiptId,
    );
    assert.equal(replayReceipt?.droppedReason, "no_trigger_for_source");
  });

  it("launches the exact committed partial content with inline-equivalent interpolation", async () => {
    const content = "Committed partial for ${{ paseo.prompt }} / ${{ paseo.inputs.repo }}";
    const fixture = await workflowFixture({
      rawConfiguration: partialRuntimeConfiguration(),
      resolvedPromptPartials: new Map([
        [
          ".paseo/workflows/partials/instructions.md",
          {
            path: ".paseo/workflows/partials/instructions.md",
            content,
            contentHash: hashPromptPartialContent(content),
          },
        ],
      ]),
    });
    const dispatches: string[] = [];
    const prompts: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, async (intent) => {
      prompts.push(intent.prompt);
    });

    await handler(fixture.trigger("repo=hub request"));
    await engine.processAvailable();

    assert.deepEqual(dispatches, ["unknown"]);
    assert.deepEqual(prompts, [
      "Committed partial for repo=hub request / hub\nInline repo=hub request / hub",
    ]);
  });

  it("skips classification for deterministic input and launches only the matching branch", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("repo=hub work"));
    assert.equal(
      (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          fixture.providerEventReceiptId,
        )
      ).length,
      1,
    );
    await engine.processAvailable();

    let run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0];
    assert.ok(run && run.outcome === "accepted");
    let steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.deepEqual(
      steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "skipped"],
        ["work-hub", "running"],
        ["work-paseo", "pending"],
      ],
    );
    assert.deepEqual(dispatches, ["work-hub"]);

    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[1]!.id);
    assert.ok(execution);
    await fixture.database.transitionAgentExecution(execution.id, "succeeded", {
      result: { status: "succeeded" },
    });
    await fixture.database.completeWorkflowStep(execution.id, "succeeded", { status: "succeeded" });
    await engine.processAvailable();
    run = await fixture.database.findTriggerRunById(run.id);
    assert.equal(run?.status, "succeeded");
    steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.deepEqual(
      steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "skipped"],
        ["work-hub", "succeeded"],
        ["work-paseo", "skipped"],
      ],
    );
  });

  it("runs classification when input is absent and composes its validated output", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("investigate"));
    await engine.processAvailable();
    assert.deepEqual(dispatches, ["classify"]);
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id);
    assert.ok(classifier);

    await fixture.database.completeWorkflowAgentExecution({
      executionId: classifier.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded", output: { repo: "paseo" } },
      stepOutput: { repo: "paseo" },
      completedByAgent: true,
    });
    await engine.processAvailable();
    assert.deepEqual(dispatches, ["classify", "work-paseo"]);
    assert.equal(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[1]!.status,
      "skipped",
    );
  });

  it("materializes finite named environment and agent selections from classifier output", async () => {
    const fixture = await workflowFixture({
      rawConfiguration: namedSelectionConfiguration(),
      namedAgents: {
        codex: {
          provider: "codex",
          model: "gpt-5.5",
          options: {
            sandbox_workspace_write: {
              writable_roots: ["/var/cache/npm"],
              network_access: false,
            },
          },
        },
        claude: { provider: "claude", model: "claude-opus-4-8" },
      },
    });
    const dispatches: LaunchMachineIntent[] = [];
    const { handler, engine } = engineFor(fixture, [], async (intent) => {
      dispatches.push(intent);
    });

    await handler(fixture.trigger("investigate"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const classifierStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      classifierStep.id,
    );
    assert.ok(classifier);

    await fixture.database.completeWorkflowAgentExecution({
      executionId: classifier.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: {
        status: "succeeded",
        output: { environment: "hub", agent: "codex" },
      },
      stepOutput: { environment: "hub", agent: "codex" },
      completedByAgent: true,
    });
    await engine.processAvailable();

    assert.equal(dispatches[1]?.environmentName, "hub");
    assert.deepEqual(dispatches[1]?.agent, {
      provider: "codex",
      model: "gpt-5.5",
      options: {
        sandbox_workspace_write: {
          writable_roots: ["/var/cache/npm"],
          network_access: false,
        },
      },
    });
  });

  it("activates and executes the migrated current-project classifier-to-worker fixture", async () => {
    const bundle = compileHubBundle(await currentProjectConfigurationFiles());
    const fixture = await workflowFixture({ compiledConfiguration: bundle.configuration });
    const dispatches: LaunchMachineIntent[] = [];
    const { handler, engine } = engineFor(fixture, [], async (intent) => {
      dispatches.push(intent);
    });

    await handler(fixture.trigger("investigate the routing failure"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const classifierStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      classifierStep.id,
    );
    assert.ok(classifier);
    assert.equal(dispatches[0]?.environmentName, "hub");
    assert.deepEqual(dispatches[0]?.agent, { provider: "claude", mode: "bypassPermissions" });

    await fixture.database.completeWorkflowAgentExecution({
      executionId: classifier.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: {
        status: "succeeded",
        output: { environment: "hub", agent: "codex" },
      },
      stepOutput: { environment: "hub", agent: "codex" },
      completedByAgent: true,
    });
    await engine.processAvailable();

    assert.deepEqual(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id)).map(
        ({ stepId }) => stepId,
      ),
      ["classify", "work"],
    );
    assert.equal(dispatches[1]?.environmentName, "hub");
    assert.equal(dispatches[1]?.prompt, "investigate the routing failure");
    assert.deepEqual(dispatches[1]?.agent, {
      provider: "codex",
      model: "gpt-5.5",
      thinkingOptionId: "xhigh",
      options: {
        sandbox_workspace_write: {
          writable_roots: ["/var/cache/npm"],
          network_access: false,
        },
      },
    });
    assert.deepEqual(dispatches[1]?.allowOutputs, [
      { type: "discord.reply", max: 1, required: true },
    ]);
  });

  it("fails when an unavailable output is evaluated outside a short-circuited branch", async () => {
    const fixture = await workflowFixture({ unavailableValue: true });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("repo=hub work"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.status, "failed");
    assert.match(run.failureReason ?? "", /unavailable|evaluation/iu);
    assert.deepEqual(dispatches, []);
  });

  it("fails prompt interpolation that reads a skipped prior step output without dispatching", async () => {
    const fixture = await workflowFixture({ rawConfiguration: skippedOutputPromptConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.equal(run.status, "failed");
    assert.match(run.failureReason ?? "", /steps\.classify\.outputs\.repo|unavailable/iu);
    assert.deepEqual(
      steps.map((step) => [step.stepId, step.status]),
      [
        ["classify", "skipped"],
        ["work", "failed"],
      ],
    );
    assert.deepEqual(dispatches, []);
  });

  it("does not persist or dispatch skipped-step GitHub authority", async () => {
    const fixture = await workflowFixture({ rawConfiguration: skippedAuthorityConfiguration() });
    const intents: LaunchMachineIntent[] = [];
    const { handler, engine } = engineFor(fixture, [], async (intent) => {
      intents.push(intent);
    });

    await handler(fixture.trigger("run"));
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.deepEqual(
      steps.map((step) => [step.stepId, step.status]),
      [
        ["classifier", "skipped"],
        ["work", "running"],
      ],
    );
    assert.equal(
      await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id),
      undefined,
    );
    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.github, undefined);
    assert.deepEqual(intents[0]?.env, {
      SOME_TOKEN: "${{ paseo.connections.some-connection.token }}",
    });
  });

  it("persists final values composed from a one-step structured output", async () => {
    const fixture = await workflowFixture({ rawConfiguration: finalValueConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("run"));
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
    assert.ok(execution);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: execution.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded", output: { decision: "ship" } },
      stepOutput: { decision: "ship" },
      completedByAgent: true,
    });
    await engine.processAvailable();

    const completed = await fixture.database.findTriggerRunById(run.id);
    assert.equal(completed?.status, "succeeded");
    assert.deepEqual(completed?.values, { final_decision: "ship" });
  });

  it("fails a classifier without launching downstream work", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("investigate"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id);
    assert.ok(classifier);
    await fixture.database.transitionAgentExecution(classifier.id, "failed", {
      result: { reason: "classifier_failed" },
    });
    await fixture.database.completeWorkflowStep(
      classifier.id,
      "failed",
      { reason: "classifier_failed" },
      "classifier_failed",
    );
    await engine.processAvailable();
    assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "failed");
    assert.deepEqual(dispatches, ["classify"]);
  });

  it("times out a classifier without launching downstream work", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("investigate"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id);
    assert.ok(classifier);
    await fixture.database.transitionAgentExecution(classifier.id, "failed", {
      result: { reason: "timed_out" },
    });
    await fixture.database.completeWorkflowStep(
      classifier.id,
      "timed_out",
      { reason: "timed_out" },
      "timed_out",
    );
    await engine.processAvailable();
    assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "timed_out");
    assert.deepEqual(dispatches, ["classify"]);
  });

  it("restarts after structured completion and creates exactly one downstream execution", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const first = engineFor(fixture, dispatches);
    await first.handler(fixture.trigger("investigate"));
    await first.engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const classifierStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const classifier = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      classifierStep.id,
    );
    assert.ok(classifier);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: classifier.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded", output: { repo: "hub" } },
      stepOutput: { repo: "hub" },
      completedByAgent: true,
    });

    const restarted = engineFor(fixture, dispatches);
    await restarted.engine.processAvailable();
    await fixture.database.wakeWorkflowRun(run.id, new Date());
    await restarted.engine.processAvailable();
    assert.deepEqual(dispatches, ["classify", "work-hub"]);
    assert.equal(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id)).filter(
        (step) => step.agentExecutionId !== null,
      ).length,
      2,
    );
  });

  it.each([
    { terminalStatus: "succeeded" as const, expectedRunStatus: "running" as const },
    { terminalStatus: "failed" as const, expectedRunStatus: "failed" as const },
  ])(
    "reconciles a terminal $terminalStatus execution before evaluating downstream work",
    async ({ terminalStatus, expectedRunStatus }) => {
      const fixture = await workflowFixture({ terminalRecovery: true });
      const dispatches: string[] = [];
      const first = engineFor(fixture, dispatches);
      await first.handler(fixture.trigger("repo=hub work"));
      await first.engine.processAvailable();

      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          fixture.providerEventReceiptId,
        )
      )[0]!;
      const firstStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
      const firstExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
        firstStep.id,
      );
      assert.ok(firstExecution);
      assert.deepEqual(dispatches, ["first"]);

      await fixture.database.transitionAgentExecution(firstExecution.id, terminalStatus, {
        result: { status: terminalStatus },
      });

      const restarted = engineFor(fixture, dispatches, async (intent) => {
        if (intent.prompt !== "Downstream") return;
        assert.equal(
          (await fixture.database.findWorkflowStepRunById(firstStep.id))?.status,
          terminalStatus,
        );
      });
      await restarted.engine.processAvailable();
      await restarted.engine.processAvailable();

      assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, expectedRunStatus);
      assert.equal(
        (await fixture.database.findWorkflowStepRunById(firstStep.id))?.status,
        terminalStatus,
      );
      assert.deepEqual(
        dispatches,
        terminalStatus === "succeeded" ? ["first", "downstream"] : ["first"],
      );
    },
  );

  it.each([
    { executionStatus: "succeeded" as const, stepStatus: "succeeded" as const },
    { executionStatus: "failed" as const, stepStatus: "failed" as const },
    { executionStatus: "failed" as const, stepStatus: "timed_out" as const },
  ])(
    "atomically completes workflow-owned $stepStatus agent executions in memory",
    async ({ executionStatus, stepStatus }) => {
      const fixture = await workflowFixture({ terminalRecovery: true });
      const dispatches: string[] = [];
      const { handler, engine } = engineFor(fixture, dispatches);
      await handler(fixture.trigger("repo=hub work"));
      await engine.processAvailable();
      const run = (
        await fixture.database.findTriggerRunsByProviderEventReceiptId(
          fixture.providerEventReceiptId,
        )
      )[0]!;
      const firstStep = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
      const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(firstStep.id);
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
        stepStatus === "succeeded" ? ["first", "downstream"] : ["first"],
      );
    },
  );

  it("persists step hard and idle deadlines capped by the whole-run deadline", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
    assert.ok(execution);
    assert.equal(execution.deadlineAt?.toISOString(), "2026-08-06T12:01:00.000Z");
    assert.equal(execution.idleDeadlineAt?.toISOString(), "2026-08-06T12:00:20.000Z");

    assert.equal(run.deadlineAt.toISOString(), "2026-08-06T12:02:00.000Z");
  });

  it("times out a live step when the whole-run deadline expires", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({
      rawConfiguration: deadlineConfiguration({ idleTimeout: "1m" }),
    });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
    assert.ok(execution);

    now = new Date("2026-08-06T12:02:00.000Z");
    await engine.processAvailable();

    assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "timed_out");
    assert.equal((await fixture.database.findWorkflowStepRunById(step.id))?.status, "timed_out");
    assert.equal((await fixture.database.findAgentExecutionById(execution.id))?.status, "failed");
  });

  it("fails a step at its hard deadline without extending the run", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({
      rawConfiguration: deadlineConfiguration({ idleTimeout: "1m" }),
    });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    now = new Date("2026-08-06T12:01:00.000Z");
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    assert.equal(run.status, "failed");
    assert.equal(run.deadlineKind, "step_hard");
    assert.equal(step.status, "timed_out");
    assert.equal(step.deadlineKind, "step_hard");
    assert.equal(dispatches.length, 1);
  });

  it("refreshes only the persisted idle deadline for a live workflow step", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
    assert.ok(execution);
    const hardDeadline = execution.deadlineAt;

    now = new Date("2026-08-06T12:00:10.000Z");
    const refreshed = await fixture.database.setAgentExecutionIdleDeadline(
      execution.id,
      new Date("2026-08-06T12:00:30.000Z"),
      now,
      now,
    );
    assert.equal(refreshed.deadlineAt?.getTime(), hardDeadline?.getTime());
    assert.equal(refreshed.idleDeadlineAt?.toISOString(), "2026-08-06T12:00:30.000Z");
    assert.equal(
      (await fixture.database.findWorkflowStepRunById(step.id))?.idleDeadlineAt?.toISOString(),
      "2026-08-06T12:00:30.000Z",
    );
  });

  it("does not dispatch a later step after the whole-run deadline between steps", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const first = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const firstExecution = await fixture.database.findAgentExecutionByWorkflowStepRunId(first.id);
    assert.ok(firstExecution);
    await fixture.database.transitionAgentExecution(firstExecution.id, "succeeded", {
      result: { status: "succeeded" },
    });
    await fixture.database.completeWorkflowStep(firstExecution.id, "succeeded", {
      status: "succeeded",
    });

    now = new Date("2026-08-06T12:02:00.000Z");
    await engine.processAvailable();

    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    assert.equal(dispatches.length, 1);
    assert.equal((await fixture.database.findTriggerRunById(run.id))?.status, "timed_out");
    assert.equal(steps[1]?.status, "timed_out");
    assert.equal(steps[1]?.deadlineKind, "whole_run");
  });

  it("wins a completion-at-deadline race with the deadline transition", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({
      rawConfiguration: deadlineConfiguration({ idleTimeout: "1m" }),
    });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches, undefined, () => now);

    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.outcome, "accepted");
    const step = (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(step.id);
    assert.ok(execution);
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
  });

  it("meters one unit per execution, not once per trigger, across a multi-step workflow", async () => {
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const first = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!.id,
    );
    assert.ok(first);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: first.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded" },
      observedAt: new Date(),
    });
    await fixture.database.wakeWorkflowRun(run.id, new Date());
    await engine.processAvailable();

    // Two executions were created, so two units were consumed — the old once-per-trigger meter
    // would report 1 here.
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 2);
    assert.equal(dispatches.length, 2);
  });

  it("denies the second execution once the meter is full and fails that run with the reason", async () => {
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    await fixture.entitlements.override(
      "org-1",
      { meters: { "executions.monthly": { limit: 1 } } },
      "admin-1",
      "Trial cap",
    );
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("run"));
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const first = await fixture.database.findAgentExecutionByWorkflowStepRunId(
      (await fixture.database.listWorkflowStepRunsForTriggerRun(run.id))[0]!.id,
    );
    assert.ok(first);
    await fixture.database.completeWorkflowAgentExecution({
      executionId: first.id,
      executionStatus: "succeeded",
      stepStatus: "succeeded",
      result: { status: "succeeded" },
      observedAt: new Date(),
    });
    await fixture.database.wakeWorkflowRun(run.id, new Date());
    await engine.processAvailable();

    const failed = await fixture.database.findTriggerRunById(run.id);
    assert.equal(failed?.status, "failed");
    assert.match(
      failed?.outcome === "accepted" ? (failed.failureReason ?? "") : "",
      /executions\.monthly/u,
    );
    // Only the first execution was ever created; the denied second one reserved nothing.
    assert.equal(dispatches.length, 1);
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);
  });

  it("denies a second single-execution trigger once the meter is full", async () => {
    const fixture = await workflowFixture();
    await fixture.entitlements.override(
      "org-1",
      { meters: { "executions.monthly": { limit: 1 } } },
      "admin-1",
      "Trial cap",
    );
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);

    await handler(fixture.trigger("repo=hub work"));
    await engine.processAvailable();
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);

    const second = await fixture.database.persistManualEvent({
      organizationId: "org-1",
      projectId: fixture.projectId,
      deliveryId: randomUUID(),
      source: "manual.run",
      payload: {},
      receivedAt: new Date(),
    });
    if (second.status !== "accepted") throw new Error("second receipt was not accepted");
    await handler({
      ...fixture.trigger("repo=hub work"),
      providerEventReceiptId: second.event.providerEventReceiptId,
      deliveryId: second.event.deliveryId,
    });
    await engine.processAvailable();

    const secondRun = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(
        second.event.providerEventReceiptId,
      )
    )[0];
    assert.equal(secondRun?.status, "failed");
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);
    assert.equal(dispatches.length, 1);
  });

  it("meters nothing when an accepted trigger skips every step", async () => {
    const fixture = await workflowFixture({ rawConfiguration: allSkippedConfiguration() });
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    await engine.processAvailable();

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    assert.equal(run.status, "succeeded");
    assert.deepEqual(dispatches, []);
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 0);
  });

  it("does not double-consume when an already-running execution is replayed", async () => {
    const fixture = await workflowFixture();
    const dispatches: string[] = [];
    const { handler, engine } = engineFor(fixture, dispatches);
    await handler(fixture.trigger("repo=hub work"));
    await engine.processAvailable();
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);

    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    await fixture.database.wakeWorkflowRun(run.id, new Date());
    await engine.processAvailable();

    // The step's execution is already live, so re-processing the wakeup creates nothing new.
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);
    assert.equal(dispatches.length, 1);
  });

  it("does not double-consume when dispatch crashes after an execution is reserved", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({ rawConfiguration: deadlineConfiguration() });
    let crashNextDispatch = true;
    const { handler, engine } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [providerMatch(fixture.configuration, fixture.revisionId)],
      now: () => now,
      leaseMs: 1_000,
      dispatchLaunchMachineIntent: async (intent) => {
        if (crashNextDispatch) {
          crashNextDispatch = false;
          throw new Error("dispatch crashed after reservation");
        }
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return { execution };
      },
    });
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    // The execution was created and one unit reserved before dispatch threw.
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);

    now = new Date("2026-08-06T12:00:02.000Z");
    await engine.processAvailable();

    // Recovery re-dispatches the already-created execution; it does not reserve a second unit.
    assert.equal((await fixture.entitlements.usage("org-1", "executions.monthly")).used, 1);
  });

  it("does not rematerialize context when recovering a persisted pre-handoff execution", async () => {
    let now = new Date("2026-08-06T12:00:00.000Z");
    const fixture = await workflowFixture({ rawConfiguration: contextOnlyConfiguration() });
    let materializations = 0;
    let crashNextDispatch = true;
    const provider = {
      ...providerMatch(fixture.configuration, fixture.revisionId),
      async materializeContext() {
        materializations += 1;
        return { ambient: "once" };
      },
    } satisfies import("../triggers/index.js").TriggerProvider;
    const { handler, engine } = createDurableWorkflowHandler({
      database: fixture.database,
      entitlements: fixture.entitlements,
      providers: [provider],
      now: () => now,
      leaseMs: 1_000,
      dispatchLaunchMachineIntent: async (intent) => {
        if (crashNextDispatch) {
          crashNextDispatch = false;
          throw new Error("dispatch crashed after reservation");
        }
        const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId!,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return { execution };
      },
    });
    await handler(fixture.trigger("run"));
    await engine.processAvailable();
    now = new Date("2026-08-06T12:00:02.000Z");
    await engine.processAvailable();

    assert.equal(materializations, 1);
    const run = (
      await fixture.database.findTriggerRunsByProviderEventReceiptId(fixture.providerEventReceiptId)
    )[0]!;
    const steps = await fixture.database.listWorkflowStepRunsForTriggerRun(run.id);
    const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(steps[0]!.id);
    assert.equal(execution?.launchIntent?.prompt, 'Context: {"ambient":"once"}\nTrigger: run');
  });
});

interface Fixture {
  database: Database;
  entitlements: EntitlementsService;
  providerEventReceiptId: string;
  deliveryId: string;
  projectId: string;
  revisionId: string;
  configuration: CompiledHubConfig;
  trigger(message: string): DurableProviderEvent;
}

async function workflowFixture(
  options: {
    unavailableValue?: boolean;
    terminalRecovery?: boolean;
    rawConfiguration?: Record<string, unknown>;
    compiledConfiguration?: CompiledHubConfig;
    resolvedPromptPartials?: ResolvedPromptPartials;
    namedAgents?: Record<string, CompiledAgent>;
  } = {},
): Promise<Fixture> {
  const database = createMemoryDatabase({ organizationIds: ["org-1"] });
  // A real EntitlementsService over the SAME database the engine uses — not an auto-unlimited
  // proxy over a separate store. Metering the engine performs is therefore observable here, and
  // a per-execution regression actually fails these tests. Stamped unlimited by default; tests
  // that exercise the meter override it down.
  const entitlements = new EntitlementsService(database, { seats: async () => 0 });
  await entitlements.stamp("org-1", UNLIMITED_TEMPLATE, { source: "provisioning", planId: null });
  const project = await database.createProject({
    organizationId: "org-1",
    name: "Workflow",
    slug: randomUUID(),
    createdByUserId: "user-1",
  });
  const raw =
    options.rawConfiguration ??
    (options.terminalRecovery ? terminalRecoveryConfiguration() : baseConfiguration(options));
  const compiled =
    options.compiledConfiguration ??
    compileHubConfig(raw, {
      ...(options.resolvedPromptPartials === undefined
        ? {}
        : { resolvedPromptPartials: options.resolvedPromptPartials }),
      ...(options.namedAgents === undefined ? {} : { namedAgents: options.namedAgents }),
    });
  const configuration: CompiledHubConfig = {
    environments: compiled.environments.map((environment) => {
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
    triggers: compiled.triggers,
  };
  const revision = await database.insertProjectConfigurationRevision({
    projectId: project.id,
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    createdByUserId: "user-1",
  });
  await database.activateProjectConfigurationRevision(project.id, revision.id, []);
  const receipt = await database.persistManualEvent({
    organizationId: "org-1",
    projectId: project.id,
    deliveryId: randomUUID(),
    source: "manual.run",
    payload: {},
    receivedAt: new Date(),
  });
  if (receipt.status !== "accepted") throw new Error("workflow receipt was not accepted");
  return {
    database,
    entitlements,
    providerEventReceiptId: receipt.event.providerEventReceiptId,
    deliveryId: receipt.event.deliveryId,
    projectId: project.id,
    revisionId: revision.id,
    configuration,
    trigger(message) {
      return {
        providerEventReceiptId: receipt.event.providerEventReceiptId,
        organizationId: "org-1",
        projectId: project.id,
        configurationRevisionId: revision.id,
        source: "manual.run",
        deliveryId: receipt.event.deliveryId,
        payload: { input: message },
        receivedAt: new Date(),
        connectionId: null,
        resourceId: null,
      };
    },
  };
}

function setAcceptedRoutes(database: Database, receipt: ProviderEventReceiptRecord): void {
  const receipts: unknown = Reflect.get(database, "providerEventReceipts");
  if (!(receipts instanceof Map)) throw new Error("memory receipt store unavailable");
  receipts.set(receipt.id, receipt);
}

function partialRuntimeConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "partial-request",
        on: "manual.run",
        max_runtime: "1h",
        inputs: { repo: { type: "string", choices: ["hub"] } },
        steps: [
          {
            id: "work-hub",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [
              { include: "partials/instructions.md" },
              { text: "Inline ${{ paseo.prompt }} / ${{ paseo.inputs.repo }}" },
            ],
          },
        ],
      },
    ],
  };
}

function engineFor(
  fixture: Fixture,
  dispatches: string[],
  beforeDispatch?: (intent: LaunchMachineIntent) => Promise<void>,
  now?: () => Date,
  onWorkflowRunTerminal?: (run: TriggerRunRecord) => Promise<void>,
) {
  return createDurableWorkflowHandler({
    database: fixture.database,
    entitlements: fixture.entitlements,
    providers: [providerMatch(fixture.configuration, fixture.revisionId)],
    ...(now === undefined ? {} : { now }),
    ...(onWorkflowRunTerminal === undefined ? {} : { onWorkflowRunTerminal }),
    dispatchLaunchMachineIntent: async (intent) => {
      await beforeDispatch?.(intent);
      dispatches.push(dispatchLabel(intent));
      const execution = await fixture.database.findAgentExecutionByWorkflowStepRunId(
        intent.workflowStepRunId!,
      );
      if (execution === undefined) throw new Error("workflow execution was not persisted");
      return {
        execution,
      };
    },
  });
}

function deadlineConfiguration(options: { idleTimeout?: string } = {}): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "deadline-route",
        on: "manual.run",
        max_runtime: "2m",
        steps: [
          {
            id: "first",
            environment: "runner",
            max_runtime: "1m",
            idle_timeout: options.idleTimeout ?? "20s",
            agent: { provider: "codex" },
            prompt: [{ text: "run" }],
          },
          {
            id: "second",
            environment: "runner",
            max_runtime: "1m",
            idle_timeout: options.idleTimeout ?? "20s",
            agent: { provider: "codex" },
            prompt: [{ text: "run" }],
          },
        ],
      },
    ],
  };
}

function contextOptInConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "context-opt-in",
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "without-context",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Trigger: ${{ paseo.prompt }}" }],
          },
          {
            id: "with-context",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Context: ${{ paseo.context }}\nTrigger: ${{ paseo.prompt }}" }],
          },
        ],
      },
    ],
  };
}

function contextOnlyConfiguration(): Record<string, unknown> {
  const configuration = contextOptInConfiguration();
  const triggers = readUnknownArray(configuration["triggers"]);
  const trigger = triggers?.[0];
  const steps = isRecord(trigger) ? readUnknownArray(trigger["steps"]) : undefined;
  if (trigger === undefined || steps?.[1] === undefined) {
    throw new Error("context opt-in fixture is incomplete");
  }
  return {
    ...configuration,
    triggers: [{ ...trigger, steps: [steps[1]] }],
  };
}

function allSkippedConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "all-skipped",
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "never",
            if: "${{ false }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Never runs" }],
          },
        ],
      },
    ],
  };
}

function skippedOutputPromptConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "skipped-output-prompt",
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "classify",
            if: "${{ false }}",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "Classify" }],
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["repo"],
                properties: { repo: { enum: ["hub"] } },
              },
            },
          },
          {
            id: "work",
            if: "${{ true }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Repo ${{ steps.classify.outputs.repo }}" }],
          },
        ],
      },
    ],
  };
}

function namedSelectionConfiguration(): Record<string, unknown> {
  return {
    environments: [
      { name: "paseo", kind: "daemon", daemon: "runner", cwd: "/workspace/paseo" },
      { name: "hub", kind: "daemon", daemon: "runner", cwd: "/workspace/hub" },
    ],
    triggers: [
      {
        name: "named-selection",
        on: "manual.run",
        max_runtime: "1h",
        values: {
          environment: "${{ steps.classifier.outputs.environment }}",
          agent: "${{ steps.classifier.outputs.agent }}",
        },
        steps: [
          {
            id: "classifier",
            environment: "paseo",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "Classify" }],
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["environment", "agent"],
                properties: {
                  environment: { enum: ["paseo", "hub"] },
                  agent: { enum: ["codex", "claude"] },
                },
              },
            },
          },
          {
            id: "worker",
            environment: "${{ values.environment }}",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: "${{ values.agent }}",
            prompt: [{ text: "Work" }],
          },
        ],
      },
    ],
  };
}

function skippedAuthorityConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "skipped-authority",
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "classifier",
            if: "${{ false }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Classify" }],
            github: {
              connection: "getpaseo-github",
              repositories: ["getpaseo/paseo"],
              permissions: { contents: "write" },
            },
          },
          {
            id: "work",
            if: "${{ true }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Work" }],
            env: { SOME_TOKEN: "${{ paseo.connections.some-connection.token }}" },
          },
        ],
      },
    ],
  };
}

function finalValueConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "final-value",
        on: "manual.run",
        max_runtime: "1h",
        values: {
          final_decision: "${{ steps.decide.outputs.decision }}",
        },
        steps: [
          {
            id: "decide",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "Decide" }],
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["decision"],
                properties: { decision: { enum: ["ship"] } },
              },
            },
          },
        ],
      },
    ],
  };
}

function providerMatch(configuration: CompiledHubConfig, revisionId: string) {
  return {
    name: "manual",
    eventNames: ["manual.run"] as const,
    async match(external): Promise<readonly AcceptedTriggerProviderMatch[]> {
      const trigger = configuration.triggers[0]!;
      const input =
        isRecord(external.payload) && typeof external.payload["input"] === "string"
          ? external.payload["input"]
          : "";
      const invocation = parseInvocation(input, trigger.inputs);
      if (invocation.status !== "accepted")
        throw new Error("test invocation unexpectedly rejected");
      return [
        {
          triggerName: trigger.name,
          triggerContext: { provider: "manual" },
          outputContext: { provider: "manual" },
          configurationRevisionId: revisionId,
          hubConfig: configuration,
          invocation,
        },
      ];
    },
  } satisfies import("../triggers/index.js").TriggerProvider;
}

function baseConfiguration(options: { unavailableValue?: boolean }): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "route-request",
        on: "manual.run",
        max_runtime: "1h",
        inputs: { repo: { type: "string", choices: ["paseo", "hub"] } },
        values: {
          repo:
            options.unavailableValue === true
              ? "${{ steps.classify.outputs.repo }}"
              : "${{ paseo.inputs.repo ?? steps.classify.outputs.repo }}",
        },
        steps: [
          {
            id: "classify",
            if: "${{ paseo.inputs.repo == null }}",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "Classify" }],
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["repo"],
                properties: { repo: { enum: ["paseo", "hub"] } },
              },
            },
          },
          {
            id: "work-hub",
            if: "${{ values.repo == 'hub' }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Work hub" }],
          },
          {
            id: "work-paseo",
            if: "${{ values.repo == 'paseo' }}",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Work paseo" }],
          },
        ],
      },
    ],
  };
}

function terminalRecoveryConfiguration(): Record<string, unknown> {
  return {
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "terminal-recovery",
        on: "manual.run",
        max_runtime: "1h",
        inputs: { repo: { type: "string", choices: ["hub"] } },
        steps: [
          {
            id: "first",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "First" }],
          },
          {
            id: "downstream",
            if: "${{ paseo.inputs.repo == 'hub' }}",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "codex" },
            prompt: [{ text: "Downstream" }],
          },
        ],
      },
    ],
  };
}

function executionWorktreeConfiguration(): Record<string, unknown> {
  const step = (id: string) => ({
    id,
    environment: "runner",
    max_runtime: "10m",
    idle_timeout: "1m",
    agent: { provider: "codex" },
    prompt: [{ text: "Do the work." }],
  });
  return {
    environments: [
      {
        name: "runner",
        kind: "daemon",
        daemon: "runner",
        cwd: "/workspace",
        worktree: { mode: "branch-off", newBranch: "trigger-${{ paseo.execution.id }}" },
      },
    ],
    triggers: ["first", "second"].map((name) => ({
      name,
      on: "manual.run",
      max_runtime: "1h",
      steps: [step(`work-${name}`)],
    })),
  };
}

function dispatchLabel(intent: {
  workflowStepRunId?: string;
  triggerName: string;
  prompt: string;
}): string {
  if (intent.workflowStepRunId === undefined) return "missing";
  if (intent.prompt === "First") return "first";
  if (intent.prompt === "Downstream") return "downstream";
  if (intent.triggerName !== "route-request") return "unknown";
  if (intent.prompt.startsWith("Classify")) return "classify";
  return intent.prompt.includes("paseo") ? "work-paseo" : "work-hub";
}

async function settlesQuickly<T>(promise: Promise<T>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
  ]);
}

async function waitUntil(observation: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await observation()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for workflow state");
}

function delayFirstEmptyTerminalClaim(
  database: Database,
  markStarted: () => void,
  release: Promise<void>,
): Database {
  let firstClaim = true;
  return new Proxy(database, {
    get(target, property) {
      if (property === "claimPendingWorkflowRunTerminalNotification") {
        return async (now: Date, leaseMs: number) => {
          if (firstClaim) {
            firstClaim = false;
            markStarted();
            await release;
            return undefined;
          }
          return target.claimPendingWorkflowRunTerminalNotification(now, leaseMs);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return value;
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUnknownArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
