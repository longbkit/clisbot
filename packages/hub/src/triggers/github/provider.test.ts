import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../../db/memory.js";
import type { DurableProviderEvent } from "../../db/types.js";
import { createActiveProjectConfiguration } from "../../test-utils/project-configuration.js";
import { createDurableWorkflowHandler } from "../../workflows/engine.js";
import type { GitHubReactionClient } from "./provider.js";
import { createGitHubTriggerProvider } from "./provider.js";
import type { NormalizedGitHubEvent } from "../../auth/github-events.js";
import { isAcceptedTriggerProviderMatch } from "../index.js";
import { createUnlimitedEntitlementsService } from "../../entitlements/test-utils.js";

describe("GitHub Phase 1 trigger provider", () => {
  it("normalizes typed inputs identically at the provider boundary", async () => {
    const { project, revision, store } = await activeConfiguration(inputConfiguration());
    const provider = createProvider(store, new TestReactions());

    const match = (
      await provider.match(
        external(
          project.id,
          revision.id,
          createEvent({ body: "@paseo repo=hub agent=opus investigate" }),
        ),
      )
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.deepEqual(match.invocation, {
      status: "accepted",
      prompt: "@paseo repo=hub agent=opus investigate",
      inputs: { repo: "hub", agent: "opus" },
    });
  });

  it("parses typed inputs after a matched contains marker in leading prose", async () => {
    const { project, revision, store } = await activeConfiguration(inputConfiguration());
    const provider = createProvider(store, new TestReactions());

    const match = (
      await provider.match(
        external(
          project.id,
          revision.id,
          createEvent({ body: "please @paseo repo=hub agent=opus investigate" }),
        ),
      )
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.deepEqual(match.invocation, {
      status: "accepted",
      prompt: "please @paseo repo=hub agent=opus investigate",
      inputs: { repo: "hub", agent: "opus" },
    });
  });

  it("preserves the complete comment when the marker is last", async () => {
    const { project, revision, store } = await activeConfiguration();
    const provider = createProvider(store, new TestReactions());
    const prompt = "Do the whole thing first @paseo";

    const match = (
      await provider.match(external(project.id, revision.id, createEvent({ body: prompt })))
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.equal(match.invocation.prompt, prompt);
  });

  it("matches a literal one-step prompt only after the security filters pass", async () => {
    const { project, revision, store } = await activeConfiguration();
    const reactions = new TestReactions();
    const provider = createProvider(store, reactions);
    const match = (await provider.match(external(project.id, revision.id, createEvent())))[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.equal(match.configurationRevisionId, revision.id);
    assert.equal(reactions.created.length, 0);

    const wrongActor = await provider.match(
      external(project.id, revision.id, createEvent({ actor: "untrusted" })),
    );
    assert.equal(wrongActor, "trigger_filters_rejected");
  });

  it("routes a semantic trigger from the legacy GitHub webhook source", async () => {
    const configuration = githubConfiguration();
    const trigger = configuration.triggers[0]!;
    configuration.triggers = [
      {
        ...trigger,
        on: "github.issue_created",
      },
    ];
    const { project, revision, store } = await activeConfiguration(configuration);
    const provider = createProvider(store, new TestReactions());
    const event: NormalizedGitHubEvent = {
      ...createEvent(),
      type: "issues",
      payload: {
        action: "opened",
        issue: {
          number: 211,
          title: "smoke",
          body: "issue body @paseo",
          user: { login: "issue-author" },
        },
        sender: { login: "boudra" },
      },
    };

    const matches = await provider.match(external(project.id, revision.id, event));
    assert.equal(typeof matches === "string" ? 0 : matches.length, 1);
  });

  it("exposes safe issue and pull-request item context without the raw webhook", async () => {
    const { project, revision, store } = await activeConfiguration();
    const provider = createProvider(store, new TestReactions());
    const issueMatch = (await provider.match(external(project.id, revision.id, createEvent())))[0];
    if (!isAcceptedTriggerProviderMatch(issueMatch)) throw new Error("expected issue match");
    const issueContext = await provider.materializeContext?.({
      executionId: "github-issue-context",
      organizationId: "org_1",
      projectId: project.id,
      providerEventReceiptId: "11111111-1111-4111-8111-111111111111",
      triggerContext: issueMatch.triggerContext,
    });
    assert.deepEqual(issueContext, {
      github: {
        delivery_id: "github-delivery-1",
        event_name: "issue_comment",
        repository: { full_name: "boudra/faro" },
        received_at: "2026-05-19T00:00:00.000Z",
        item: {
          type: "issue",
          number: 211,
          title: "smoke",
          body: "issue body",
          url: "https://github.com/boudra/faro/issues/211",
          author: { login: "issue-author" },
        },
      },
    });
    assert.equal(JSON.stringify(issueContext).includes("installation"), false);
    assert.equal(JSON.stringify(issueContext).includes("comment-credential"), false);

    const prMatch = (
      await provider.match(external(project.id, revision.id, createEvent({ pullRequest: true })))
    )[0];
    if (!isAcceptedTriggerProviderMatch(prMatch)) throw new Error("expected pull request match");
    const prContext = await provider.materializeContext?.({
      executionId: "github-pr-context",
      organizationId: "org_1",
      projectId: project.id,
      providerEventReceiptId: "11111111-1111-4111-8111-111111111112",
      triggerContext: prMatch.triggerContext,
    });
    assert.equal(
      Reflect.get(Reflect.get(Reflect.get(prContext!, "github"), "item"), "type"),
      "pull_request",
    );
  });

  it("does not materialize a GitHub credential for a GitHub trigger", async () => {
    const { store } = await activeConfiguration();
    const provider = createProvider(store, new TestReactions());

    assert.equal("materializeLaunch" in provider, false);
  });

  it("preserves lifecycle reactions and reply-capability configuration", async () => {
    const { project, revision, store } = await activeConfiguration();
    const reactions = new TestReactions();
    const provider = createProvider(store, reactions);
    const match = (await provider.match(external(project.id, revision.id, createEvent())))[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    let reactionState =
      (await provider.onDispatchAccepted?.(match.triggerContext, match.outputContext)) ?? null;
    reactionState =
      (await provider.onAgentExecutionStarted?.(
        match.triggerContext,
        match.outputContext,
        reactionState,
      )) ?? reactionState;
    await provider.onAgentExecutionCompleted?.(
      match.triggerContext,
      match.outputContext,
      { status: "succeeded" },
      reactionState,
    );
    assert.deepEqual(
      reactions.created.map((call) => call.content),
      ["eyes", "rocket", "+1"],
    );
  });

  it("replaces GitHub in-progress reactions on terminal failure at the event target", async () => {
    const { project, revision, store } = await activeConfiguration();
    const reactions = new TestReactions();
    const provider = createProvider(store, reactions);
    const match = (await provider.match(external(project.id, revision.id, createEvent())))[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");

    const reactionState =
      (await provider.onDispatchAccepted?.(match.triggerContext, match.outputContext)) ?? null;
    await provider.onAgentExecutionFailed?.(
      match.triggerContext,
      match.outputContext,
      "boom",
      reactionState,
    );

    assert.deepEqual(
      reactions.created.map((call) => call.content),
      ["eyes", "-1"],
    );
    assert.deepEqual(
      reactions.deleted.map((call) => call.reactionId),
      [1],
    );
    assert.deepEqual(reactions.deleted[0], {
      installationId: 42,
      repo: "boudra/faro",
      subject: { kind: "issue_comment", commentId: 123 },
      reactionId: 1,
    });
  });

  it("hands every matching configured GitHub trigger to the durable fan-out boundary", async () => {
    const database = createMemoryDatabase();
    const { project, revision, store } = await activeFanoutConfiguration(database);
    const provider = createProvider(store, new TestReactions());
    const matches = await provider.match(external(project.id, revision.id, createEvent()));
    if (typeof matches === "string") throw new Error("expected matches");
    assert.deepEqual(
      matches.map((match) => match.triggerName),
      ["github-mention", "github-mention-secondary"],
    );

    let dispatches = 0;
    const { handler, engine } = createDurableWorkflowHandler({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      providers: [provider],
      dispatchLaunchMachineIntent: async (intent) => {
        dispatches += 1;
        if (intent.workflowStepRunId === undefined) throw new Error("workflow step is required");
        const execution = await database.findAgentExecutionByWorkflowStepRunId(
          intent.workflowStepRunId,
        );
        if (execution === undefined) throw new Error("workflow execution was not persisted");
        return {
          execution,
        };
      },
    });
    const trigger = {
      providerEventReceiptId: "github-fanout-trigger",
      organizationId: "org_1",
      projectId: project.id,
      configurationRevisionId: revision.id,
      source: "github.issue_comment",
      deliveryId: "github-fanout-delivery",
      receivedAt: new Date(),
      payload: createEvent(),
      connectionId: null,
      resourceId: null,
    } satisfies DurableProviderEvent;

    await handler(trigger);
    await handler(trigger);
    await engine.processAvailable();

    const runs = await database.findTriggerRunsByProviderEventReceiptId(
      trigger.providerEventReceiptId,
    );
    assert.equal(runs.length, 2);
    assert.equal(dispatches, 2);
    assert.equal(
      new Set(
        await Promise.all(
          runs.map(async (run) => {
            const step = await database.findWorkflowStepRunByTriggerRun(run.id);
            assert.ok(step);
            const execution = await database.findAgentExecutionByWorkflowStepRunId(step.id);
            assert.ok(execution);
            return execution.id;
          }),
        ),
      ).size,
      2,
    );
  });
});

function createProvider(
  store: Awaited<ReturnType<typeof activeConfiguration>>["store"],
  reactions: TestReactions,
) {
  return createGitHubTriggerProvider({
    configurationStoreForProject: () => store,
    reactions,
  });
}

async function activeConfiguration(rawConfiguration = githubConfiguration()) {
  return createActiveProjectConfiguration(createMemoryDatabase(), rawConfiguration);
}

function inputConfiguration() {
  const base = githubConfiguration();
  const trigger = base.triggers[0]!;
  return {
    ...base,
    triggers: [
      {
        ...trigger,
        inputs: {
          repo: { type: "string", choices: ["paseo", "hub"] },
          agent: { type: "string", default: "codex", choices: ["codex", "opus"] },
        },
        filters: { ...trigger.filters, inputs: { repo: "hub" } },
        steps: [
          {
            ...trigger.steps[0]!,
            agent: { provider: "codex", mode: "bypassPermissions" },
            prompt: [{ text: "Request: ${{ paseo.prompt }}" }],
          },
        ],
      },
    ],
  };
}

async function activeFanoutConfiguration(database: ReturnType<typeof createMemoryDatabase>) {
  const configuration = githubConfiguration();
  const first = configuration.triggers[0]!;
  configuration.triggers.push({
    ...first,
    name: "github-mention-secondary",
    steps: [{ ...first.steps[0]!, id: "github-step-secondary" }],
  });
  return createActiveProjectConfiguration(database, configuration);
}

function githubConfiguration() {
  return {
    environments: [
      {
        name: "github-runner",
        kind: "daemon",
        daemon: "mob-hetzner",
        cwd: "/repo",
      },
    ],
    triggers: [
      {
        name: "github-mention",
        on: "github.issue_comment",
        max_runtime: "2h",
        filters: { repo: "boudra/faro", contains: "@paseo", from_users: ["boudra"] },
        steps: [
          {
            id: "github-step",
            environment: "github-runner",
            max_runtime: "1h",
            idle_timeout: "5m",
            agent: { provider: "claude/opus", mode: "bypassPermissions" },
            prompt: [{ text: "Handle the GitHub issue comment." }],
            allow_outputs: [{ type: "github.reply" }],
            auto_archive: true,
          },
        ],
      },
    ],
  };
}

function external(
  projectId: string,
  configurationRevisionId: string,
  payload: NormalizedGitHubEvent,
) {
  return {
    providerEventReceiptId: "11111111-1111-4111-8111-111111111119",
    organizationId: "org_1",
    projectId,
    configurationRevisionId,
    source: `github.${payload.type}`,
    deliveryId: payload.id,
    receivedAt: new Date(),
    payload,
  };
}

function createEvent(
  overrides: { actor?: string; body?: string; pullRequest?: boolean } = {},
): NormalizedGitHubEvent {
  const actor = overrides.actor ?? "boudra";
  return {
    id: "github-delivery-1",
    type: "issue_comment",
    repo: "boudra/faro",
    repositoryId: 7,
    installationId: 42,
    payload: {
      issue: {
        number: 211,
        title: "smoke",
        body: "issue body",
        html_url: "https://github.com/boudra/faro/issues/211",
        user: { login: "issue-author" },
        ...(overrides.pullRequest === true ? { pull_request: {} } : {}),
      },
      comment: {
        id: 123,
        body: overrides.body ?? "hello @paseo",
        html_url: "https://github.com/boudra/faro/issues/211#issuecomment-123",
        user: { login: actor },
        credential: "comment-credential",
      },
      sender: { login: actor },
    },
    createdAt: "2026-05-19T00:00:00.000Z",
  };
}

class TestReactions implements GitHubReactionClient {
  readonly created: Array<{ content: string }> = [];
  readonly deleted: Array<Parameters<GitHubReactionClient["deleteReaction"]>[0]> = [];

  async createReaction(input: Parameters<GitHubReactionClient["createReaction"]>[0]) {
    this.created.push({ content: input.content });
    return { id: this.created.length };
  }

  async deleteReaction(input: Parameters<GitHubReactionClient["deleteReaction"]>[0]) {
    this.deleted.push(input);
  }
}
