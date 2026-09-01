import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import type {
  DaemonExecutionControlOptions,
  DaemonEventHandler,
  DaemonEvent,
  DaemonConnection,
} from "./protocol.js";
import {
  createDaemonDispatchLifecycle,
  DaemonDispatchFailure,
  type DaemonDispatchLifecycle,
} from "./lifecycle.js";
import { createDurableWorkflowHandler } from "../workflows/engine.js";
import type { TriggerProvider } from "../triggers/index.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";
import type { DaemonRecord } from "../db/types.js";
import { createLogger, serializeError } from "../logger.js";
import { assertOneFailure, FailureLogStream } from "../test-utils/failure-logs.js";

const DAEMON_ID = "daemon-ack-test";
const AGENT_ID = "agent-ack-test";
const EXECUTION_ID = "00000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED_AT = new Date("2026-01-01T00:00:01.000Z");

describe("durable Hub action acknowledgement state", () => {
  it("keeps the classified dispatch code in redacted error logs", () => {
    const diagnostic = serializeError(
      new DaemonDispatchFailure("github_authority_unavailable", {
        cause: Object.assign(new Error("credential detail must not be logged"), {
          code: "github_authority_unavailable",
        }),
      }),
    );

    assert.equal(diagnostic["code"], "github_authority_unavailable");
    const cause = diagnostic["cause"];
    assert.ok(typeof cause === "object" && cause !== null);
    assert.equal(Reflect.get(cause, "code"), "github_authority_unavailable");
    assert.equal(JSON.stringify(diagnostic).includes("credential detail"), false);
  });

  it("logs a daemon execution recovery failure exactly once", async () => {
    const canary = "daemon-lifecycle-secret-4c09";
    const database = createMemoryDatabase();
    const daemon = daemonRecord();
    const executionId = "00000000-0000-4000-8000-0000000000f1";
    await database.insertAgentExecution({
      id: executionId,
      organizationId: "organization-lifecycle-log",
      projectId: "project-lifecycle-log",
      machineId: null,
      daemonId: daemon.id,
      triggerContext: {},
      outputContext: {},
      configurationRevisionId: "revision-lifecycle-log",
    });
    vi.spyOn(database, "findAgentExecutionById").mockRejectedValueOnce(new Error(canary));
    const stream = new FailureLogStream();
    const lifecycle = createDaemonDispatchLifecycle({
      database,
      connectionForDaemon: () => new AcknowledgementConnection(),
      publicBaseUrl: "http://hub.test",
      test: { logger: createLogger(stream) },
    });

    await lifecycle.recoverDaemon(daemon);

    assertOneFailure(stream, {
      operation: "daemon.execution.recover",
      component: "daemons",
      canary,
    });
    await lifecycle.stop();
  });

  it("owns a rejected daemon event without leaking it to the process", async () => {
    const fixture = await acknowledgementFixture();
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);
    vi.spyOn(fixture.database, "recordAgentExecutionHubAcknowledgement").mockRejectedValueOnce(
      new Error("database event write failed"),
    );

    try {
      await fixture.connection.emitObserved(turnCompleted());
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      await fixture.lifecycle.stop();
    }
  });

  it("defers workflow-owned terminal provider failure notification to the outbox", async () => {
    const database = createMemoryDatabase();
    let failureHooks = 0;
    const provider: TriggerProvider = {
      name: "test",
      eventNames: ["manual.test"],
      match: () => Promise.resolve([]),
      onAgentExecutionFailed: async () => {
        failureHooks += 1;
      },
    };
    const lifecycle = createDaemonDispatchLifecycle({
      database,
      connectionForDaemon: () => undefined,
      providers: [provider],
    });
    const run = (
      await database.createAcceptedTriggerRun({
        organizationId: "org-workflow-terminal",
        projectId: "project-workflow-terminal",
        configurationRevisionId: "revision-workflow-terminal",
        providerEventReceiptId: "receipt-workflow-terminal",
        configuredTriggerName: "terminal",
        prompt: "raw",
        inputs: {},
        triggerContext: { provider: "test" },
        outputContext: { provider: "test" },
        deadlineAt: new Date("2099-01-01T00:00:00.000Z"),
        stepIds: ["step"],
      })
    ).run;
    const step = (await database.listWorkflowStepRunsForTriggerRun(run.id))[0]!;
    const execution = await database.insertAgentExecution({
      id: "00000000-0000-4000-8000-0000000000dd",
      organizationId: run.organizationId,
      projectId: run.projectId,
      machineId: null,
      daemonId: DAEMON_ID,
      triggerContext: run.triggerContext,
      outputContext: run.outputContext,
      configurationRevisionId: run.configurationRevisionId,
      workflowStepRunId: step.id,
      deadlineAt: new Date("2000-01-01T00:00:00.000Z"),
      idleDeadlineAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    await database.linkWorkflowStepRunExecution(step.id, execution.id);

    await lifecycle.recoverAgentExecutionDeadlines();

    assert.equal(failureHooks, 0);
    const pendingDelivery = await database.findTriggerRunById(run.id);
    assert.equal(pendingDelivery?.status, "failed");
    assert.equal(pendingDelivery?.outcome, "accepted");
    assert.equal(
      pendingDelivery?.outcome === "accepted"
        ? pendingDelivery.terminalNotificationDeliveredAt
        : null,
      null,
    );

    const engine = createDurableWorkflowHandler({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [],
      onWorkflowRunTerminal: (terminalRun) => lifecycle.notifyWorkflowRunTerminal(terminalRun),
    }).engine;
    await engine.processAvailable();

    const delivered = await database.findTriggerRunById(run.id);
    assert.equal(failureHooks, 1);
    assert.equal(
      delivered?.outcome === "accepted"
        ? delivered.terminalNotificationDeliveredAt !== null
        : false,
      true,
    );
    await lifecycle.stop();
  });

  it("ignores unrelated failed or canceled tools when finish_execution completes", async () => {
    const fixture = await acknowledgementFixture();
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);

    await fixture.connection.emit(toolCall("shell-call", "shell", "failed"));
    await fixture.connection.emit(toolCall("other-call", "other", "canceled"));
    await fixture.connection.emit(
      toolCall("finish-call", "mcp__hub__finish_execution", "completed"),
    );
    await fixture.connection.emit(
      toolCall("finish-call-retry", "hub.finish_execution", "canceled"),
    );
    await fixture.connection.emit(turnCompleted());
    await fixture.connection.emit(agentIdle());

    const execution = await fixture.database.findAgentExecutionById(EXECUTION_ID);
    assert.equal(execution?.hubActionAcknowledgements.finishExecutionCall?.callId, "finish-call");
    assert.equal(execution?.hubActionAcknowledgements.finishExecutionCall?.status, "completed");
    assert.deepEqual(fixture.connection.actions, ["archive"]);
    assert.notEqual(execution?.hubActionReadyAt, null);
    assert.notEqual(execution?.hubActionCompletedAt, null);
    await fixture.lifecycle.stop();
  });

  it.each(["running", "canceled"] as const)(
    "does not archive while finish_execution is %s",
    async (status) => {
      const fixture = await acknowledgementFixture();
      await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);

      await fixture.connection.emit(toolCall("finish-call", "hub.finish_execution", status));
      await fixture.connection.emit(turnCompleted());
      await fixture.connection.emit(agentIdle());

      const execution = await fixture.database.findAgentExecutionById(EXECUTION_ID);
      assert.deepEqual(fixture.connection.actions, []);
      assert.equal(execution?.hubActionReadyAt, null);
      assert.equal(execution?.hubActionCompletedAt, null);
      await fixture.lifecycle.stop();
    },
  );

  it("resumes durable partial signals across restart and archives exactly once", async () => {
    const fixture = await acknowledgementFixture();
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);
    await fixture.connection.emit(toolCall("finish-call", "hub.finish_execution", "completed"));
    await fixture.lifecycle.stop();

    fixture.lifecycle = createLifecycle(fixture.database, fixture.connection);
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);
    assert.equal(
      (await fixture.database.findAgentExecutionById(EXECUTION_ID))?.hubActionReadyAt,
      null,
    );
    await fixture.connection.emit(turnCompleted());
    await fixture.lifecycle.stop();

    fixture.lifecycle = createLifecycle(fixture.database, fixture.connection);
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);
    assert.notEqual(
      (await fixture.database.findAgentExecutionById(EXECUTION_ID))?.hubActionAcknowledgements
        .terminalAt,
      null,
    );
    await fixture.connection.emit(agentIdle());

    fixture.lifecycle = createLifecycle(fixture.database, fixture.connection);
    await fixture.lifecycle.recoverPendingHubActions(DAEMON_ID);
    const execution = await fixture.database.findAgentExecutionById(EXECUTION_ID);
    assert.deepEqual(fixture.connection.actions, ["archive"]);
    assert.notEqual(execution?.hubActionReadyAt, null);
    assert.notEqual(execution?.hubActionCompletedAt, null);
    await fixture.lifecycle.stop();
  });
});

async function acknowledgementFixture() {
  const database = createMemoryDatabase({ now: () => new Date("2026-01-01T00:00:00.000Z") });
  await database.insertAgentExecution({
    id: EXECUTION_ID,
    organizationId: "org-ack-test",
    projectId: "project-ack-test",
    machineId: null,
    daemonId: DAEMON_ID,
    triggerContext: {},
    outputContext: {},
    configurationRevisionId: "revision-ack-test",
  });
  await database.attachAgentToExecution(EXECUTION_ID, DAEMON_ID, AGENT_ID);
  await database.transitionAgentExecution(EXECUTION_ID, "succeeded", {
    completedByAgent: true,
    hubAction: "archive",
  });
  const connection = new AcknowledgementConnection();
  return {
    database,
    connection,
    lifecycle: createLifecycle(database, connection),
  };
}

function createLifecycle(
  database: Awaited<ReturnType<typeof createMemoryDatabase>>,
  connection: AcknowledgementConnection,
): DaemonDispatchLifecycle {
  return createDaemonDispatchLifecycle({
    database,
    connectionForDaemon: (daemonId) => (daemonId === DAEMON_ID ? connection : undefined),
  });
}

class AcknowledgementConnection implements DaemonConnection {
  readonly actions: DaemonExecutionControlOptions["action"][] = [];
  private readonly handlers = new Set<DaemonEventHandler>();

  on(handler: DaemonEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async emit(event: DaemonEvent): Promise<void> {
    for (const handler of this.handlers) await handler(event);
  }

  async emitObserved(event: DaemonEvent): Promise<void> {
    for (const handler of this.handlers) {
      await Promise.resolve(handler(event)).catch(() => undefined);
    }
  }

  async createAgent(): Promise<never> {
    throw new Error("not used");
  }

  async controlExecution(options: DaemonExecutionControlOptions): Promise<void> {
    this.actions.push(options.action);
  }
}

function toolCall(
  callId: string,
  name: string,
  status: "running" | "completed" | "failed" | "canceled",
): DaemonEvent {
  return {
    type: "agent_stream",
    executionId: EXECUTION_ID,
    agentId: AGENT_ID,
    timestamp: ACKNOWLEDGED_AT.toISOString(),
    event: {
      type: "timeline",
      provider: "test",
      item: { type: "tool_call", callId, name, status },
    },
  } as DaemonEvent;
}

function daemonRecord(): DaemonRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: DAEMON_ID,
    slug: "daemon-lifecycle",
    machineId: "machine-lifecycle",
    serverId: "server-lifecycle",
    daemonPublicKey: "public-key",
    credentialVerifier: "verifier",
    permissions: ["hub.execute"],
    registeredByApiKeyId: null,
    registeredByCliCredentialId: null,
    status: "active",
    presence: "connected",
    connectedAt: now,
    disconnectedAt: null,
    lastSeenAt: now,
    createdAt: now,
  };
}

function turnCompleted(): DaemonEvent {
  return {
    type: "agent_stream",
    executionId: EXECUTION_ID,
    agentId: AGENT_ID,
    timestamp: ACKNOWLEDGED_AT.toISOString(),
    event: { type: "turn_completed", provider: "test" },
  };
}

function agentIdle(): DaemonEvent {
  return {
    type: "agent_update",
    executionId: EXECUTION_ID,
    agentId: AGENT_ID,
    timestamp: ACKNOWLEDGED_AT.toISOString(),
    agent: { id: AGENT_ID, status: "idle" },
  };
}
