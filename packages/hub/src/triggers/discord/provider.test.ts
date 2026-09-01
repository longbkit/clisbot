import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../../db/memory.js";
import { createAttachmentCapabilityRegistry } from "../../attachments/capabilities.js";
import { createActiveProjectConfiguration } from "../../test-utils/project-configuration.js";
import { MemoryDiscordBotClient } from "./memory-bot.js";
import { createDiscordTriggerProvider } from "./provider.js";
import type { NormalizedDiscordMessageEvent } from "./events.js";
import { isAcceptedTriggerProviderMatch } from "../index.js";

describe("Discord Phase 1 trigger provider", () => {
  it("normalizes typed inputs identically at the provider boundary", async () => {
    const { project, revision, store } = await activeConfiguration(inputConfiguration());
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
    });

    const match = (
      await provider.match(
        external(
          project.id,
          revision.id,
          event({ content: "<@900> repo=hub agent=opus investigate" }),
        ),
      )
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.deepEqual(match.invocation, {
      status: "accepted",
      prompt: "<@900> repo=hub agent=opus investigate",
      inputs: { repo: "hub", agent: "opus" },
    });
  });

  it("parses typed inputs after a matched command marker", async () => {
    const { project, revision, store } = await activeConfiguration(inputMarkerConfiguration());
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
    });

    const match = (
      await provider.match(
        external(project.id, revision.id, event({ content: "<@900> run repo=hub investigate" })),
      )
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.equal(match.invocation.prompt, "<@900> run repo=hub investigate");
    assert.equal(match.invocation.inputs["repo"], "hub");
  });

  it("preserves the complete message when the mention is last", async () => {
    const base = discordConfiguration();
    const configuration = {
      ...base,
      triggers: [
        {
          ...base.triggers[0]!,
          filters: { guild: "100", from_users: ["400"] },
        },
      ],
    };
    const { project, revision, store } = await activeConfiguration(configuration);
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
    });
    const prompt = "Do the whole thing first <@900>";

    const match = (
      await provider.match(external(project.id, revision.id, event({ content: prompt })))
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.equal(match.invocation.prompt, prompt);
  });

  it("matches a literal one-step prompt and keeps the mention allowlist fail-closed", async () => {
    const { project, revision, store } = await activeConfiguration();
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot,
    });
    const match = (await provider.match(external(project.id, revision.id, event())))[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.equal(match.configurationRevisionId, revision.id);
    assert.equal(
      await provider.match(external(project.id, revision.id, event({ authorId: "401" }))),
      "trigger_filters_rejected",
    );
  });

  it("preserves reply lifecycle actions and auto-archive in the provider match", async () => {
    const { project, revision, store } = await activeConfiguration();
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot,
    });
    const match = (await provider.match(external(project.id, revision.id, event())))[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    await provider.onDispatchAccepted?.(match.triggerContext, match.outputContext);
    await provider.onAgentExecutionStarted?.(match.triggerContext, match.outputContext);
    await provider.onAgentExecutionCompleted?.(match.triggerContext, match.outputContext, {
      status: "succeeded",
    });
    assert.deepEqual(
      bot.reactions.map((reaction) => reaction.emoji),
      ["👀", "⏳", "✅"],
    );
  });

  it("routes a durable Discord receipt to the configured connection", async () => {
    const database = createMemoryDatabase();
    const connection = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "org_1",
      slug: "secondary",
      guildId: "100",
      guildName: "Secondary",
      providerApplicationId: "discord-app",
    };
    database.organizationConnectionUsage = () =>
      Promise.resolve({ github: [], slack: [], discord: [connection], linear: [] });
    database.findDiscordConnectionForOrganization = () => Promise.resolve(connection);
    const { project, revision, store } = await createActiveProjectConfiguration(
      database,
      discordConnectionConfiguration(),
    );
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
    });

    const matches = await provider.match({
      ...external(project.id, revision.id, event()),
      connectionId: "22222222-2222-4222-8222-222222222222",
    });
    if (typeof matches === "string") throw new Error("expected matches");
    assert.deepEqual(
      matches.map((match) => match.triggerName),
      ["secondary-connection"],
    );
  });

  it("preserves Discord attachments, references, and thread context as durable evidence", async () => {
    const database = createMemoryDatabase();
    const { project, revision, store } = await createActiveProjectConfiguration(
      database,
      discordConfiguration(),
    );
    const attachments = createAttachmentCapabilityRegistry({
      database,
      publicBaseUrl: "https://hub.test",
      authoritySecret: "hub-secret",
      resolvers: {},
    });
    const attachment = {
      id: "701",
      filename: "design.png",
      url: "https://cdn.discordapp.com/attachments/200/701/design.png",
      contentType: "image/png",
      size: 42,
    };
    const bot = new MemoryDiscordBotClient({
      selfUserId: "900",
      threadMessages: [
        {
          id: "299",
          channelId: "207",
          content: "see image",
          author: { id: "401", username: "maintainer", bot: false },
          createdAt: "2026-05-18T23:59:00.000Z",
          attachments: [attachment],
          referencedMessage: null,
        },
      ],
    });
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot,
      attachments,
    });
    const match = (
      await provider.match({
        ...external(
          project.id,
          revision.id,
          event({
            channelId: "207",
            threadId: "207",
            parentChannelId: "200",
            attachments: [attachment],
            referencedMessage: { id: "299", channelId: "207", guildId: "100" },
          }),
        ),
        connectionId: "22222222-2222-4222-8222-222222222222",
      })
    )[0];

    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.deepEqual(bot.threadReads, []);
    assert.deepEqual(bot.messageReads, []);
    assert.equal(
      await database.findAttachmentBySource(
        "11111111-1111-4111-8111-111111111118",
        "discord",
        "701",
      ),
      undefined,
    );
    const triggerAttachment = match.triggerContext.event.discord.trigger_message.attachments[0];
    assert.ok(triggerAttachment);
    assert.equal("url" in triggerAttachment, false);
    assert.deepEqual(match.triggerContext.event.discord.trigger_message.referenced_message, {
      id: "299",
      channel_id: "207",
      guild_id: "100",
    });
    assert.deepEqual(match.triggerContext.event.discord.trigger_thread_context, {
      status: "deferred",
    });
    const materialized = await provider.materializeContext!({
      executionId: "execution-discord-materialize",
      organizationId: "org_1",
      projectId: project.id,
      providerEventReceiptId: "11111111-1111-4111-8111-111111111118",
      triggerContext: match.triggerContext,
    });
    assert.deepEqual(bot.threadReads, [{ channelId: "207", beforeMessageId: "300" }]);
    assert.deepEqual(bot.messageReads, []);
    const contextAttachment = await database.findAttachmentBySource(
      "11111111-1111-4111-8111-111111111118",
      "discord",
      "701",
    );
    assert.ok(contextAttachment);
    assert.deepEqual(materialized, {
      discord: {
        referenced_message: {
          id: "299",
          content: "see image",
          author: { id: "401", username: "maintainer", bot: false },
          channel: { id: "207" },
          created_at: "2026-05-18T23:59:00.000Z",
          attachments: [
            {
              id: contextAttachment.id,
              filename: "design.png",
              content_type: "image/png",
              size: 42,
              url: attachments.urlFor(contextAttachment.id, "execution-discord-materialize"),
            },
          ],
          referenced_message: null,
        },
        thread: {
          id: "207",
          parent_channel_id: "200",
          context_url: "https://discord.com/channels/100/207",
          messages: [
            {
              id: "299",
              content: "see image",
              author: { id: "401", username: "maintainer", bot: false },
              channel: { id: "207" },
              created_at: "2026-05-18T23:59:00.000Z",
              attachments: [
                {
                  id: contextAttachment.id,
                  filename: "design.png",
                  content_type: "image/png",
                  size: 42,
                  url: attachments.urlFor(contextAttachment.id, "execution-discord-materialize"),
                },
              ],
              referenced_message: null,
            },
          ],
        },
      },
    });
    assert.deepEqual(match.outputContext, {
      provider: "discord",
      guildId: "100",
      channelId: "207",
      threadId: "207",
      messageId: "300",
    });
    assert.equal(JSON.stringify(match.triggerContext).includes("agent-executions"), false);
    const secondMaterialized = await provider.materializeContext!({
      executionId: "execution-discord-materialize-2",
      organizationId: "org_1",
      projectId: project.id,
      providerEventReceiptId: "11111111-1111-4111-8111-111111111118",
      triggerContext: match.triggerContext,
    });
    const firstUrl = materialized?.discord.thread?.messages[0]?.attachments[0]?.url;
    const secondUrl = secondMaterialized?.discord.thread?.messages[0]?.attachments[0]?.url;
    assert.ok(firstUrl);
    assert.ok(secondUrl);
    assert.notEqual(firstUrl, secondUrl);
    assert.match(secondUrl, /execution-discord-materialize-2/u);
  });

  it("hydrates the direct message referenced by a channel trigger only on demand", async () => {
    const { project, revision, store } = await activeConfiguration();
    const referencedMessage = {
      id: "298",
      channelId: "200",
      content: "the original question",
      author: { id: "401", username: "maintainer", bot: false },
      createdAt: "2026-05-18T23:59:00.000Z",
      attachments: [],
      referencedMessage: null,
    };
    const bot = new MemoryDiscordBotClient({
      selfUserId: "900",
      messages: [referencedMessage],
    });
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot,
    });
    const match = (
      await provider.match(
        external(
          project.id,
          revision.id,
          event({ referencedMessage: { id: "298", channelId: "200", guildId: "100" } }),
        ),
      )
    )[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");

    assert.deepEqual(bot.threadReads, []);
    assert.deepEqual(bot.messageReads, []);

    const materialized = await provider.materializeContext!({
      executionId: "execution-discord-reference",
      organizationId: "org_1",
      projectId: project.id,
      providerEventReceiptId: "11111111-1111-4111-8111-111111111118",
      triggerContext: match.triggerContext,
    });

    assert.deepEqual(bot.threadReads, []);
    assert.deepEqual(bot.messageReads, [{ channelId: "200", messageId: "298" }]);
    assert.deepEqual(materialized, {
      discord: {
        referenced_message: {
          id: "298",
          content: "the original question",
          author: { id: "401", username: "maintainer", bot: false },
          channel: { id: "200" },
          created_at: "2026-05-18T23:59:00.000Z",
          attachments: [],
          referenced_message: null,
        },
        thread: null,
      },
    });
  });

  it("does not require attachment capability during Discord ingestion", async () => {
    const { project, revision, store } = await activeConfiguration();
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({ selfUserId: "900" }),
    });
    const match = (
      await provider.match(
        external(
          project.id,
          revision.id,
          event({
            attachments: [
              {
                id: "701",
                filename: "design.png",
                url: "https://cdn.discordapp.com/attachments/200/701/design.png",
                contentType: "image/png",
                size: 42,
              },
            ],
          }),
        ),
      )
    )[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    assert.deepEqual(match.triggerContext.event.discord.trigger_message.attachments, [
      { id: "701", filename: "design.png", contentType: "image/png", size: 42 },
    ]);
  });

  it("fails explicit Discord context materialization when thread history cannot be read", async () => {
    const { project, revision, store } = await activeConfiguration();
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: new MemoryDiscordBotClient({
        selfUserId: "900",
        threadContextFetchError: new Error("missing history permission"),
      }),
    });
    const match = (
      await provider.match(external(project.id, revision.id, event({ threadId: "207" })))
    )[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");
    await assert.rejects(
      provider.materializeContext!({
        executionId: "execution-discord-unavailable",
        organizationId: "org-1",
        projectId: project.id,
        providerEventReceiptId: "11111111-1111-4111-8111-111111111118",
        triggerContext: match.triggerContext,
      }),
      /missing history permission/u,
    );
  });

  it("targets lifecycle reactions and termination notices at the original Discord message", async () => {
    const { project, revision, store } = await activeConfiguration();
    const bot = new MemoryDiscordBotClient({ selfUserId: "900" });
    const provider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot,
    });
    const match = (
      await provider.match(external(project.id, revision.id, event({ threadId: "207" })))
    )[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");

    await provider.onDispatchAccepted?.(match.triggerContext, match.outputContext);
    await provider.onAgentExecutionStarted?.(match.triggerContext, match.outputContext);
    await provider.onAgentExecutionFailed?.(match.triggerContext, match.outputContext, "boom");
    await provider.onMachineTerminated?.(match.triggerContext, "launch_failed");
    await provider.onMachineTerminated?.(match.triggerContext, "completed");

    assert.deepEqual(
      bot.reactions.map((reaction) => reaction.emoji),
      ["👀", "⏳", "❌", "❌"],
    );
    assert.deepEqual(
      bot.deletedOwnReactions.map((reaction) => reaction.emoji),
      ["👀", "👀", "⏳", "👀", "⏳"],
    );
    assert.deepEqual(
      bot.messages.map((message) => ({
        channelId: message.channelId,
        threadId: message.threadId,
        content: message.content,
      })),
      [
        {
          channelId: "200",
          threadId: "207",
          content: "Paseo agent failed: boom",
        },
        {
          channelId: "200",
          threadId: "207",
          content: "Paseo machine terminated before the agent could complete: launch_failed",
        },
      ],
    );
  });

  it("propagates terminal Discord reaction and notice failures", async () => {
    const { project, revision, store } = await activeConfiguration();
    const reactionBot = new FailingDiscordBotClient({
      selfUserId: "900",
      failReactionEmoji: "✅",
    });
    const reactionProvider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: reactionBot,
    });
    const match = (await reactionProvider.match(external(project.id, revision.id, event())))[0];
    if (!isAcceptedTriggerProviderMatch(match)) throw new Error("expected accepted match");

    await assert.rejects(async () => {
      await reactionProvider.onAgentExecutionCompleted!(match.triggerContext, match.outputContext, {
        status: "succeeded",
      });
    }, /discord reaction failed/u);
    assert.deepEqual(
      reactionBot.deletedOwnReactions.map((reaction) => reaction.emoji),
      ["⏳"],
    );

    const noticeBot = new FailingDiscordBotClient({
      selfUserId: "900",
      failMessages: true,
    });
    const noticeProvider = createDiscordTriggerProvider({
      configurationStoreForProject: () => store,
      bot: noticeBot,
    });
    await assert.rejects(async () => {
      await noticeProvider.onAgentExecutionFailed!(
        match.triggerContext,
        match.outputContext,
        "boom",
      );
    }, /discord message failed/u);
    assert.deepEqual(
      noticeBot.reactions.map((reaction) => reaction.emoji),
      ["❌"],
    );
  });
});

async function activeConfiguration(rawConfiguration: unknown = discordConfiguration()) {
  return createActiveProjectConfiguration(createMemoryDatabase(), rawConfiguration);
}

class FailingDiscordBotClient extends MemoryDiscordBotClient {
  constructor(
    options: ConstructorParameters<typeof MemoryDiscordBotClient>[0] & {
      failReactionEmoji?: string;
      failMessages?: boolean;
    },
  ) {
    super(options);
    this.failReactionEmoji = options.failReactionEmoji;
    this.failMessages = options.failMessages ?? false;
  }

  private readonly failReactionEmoji: string | undefined;
  private readonly failMessages: boolean;

  override async createReaction(input: Parameters<MemoryDiscordBotClient["createReaction"]>[0]) {
    if (input.emoji === this.failReactionEmoji) throw new Error("discord reaction failed");
    await super.createReaction(input);
  }

  override async sendChannelMessage(
    input: Parameters<MemoryDiscordBotClient["sendChannelMessage"]>[0],
  ) {
    if (this.failMessages) throw new Error("discord message failed");
    await super.sendChannelMessage(input);
  }
}

function discordConfiguration() {
  return {
    environments: [
      {
        name: "discord-runner",
        kind: "daemon",
        daemon: "mob-hetzner",
        cwd: "/repo",
      },
    ],
    triggers: [
      {
        name: "discord-mention",
        on: "discord.mention",
        max_runtime: "2h",
        filters: { guild: "100", contains: "ping", from_users: ["400"] },
        steps: [
          {
            id: "discord-step",
            environment: "discord-runner",
            max_runtime: "1h",
            idle_timeout: "5m",
            agent: { provider: "claude/opus", mode: "bypassPermissions" },
            prompt: [{ text: "Respond to the Discord mention." }],
            allow_outputs: [{ type: "discord.reply" }],
            auto_archive: true,
          },
        ],
      },
    ],
  };
}

function inputConfiguration() {
  const base = discordConfiguration();
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
        filters: {
          guild: "100",
          contains: "repo=hub",
          from_users: ["400"],
          inputs: { repo: "hub" },
        },
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

function inputMarkerConfiguration() {
  const base = inputConfiguration();
  const trigger = base.triggers[0]!;
  return {
    ...base,
    triggers: [
      {
        ...trigger,
        filters: {
          ...trigger.filters,
          contains: "run",
        },
      },
    ],
  };
}

function discordConnectionConfiguration() {
  const base = discordConfiguration();
  return {
    ...base,
    triggers: [
      {
        ...base.triggers[0]!,
        name: "secondary-connection",
        filters: {
          guild: "100",
          from_users: ["400"],
          connection: "secondary",
        },
      },
    ],
  };
}

function external(
  projectId: string,
  configurationRevisionId: string,
  payload: NormalizedDiscordMessageEvent,
) {
  return {
    providerEventReceiptId: "11111111-1111-4111-8111-111111111118",
    organizationId: "org_1",
    projectId,
    configurationRevisionId,
    source: "discord.mention",
    deliveryId: payload.id,
    receivedAt: new Date(),
    payload,
  };
}

function event(
  overrides: {
    authorId?: string;
    content?: string;
    channelId?: string;
    threadId?: string | null;
    parentChannelId?: string | null;
    messageId?: string;
    attachments?: NormalizedDiscordMessageEvent["attachments"];
    referencedMessage?: NormalizedDiscordMessageEvent["referencedMessage"];
  } = {},
): NormalizedDiscordMessageEvent {
  return {
    type: "mention",
    id: "300",
    guildId: "100",
    channelId: overrides.channelId ?? "200",
    threadId: overrides.threadId ?? null,
    parentChannelId: overrides.parentChannelId ?? null,
    messageId: overrides.messageId ?? "300",
    content: overrides.content ?? "<@900> ping",
    mentionedUserIds: ["900"],
    author: { id: overrides.authorId ?? "400", username: "tester", bot: false },
    createdAt: "2026-05-19T00:00:00.000Z",
    attachments: overrides.attachments ?? [],
    referencedMessage: overrides.referencedMessage ?? null,
  };
}
