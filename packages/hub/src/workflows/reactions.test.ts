import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { deriveAgentExecutionCompletionToken } from "../agent-executions/completion-token.js";
import { ProjectConfigurationStore } from "../configuration/store.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database } from "../db/types.js";
import {
  createDaemonDispatchLifecycle,
  type DaemonDispatchLifecycle,
} from "../daemons/lifecycle.js";
import type { DaemonConnection } from "../daemons/protocol.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";
import {
  createActiveProjectConfiguration,
  TEST_DAEMON_ID,
  TEST_DAEMON_SLUG,
} from "../test-utils/project-configuration.js";
import type { DiscordBotClient } from "../triggers/discord/bot.js";
import { createDiscordTriggerProvider } from "../triggers/discord/provider.js";
import type { GitHubReactionClient } from "../triggers/github/provider.js";
import { createGitHubTriggerProvider } from "../triggers/github/provider.js";
import type { SlackBotClient } from "../triggers/slack/client.js";
import { createSlackTriggerProvider } from "../triggers/slack/provider.js";
import type { TriggerProvider } from "../triggers/index.js";
import { createDurableWorkflowHandler } from "./engine.js";

describe("workflow-owned provider reactions", () => {
  it("uses one reaction sequence for a two-step Discord workflow", async () => {
    const result = await runTwoStepWorkflow(createDiscordReactionFixture());

    assert.deepEqual(result.visible(), ["✅"]);
    assert.deepEqual(result.calls(), {
      created: ["👀", "⏳", "✅"],
      deleted: ["👀", "⏳"],
    });
    assert.equal(result.run.status, "succeeded");
  });

  it("uses one reaction sequence for a two-step Slack workflow", async () => {
    const result = await runTwoStepWorkflow(createSlackReactionFixture());

    assert.deepEqual(result.visible(), ["white_check_mark"]);
    assert.deepEqual(result.calls(), [
      "remove:eyes",
      "add:hourglass_flowing_sand",
      "remove:hourglass_flowing_sand",
      "add:white_check_mark",
    ]);
    assert.equal(result.run.status, "succeeded");
  });

  it("removes the accepted reaction when every workflow step is skipped", async () => {
    const result = await runTwoStepWorkflow(createDiscordReactionFixture(), {
      skipAllSteps: true,
    });

    assert.deepEqual(result.visible(), ["✅"]);
    assert.deepEqual(result.calls(), {
      created: ["👀", "✅"],
      deleted: ["👀"],
    });
  });

  it("keeps GitHub reaction state out of immutable trigger context", async () => {
    const fixture = createGitHubReactionFixture();
    const original = structuredClone(fixture.triggerContext);
    const result = await runTwoStepWorkflow(fixture);

    assert.deepEqual(fixture.triggerContext, original);
    assert.deepEqual(result.visible(), ["+1"]);
    assert.deepEqual(result.calls(), {
      created: ["eyes", "+1"],
      deleted: [1],
    });
  });

  it("uses one reaction sequence for a two-step GitHub workflow", async () => {
    const result = await runTwoStepWorkflow(createGitHubReactionFixture());

    assert.deepEqual(result.visible(), ["+1"]);
    assert.deepEqual(result.calls(), {
      created: ["eyes", "+1"],
      deleted: [1],
    });
    assert.deepEqual(result.run.reactionState, { reactionId: 2 });
    assert.equal(result.run.status, "succeeded");
  });

  it.each(["step_failure", "timeout", "prelaunch_failure"] as const)(
    "converges %s to one terminal workflow reaction",
    async (outcome) => {
      const fixture = createDiscordReactionFixture();
      const result = await runTwoStepWorkflow(fixture, { outcome });

      assert.deepEqual(result.visible(), ["❌"]);
      const calls = result.calls();
      assert.equal(calls.created.filter((emoji) => emoji === "❌").length, 1);
      assert.equal(calls.created.filter((emoji) => emoji === "👀").length, 1);
      assert.equal(calls.created.filter((emoji) => emoji === "⏳").length, 1);
    },
  );

  it.each(["step_failure", "timeout", "prelaunch_failure"] as const)(
    "converges Slack %s without a stale workflow reaction",
    async (outcome) => {
      const result = await runTwoStepWorkflow(createSlackReactionFixture(), { outcome });

      assert.deepEqual(result.visible(), ["x"]);
      assert.deepEqual(result.calls(), [
        "remove:eyes",
        "add:hourglass_flowing_sand",
        "remove:hourglass_flowing_sand",
        "add:x",
      ]);
    },
  );

  it.each(["step_failure", "timeout", "prelaunch_failure"] as const)(
    "converges GitHub %s without a stale workflow reaction",
    async (outcome) => {
      const result = await runTwoStepWorkflow(createGitHubReactionFixture(), { outcome });

      assert.deepEqual(result.visible(), ["-1"]);
      assert.deepEqual(result.calls(), {
        created: ["eyes", "-1"],
        deleted: [1],
      });
      assert.deepEqual(result.run.reactionState, { reactionId: 2 });
    },
  );
});

function createDiscordReactionFixture() {
  const bot = new RecordingDiscordBot();
  const provider = createDiscordTriggerProvider({
    configurationStoreForProject: () =>
      new ProjectConfigurationStore(createMemoryDatabase(), "unused"),
    bot,
  });
  return {
    provider,
    triggerContext: {
      provider: "discord",
      target: {
        provider: "discord",
        guildId: "guild-1",
        channelId: "channel-1",
        threadId: null,
        messageId: "message-1",
      },
      event: {},
    },
    outputContext: {
      provider: "discord",
      guildId: "guild-1",
      channelId: "channel-1",
      threadId: null,
      messageId: "message-1",
    },
    visible: () => visibleDiscordReactions(bot),
    calls: () => ({
      created: bot.reactions.map((reaction) => reaction.emoji),
      deleted: bot.deletedOwnReactions.map((reaction) => reaction.emoji),
    }),
  };
}

function createSlackReactionFixture() {
  const client = new RecordingSlackClient();
  const provider = createSlackTriggerProvider({
    configurationStoreForProject: () =>
      new ProjectConfigurationStore(createMemoryDatabase(), "unused"),
    botUserIdForWorkspace: async () => "bot-1",
    client,
  });
  return {
    provider,
    triggerContext: {
      provider: "slack",
      target: {
        provider: "slack",
        organizationId: "org-reactions",
        teamId: "team-1",
        channelId: "channel-1",
        threadTs: "1700000000.000001",
        messageTs: "1700000000.000001",
      },
      event: {},
    },
    outputContext: {
      provider: "slack",
      organizationId: "org-reactions",
      teamId: "team-1",
      channelId: "channel-1",
      threadTs: "1700000000.000001",
      messageTs: "1700000000.000001",
    },
    visible: () => visibleSlackReactions(client),
    calls: () => client.reactions,
  };
}

function createGitHubReactionFixture() {
  const reactions = new RecordingGitHubReactions();
  const provider = createGitHubTriggerProvider({
    configurationStoreForProject: () =>
      new ProjectConfigurationStore(createMemoryDatabase(), "unused"),
    reactions,
  });
  return {
    provider,
    triggerContext: {
      provider: "github",
      target: { installationId: 42, repository: "owner/repository" },
      event: {},
      reactionSubject: { kind: "issue_comment" as const, commentId: 123 },
    },
    outputContext: undefined,
    visible: () => visibleGitHubReactions(reactions),
    calls: () => ({
      created: reactions.created.map((reaction) => reaction.content),
      deleted: reactions.deleted,
    }),
  };
}

type WorkflowOutcome = "step_failure" | "timeout" | "prelaunch_failure";

interface WorkflowScenarioOptions {
  outcome?: WorkflowOutcome;
  skipAllSteps?: boolean;
}

async function runTwoStepWorkflow<
  Name extends string,
  TriggerContext,
  OutputContext,
  MaterializedContext,
  Calls,
>(
  input: {
    provider: TriggerProvider<Name, TriggerContext, OutputContext, MaterializedContext>;
    triggerContext: unknown;
    outputContext: unknown;
    visible: () => readonly string[];
    calls: () => Calls;
  },
  options: WorkflowScenarioOptions = {},
) {
  let now = new Date();
  const organizationId = `org-reactions-${randomUUID()}`;
  const database = createMemoryDatabase({ organizationIds: [organizationId], now: () => now });
  const tokenVerifier = `verifier-${randomUUID()}`;
  await database.issueEnrollmentToken({
    id: randomUUID(),
    verifier: tokenVerifier,
    organizationId,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    consumedAt: null,
  });
  await database.enrollDaemon({
    tokenVerifier,
    daemonId: TEST_DAEMON_ID,
    idempotencyKey: `runner-${organizationId}`,
    serverId: "server-1",
    daemonPublicKey: "public-key",
    credentialVerifier: "credential-verifier",
    permissions: ["hub.execute"],
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  const { project, revision } = await createActiveProjectConfiguration(
    database,
    {
      environments: [
        {
          name: "runner",
          kind: "daemon",
          daemon: TEST_DAEMON_SLUG,
          cwd: "/workspace",
        },
      ],
      triggers: [
        {
          name: "multi",
          on: "manual.run",
          max_runtime: "1h",
          steps: [
            {
              id: "first",
              environment: "runner",
              max_runtime: "10m",
              idle_timeout: "1m",
              agent: { provider: "codex" },
              prompt: [{ text: "first" }],
              ...(options.skipAllSteps === true ? { if: "${{ false }}" } : {}),
            },
            {
              id: "second",
              environment: "runner",
              max_runtime: "10m",
              idle_timeout: "1m",
              agent: { provider: "codex" },
              prompt: [{ text: "second" }],
              ...(options.skipAllSteps === true ? { if: "${{ false }}" } : {}),
            },
          ],
        },
      ],
    },
    { organizationId },
  );
  const { run } = await database.createAcceptedTriggerRun({
    organizationId,
    projectId: project.id,
    configurationRevisionId: revision.id,
    providerEventReceiptId: randomUUID(),
    configuredTriggerName: "multi",
    prompt: "run",
    inputs: {},
    triggerContext: input.triggerContext,
    outputContext: input.outputContext,
    deadlineAt:
      options.outcome === "timeout"
        ? new Date(now.getTime() + 1_000)
        : new Date("2099-01-01T00:00:00.000Z"),
    stepIds: ["first", "second"],
    createdAt: now,
  });
  const connection: DaemonConnection = {
    on: () => () => undefined,
    createAgent: async (agentOptions) => {
      if (options.outcome === "prelaunch_failure") {
        throw new Error("daemon rejected agent");
      }
      return { id: agentOptions.executionId };
    },
    controlExecution: async () => undefined,
  };
  const lifecycle = createDaemonDispatchLifecycle({
    database,
    connectionForDaemon: (daemonId) => (daemonId === TEST_DAEMON_ID ? connection : undefined),
    providers: [input.provider],
    publicBaseUrl: "https://hub.test",
    completionTokenSecret: "reaction-secret",
  });
  const createEngine = () =>
    createDurableWorkflowHandler({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [input.provider],
      now: () => now,
      leaseMs: 1_000,
      dispatchLaunchMachineIntent: (intent) => lifecycle.handoffLaunchMachineIntent(intent),
      onWorkflowRunAccepted: (accepted) => lifecycle.notifyWorkflowRunAccepted(accepted),
      onWorkflowRunStarted: (started) => lifecycle.notifyWorkflowRunStarted(started),
      onWorkflowRunTerminal: (terminal) => lifecycle.notifyWorkflowRunTerminal(terminal),
    }).engine;
  const engine = createEngine();

  try {
    const acceptedState = await lifecycle.notifyWorkflowRunAccepted(run);
    await database.setWorkflowRunReactionState(run.id, acceptedState);
    await engine.processAvailable();
    if (options.skipAllSteps === true) {
      await waitForTerminalRun(database, run.id);
    } else if (options.outcome === "step_failure") {
      const first = await runningStepExecution(database, run.id, "first");
      assert.ok(first.machineId);
      await lifecycle.failPendingExecutionsForDisconnectedMachine(
        first.machineId,
        "daemon_disconnected",
      );
    } else if (options.outcome === "timeout") {
      now = new Date(now.getTime() + 2_000);
      await database.recoverWorkflowDeadlines(now);
    } else if (options.outcome === "prelaunch_failure") {
      await waitForTerminalRun(database, run.id);
    } else {
      await completeStep(database, lifecycle, run.id, "first");
      now = new Date();
      await database.recoverWorkflowWakeups(new Date());
      await engine.processAvailable();
      await completeStep(database, lifecycle, run.id, "second");
      now = new Date();
      await engine.processAvailable();
    }
    await waitForTerminalRun(database, run.id);
    now = new Date();
    await engine.processAvailable();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await engine.stop();
    await lifecycle.stop();
    const terminalRun = await database.findTriggerRunById(run.id);
    if (terminalRun?.outcome !== "accepted") throw new Error("accepted workflow run not found");
    return {
      run: terminalRun,
      visible: input.visible,
      calls: input.calls,
    };
  } catch (error) {
    await engine.stop();
    await lifecycle.stop();
    throw error;
  }
}

async function runningStepExecution(database: Database, triggerRunId: string, stepId: string) {
  const steps = await database.listWorkflowStepRunsForTriggerRun(triggerRunId);
  const step = steps.find((candidate) => candidate.stepId === stepId);
  assert.ok(step);
  return waitFor(async () => {
    const execution = await database.findAgentExecutionByWorkflowStepRunId(step.id);
    return execution?.status === "running" ? execution : undefined;
  });
}

async function waitForTerminalRun(database: Database, triggerRunId: string) {
  return waitFor(async () => {
    const run = await database.findTriggerRunById(triggerRunId);
    return run?.status !== "running" ? run : undefined;
  });
}

async function completeStep(
  database: Database,
  lifecycle: DaemonDispatchLifecycle,
  triggerRunId: string,
  stepId: string,
): Promise<void> {
  const steps = await database.listWorkflowStepRunsForTriggerRun(triggerRunId);
  const step = steps.find((candidate) => candidate.stepId === stepId);
  assert.ok(step);
  const execution = await waitFor(async () => {
    const candidate = await database.findAgentExecutionByWorkflowStepRunId(step.id);
    return candidate?.status === "running" ? candidate : undefined;
  });
  await lifecycle.completeAgentExecutionFromCallback({
    executionId: execution.id,
    token: deriveAgentExecutionCompletionToken("reaction-secret", execution.id),
  });
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out waiting for workflow execution");
}

function visibleDiscordReactions(client: RecordingDiscordBot): readonly string[] {
  const visible = new Set<string>();
  for (const reaction of client.reactions) visible.add(reaction.emoji);
  for (const reaction of client.deletedOwnReactions) visible.delete(reaction.emoji);
  return [...visible];
}

function visibleSlackReactions(client: RecordingSlackClient): readonly string[] {
  const visible = new Set<string>();
  for (const reaction of client.reactions) {
    const [operation, name] = reaction.split(":");
    if (operation === "add") visible.add(name!);
    if (operation === "remove") visible.delete(name!);
  }
  return [...visible];
}

function visibleGitHubReactions(client: RecordingGitHubReactions): readonly string[] {
  const deleted = new Set(client.deleted);
  return client.created
    .filter((reaction) => !deleted.has(reaction.id))
    .map((reaction) => reaction.content);
}

class RecordingDiscordBot implements DiscordBotClient {
  readonly reactions: Array<{ emoji: string }> = [];
  readonly deletedOwnReactions: Array<{ emoji: string }> = [];

  async createReaction(input: { emoji: string }): Promise<void> {
    this.reactions.push({ emoji: input.emoji });
  }

  async deleteOwnReaction(input: { emoji: string }): Promise<void> {
    this.deletedOwnReactions.push({ emoji: input.emoji });
  }

  async sendChannelMessage(): Promise<void> {}
  async sendConversationReply(): Promise<void> {}
  async readMessage(): Promise<never> {
    throw new Error("message unavailable");
  }
  async readThreadMessages(): Promise<never[]> {
    return [];
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getSelfUserId(): string {
    return "bot-1";
  }
  onMessageCreate(): () => void {
    return () => undefined;
  }
  onGuildDelete(): () => void {
    return () => undefined;
  }
}

class RecordingSlackClient implements SlackBotClient {
  readonly reactions: string[] = [];

  async sendMessage(): Promise<void> {}

  async addReaction(input: { name: string }): Promise<void> {
    this.reactions.push(`add:${input.name}`);
  }

  async removeReaction(input: { name: string }): Promise<void> {
    this.reactions.push(`remove:${input.name}`);
  }
}

class RecordingGitHubReactions implements GitHubReactionClient {
  readonly created: Array<{ id: number; content: string }> = [];
  readonly deleted: number[] = [];

  async createReaction(input: { content: string }): Promise<{ id: number }> {
    const reaction = { id: this.created.length + 1, content: input.content };
    this.created.push(reaction);
    return reaction;
  }

  async deleteReaction(input: { reactionId: number }): Promise<void> {
    this.deleted.push(input.reactionId);
  }
}
