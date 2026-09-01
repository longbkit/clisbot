import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthServer } from "../../auth/server.js";
import { createMemoryDatabase } from "../../db/memory.js";
import type { DurableProviderEvent } from "../../db/types.js";
import type { ProviderRegistration } from "../../providers/registration.js";
import type { ExternalTrigger, TriggerHandler, TriggerProvider } from "../../triggers/index.js";
import type {
  Provider,
  ProviderApplicationConfiguration,
  ProviderApplicationIdentity,
  SlackProviderApplicationConfiguration,
} from "../index.js";
import { DynamicProviderRuntime } from "./runtime-owner.js";

describe("dynamic provider runtime", () => {
  it.each([
    "github.issues",
    "github.issue_comment",
    "github.pull_request",
    "github.pull_request_review",
    "github.pull_request_review_comment",
    "github.push",
  ] as const)("publishes raw source %s through the activated GitHub runtime", async (eventName) => {
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        downstreamRegistration(providerConfigurationId(configuration), [], []),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "github")!;
    await stable.sources[0]!.start(() => Promise.resolve());
    const trigger = stable.triggerProviders[0]!({
      configurationStoreForProject: () => {
        throw new Error("unused");
      },
      connectionsForProject: () => {
        throw new Error("unused");
      },
    })!;

    const candidate = await runtime.prepare(
      "github",
      providerConfiguration("github", "A1"),
      "https://hub.test",
      providerIdentity("github", "A1"),
      1,
    );
    await candidate.start();
    candidate.publish();

    assert.ok(trigger.eventNames.includes(eventName));
  });

  it("publishes a started replacement and routes later callbacks through it", async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const completed: string[] = [];
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        fakeRegistration(configurationId(configuration), started, stopped, completed),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "slack")!;
    await stable.sources[0]!.start(() => Promise.resolve());

    const first = await runtime.prepare(
      "slack",
      slackConfiguration("A1"),
      "https://hub.test",
      { provider: "slack", id: "A1", name: "A1" },
      1,
    );
    await first.start();
    first.publish();
    const trigger = stable.triggerProviders[0]!({
      configurationStoreForProject: () => {
        throw new Error("unused");
      },
      connectionsForProject: () => {
        throw new Error("unused");
      },
    })!;
    const matches = await trigger.match(externalTrigger());
    if (typeof matches === "string") throw new Error("expected a match");
    const oldMatch = matches[0];

    const second = await runtime.prepare(
      "slack",
      slackConfiguration("A2"),
      "https://hub.test",
      { provider: "slack", id: "A2", name: "A2" },
      2,
    );
    await second.start();
    second.publish();
    await new Promise((resolve) => setImmediate(resolve));

    // The replaced source retires immediately; later callbacks use the active registration.
    assert.deepEqual(stopped, ["A1"]);

    await trigger.onAgentExecutionCompleted?.(oldMatch!.triggerContext, oldMatch!.outputContext, {
      status: "succeeded",
    });
    await trigger.onAgentExecutionTerminal?.("execution-1", oldMatch!.triggerContext);
    await new Promise((resolve) => setImmediate(resolve));
    const response = await stable.connection.actions["start"]!(
      new Request("https://hub.test/start", { method: "POST" }),
    );
    assert.deepEqual(started, ["A1", "A2"]);
    assert.deepEqual(stopped, ["A1"]);
    assert.deepEqual(completed, ["A2"]);
    assert.deepEqual(await response.json(), { url: "https://provider.test/A2" });
  });

  it("routes replies and attachments through the active registration", async () => {
    const used: string[] = [];
    const stopped: string[] = [];
    const database = createMemoryDatabase();
    const runtime = new DynamicProviderRuntime({
      database,
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        downstreamRegistration(configurationId(configuration), used, stopped),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "slack")!;
    await stable.sources[0]!.start(() => Promise.resolve());
    const trigger = stable.triggerProviders[0]!({
      configurationStoreForProject: () => {
        throw new Error("unused");
      },
      connectionsForProject: () => {
        throw new Error("unused");
      },
    })!;
    const first = await runtime.prepare(
      "slack",
      slackConfiguration("A1"),
      "https://hub.test",
      { provider: "slack", id: "A1", name: "A1" },
      1,
    );
    await first.start();
    first.publish();
    const matches = await trigger.match(externalTrigger());
    if (typeof matches === "string") throw new Error("expected a match");
    const match = matches[0]!;
    await trigger.materializeLaunch?.({
      executionId: "execution-1",
      organizationId: "org",
      projectId: "project",
      triggerContext: match.triggerContext,
    });

    const second = await runtime.prepare(
      "slack",
      slackConfiguration("A2"),
      "https://hub.test",
      { provider: "slack", id: "A2", name: "A2" },
      2,
    );
    await second.start();
    second.publish();

    await stable.outputs[0]!.execute({
      agentExecutionId: "execution-1",
      toolType: "slack.reply",
      args: { content: "reply" },
      outputContext: match.outputContext,
    });
    await stable.attachment!.resolve({
      organizationId: "org",
      connectionId: "connection",
      locator: {},
      executionId: "execution-1",
    });

    assert.deepEqual(used, ["launch:A1", "reply:A2", "attachment:A2"]);
    assert.deepEqual(stopped, ["A1"]);
    await trigger.onAgentExecutionTerminal?.("execution-1", match.triggerContext);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(stopped, ["A1"]);
  });

  it("lets a Discord-triggered execution use the active GitHub integration and authority", async () => {
    const used: string[] = [];
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        downstreamRegistration(providerConfigurationId(configuration), used, []),
    });
    const github = runtime
      .registrations()
      .find((registration) => registration.connection.name === "github")!;
    const discord = runtime
      .registrations()
      .find((registration) => registration.connection.name === "discord")!;
    const discordTrigger = discord.triggerProviders[0]!({
      configurationStoreForProject: () => {
        throw new Error("unused");
      },
      connectionsForProject: () => {
        throw new Error("unused");
      },
    })!;
    const githubCandidate = await runtime.prepare(
      "github",
      providerConfiguration("github", "A1"),
      "https://hub.test",
      providerIdentity("github", "A1"),
      1,
    );
    await githubCandidate.start();
    githubCandidate.publish();
    const discordCandidate = await runtime.prepare(
      "discord",
      providerConfiguration("discord", "D1"),
      "https://hub.test",
      providerIdentity("discord", "D1"),
      1,
    );
    await discordCandidate.start();
    discordCandidate.publish();

    const matches = await discordTrigger.match({
      ...externalTrigger(),
      source: "discord.mention",
    });
    if (typeof matches === "string") throw new Error("expected a match");
    const match = matches[0]!;
    await discordTrigger.materializeLaunch?.({
      executionId: "execution-1",
      organizationId: "org",
      projectId: "project",
      triggerContext: match.triggerContext,
    });

    await github.integration!.resolve("project", "github", "token", {
      executionId: "execution-1",
    });
    const authority = await github.integration!.githubAuthority!.mint({
      projectId: "project",
      connectionSlug: "github",
      repositories: ["acme/repository"],
      permissions: { contents: "write" },
    });

    assert.deepEqual(used, ["launch:D1", "integration:A1", "authority-mint:A1"]);
    await github.integration!.githubAuthority!.revoke(authority.token);
  });

  it("reports an unavailable capability with a stable diagnostic code", async () => {
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
    });
    const github = runtime
      .registrations()
      .find((registration) => registration.connection.name === "github")!;

    await assert.rejects(
      async () =>
        github.integration!.githubAuthority!.mint({
          projectId: "project",
          connectionSlug: "github",
          repositories: ["acme/repository"],
          permissions: { contents: "read" },
        }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "github_authority_unavailable",
    );
  });

  it("drains in-flight configuration calls while later GitHub capabilities use the replacement", async () => {
    const used: string[] = [];
    const stopped: string[] = [];
    let releaseConfiguration: (() => void) | undefined;
    const configurationGate = new Promise<void>((resolve) => {
      releaseConfiguration = resolve;
    });
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        downstreamRegistration(
          providerConfigurationId(configuration),
          used,
          stopped,
          configurationGate,
        ),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "github")!;
    await stable.sources[0]!.start(() => Promise.resolve());
    const first = await runtime.prepare(
      "github",
      providerConfiguration("github", "A1"),
      "https://hub.test",
      providerIdentity("github", "A1"),
      1,
    );
    await first.start();
    first.publish();
    const trigger = stable.triggerProviders[0]!({
      configurationStoreForProject: () => {
        throw new Error("unused");
      },
      connectionsForProject: () => {
        throw new Error("unused");
      },
    })!;
    const matches = await trigger.match({ ...externalTrigger(), source: "github.push" });
    if (typeof matches === "string") throw new Error("expected a match");
    const match = matches[0]!;
    await trigger.materializeLaunch?.({
      executionId: "execution-1",
      organizationId: "org",
      projectId: "project",
      triggerContext: match.triggerContext,
    });

    const pendingConfiguration = stable.githubConfiguration!.readFileAtCommit({
      installationId: 1,
      repositoryId: 2,
      commitSha: "sha",
      path: ".paseo/hub.yml",
    });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await runtime.prepare(
      "github",
      providerConfiguration("github", "A2"),
      "https://hub.test",
      providerIdentity("github", "A2"),
      2,
    );
    await second.start();
    second.publish();

    assert.deepEqual(stopped, ["A1"]);
    releaseConfiguration?.();
    await pendingConfiguration;
    await stable.integration!.resolve("project", "github", "token", {
      executionId: "execution-1",
    });
    const authority = await stable.integration!.githubAuthority!.mint({
      projectId: "project",
      connectionSlug: "github",
      repositories: ["acme/repository"],
      permissions: { contents: "write" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(used, [
      "launch:A1",
      "configuration:A1",
      "integration:A2",
      "authority-mint:A2",
    ]);
    assert.deepEqual(stopped, ["A1"]);
    await trigger.onAgentExecutionTerminal?.("execution-1", match.triggerContext);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(stopped, ["A1"]);
    await stable.integration!.githubAuthority!.revoke(authority.token);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(used.at(-1), "authority-revoke:A2");
    assert.deepEqual(stopped, ["A1"]);
  });

  it("leaves the active registration untouched when a candidate cannot start", async () => {
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ configuration }) =>
        fakeRegistration(
          configurationId(configuration),
          [],
          [],
          [],
          configurationId(configuration) === "A2",
        ),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "slack")!;
    await stable.sources[0]!.start(() => Promise.resolve());
    const first = await runtime.prepare(
      "slack",
      slackConfiguration("A1"),
      "https://hub.test",
      { provider: "slack", id: "A1", name: "A1" },
      1,
    );
    await first.start();
    first.publish();
    const failed = await runtime.prepare(
      "slack",
      slackConfiguration("A2"),
      "https://hub.test",
      { provider: "slack", id: "A2", name: "A2" },
      2,
    );

    await assert.rejects(() => failed.start(), /start failed/u);
    await failed.close();
    const response = await stable.connection.actions["start"]!(
      new Request("https://hub.test/start", { method: "POST" }),
    );
    assert.deepEqual(await response.json(), { url: "https://provider.test/A1" });
    assert.equal(runtime.identity("slack")?.id, "A1");
  });

  for (const provider of ["github", "slack", "discord"] as const) {
    it(`activates ${provider} for new connection actions without a restart`, async () => {
      const runtime = new DynamicProviderRuntime({
        database: createMemoryDatabase(),
        auth: testAuth(),
        applicationBaseUrl: "https://hub.test",
        registrationFactory: ({ provider: candidateProvider, configuration }) =>
          connectionRegistration(candidateProvider, providerConfigurationId(configuration)),
      });
      const stable = runtime
        .registrations()
        .find((registration) => registration.connection.name === provider)!;
      await stable.sources[0]!.start(() => Promise.resolve());
      const candidate = await runtime.prepare(
        provider,
        providerConfiguration(provider, "one"),
        "https://hub.test",
        providerIdentity(provider, "one"),
        1,
      );

      await candidate.start();
      candidate.publish();

      const response = await stable.connection.actions["start"]!(
        new Request("https://hub.test/start", { method: "POST" }),
      );
      assert.deepEqual(await response.json(), { url: `https://provider.test/${provider}/one` });
    });

    it(`keeps the working ${provider} registration when replacement startup fails`, async () => {
      const runtime = new DynamicProviderRuntime({
        database: createMemoryDatabase(),
        auth: testAuth(),
        applicationBaseUrl: "https://hub.test",
        registrationFactory: ({ provider: candidateProvider, configuration }) =>
          connectionRegistration(
            candidateProvider,
            providerConfigurationId(configuration),
            providerConfigurationId(configuration) === "two",
          ),
      });
      const stable = runtime
        .registrations()
        .find((registration) => registration.connection.name === provider)!;
      await stable.sources[0]!.start(() => Promise.resolve());
      const first = await runtime.prepare(
        provider,
        providerConfiguration(provider, "one"),
        "https://hub.test",
        providerIdentity(provider, "one"),
        1,
      );
      await first.start();
      first.publish();
      const replacement = await runtime.prepare(
        provider,
        providerConfiguration(provider, "two"),
        "https://hub.test",
        providerIdentity(provider, "two"),
        2,
      );

      await assert.rejects(() => replacement.start(), /start failed/u);
      await replacement.close();

      const response = await stable.connection.actions["start"]!(
        new Request("https://hub.test/start", { method: "POST" }),
      );
      assert.deepEqual(await response.json(), { url: `https://provider.test/${provider}/one` });
      assert.equal(runtime.identity(provider)?.id, "one");
    });
  }

  it("reconstructs callbacks from the configuration version and origin that began OAuth", async () => {
    const database = createMemoryDatabase();
    database.findConnectionAttemptConfiguration = () =>
      Promise.resolve({
        configurationVersion: 1,
        callbackOrigin: "https://old-origin.test",
        configurationSnapshot: slackConfiguration("old"),
        expectedConfigurationVersion: null,
        activateConfiguration: false,
      });
    const runtime = new DynamicProviderRuntime({
      database,
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ provider, configuration, callbackOrigin, configurationVersion }) => ({
        ...connectionRegistration(provider, providerConfigurationId(configuration)),
        configurationSnapshot: { version: configurationVersion, callbackOrigin },
      }),
    });
    const active = await runtime.prepare(
      "slack",
      slackConfiguration("new"),
      "https://new-origin.test",
      { provider: "slack", id: "new", name: "New" },
      2,
    );
    active.publish();
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "slack")!;

    const response = await stable.connection.actions["callback"]!(
      new Request("https://hub.test/callback?state=attempt-state"),
    );

    assert.deepEqual(await response.json(), { callbackFor: "old" });
  });

  it("rejects unpublished and retired source events so the provider retries them", async () => {
    const sourceHandlers = new Map<string, TriggerHandler>();
    const accepted: string[] = [];
    const runtime = new DynamicProviderRuntime({
      database: createMemoryDatabase(),
      auth: testAuth(),
      applicationBaseUrl: "https://hub.test",
      registrationFactory: ({ provider, configuration }) => ({
        ...connectionRegistration(provider, providerConfigurationId(configuration)),
        sources: [
          {
            start: (handler) => {
              sourceHandlers.set(providerConfigurationId(configuration), handler);
              return Promise.resolve();
            },
            stop: () => Promise.resolve(),
          },
        ],
      }),
    });
    const stable = runtime
      .registrations()
      .find((registration) => registration.connection.name === "slack")!;
    await stable.sources[0]!.start((event) => {
      accepted.push(String(event.payload));
      return Promise.resolve();
    });
    const first = await runtime.prepare(
      "slack",
      slackConfiguration("one"),
      "https://hub.test",
      { provider: "slack", id: "one", name: "One" },
      1,
    );
    await first.start();
    await assert.rejects(sourceHandlers.get("one")!(durableEvent("before-first-publish")));
    first.publish();
    await sourceHandlers.get("one")!(durableEvent("first-active"));
    const second = await runtime.prepare(
      "slack",
      slackConfiguration("two"),
      "https://hub.test",
      { provider: "slack", id: "two", name: "Two" },
      2,
    );
    await second.start();
    await assert.rejects(sourceHandlers.get("two")!(durableEvent("before-second-publish")));
    second.publish();
    await assert.rejects(sourceHandlers.get("one")!(durableEvent("retired")));
    await sourceHandlers.get("two")!(durableEvent("second-active"));

    assert.deepEqual(accepted, ["first-active", "second-active"]);
  });
});

function providerConfiguration(provider: Provider, id: string): ProviderApplicationConfiguration {
  if (provider === "github") {
    return {
      provider,
      appId: id,
      appSlug: id,
      clientId: "client",
      clientSecret: "secret",
      privateKey: "key",
      webhookSecret: "webhook",
    };
  }
  if (provider === "slack") return slackConfiguration(id);
  if (provider === "linear") {
    return { provider, clientId: id, clientSecret: "secret", webhookSecret: "webhook" };
  }
  return { provider, applicationId: id, clientSecret: "secret", botToken: "token" };
}

function providerIdentity(provider: Provider, id: string): ProviderApplicationIdentity {
  if (provider === "github") return { provider, id, name: id, ownerLogin: "owner" };
  return { provider, id, name: id };
}

function providerConfigurationId(configuration: ProviderApplicationConfiguration): string {
  if (configuration.provider === "github") return configuration.appId;
  if (configuration.provider === "slack") return configuration.appId;
  if (configuration.provider === "linear") return configuration.clientId;
  return configuration.applicationId;
}

function connectionRegistration(
  provider: Provider,
  id: string,
  failStart = false,
): ProviderRegistration {
  return {
    connection: {
      name: provider,
      status: () => ({ status: "connected" }),
      actions: {
        start: () =>
          Promise.resolve(Response.json({ url: `https://provider.test/${provider}/${id}` })),
        callback: () => Promise.resolve(Response.json({ callbackFor: id })),
      },
    },
    triggerProviders: [],
    sources: [
      {
        start: () => (failStart ? Promise.reject(new Error("start failed")) : Promise.resolve()),
        stop: () => Promise.resolve(),
      },
    ],
    outputs: [],
    requests: [],
  };
}

function slackConfiguration(appId: string): SlackProviderApplicationConfiguration {
  return {
    provider: "slack",
    transport: "webhook",
    appId,
    clientId: "client",
    clientSecret: "secret",
    signingSecret: "signing",
  };
}

function configurationId(configuration: ProviderApplicationConfiguration): string {
  if (configuration.provider !== "slack") throw new Error("expected Slack configuration");
  return configuration.appId;
}

function fakeRegistration(
  id: string,
  started: string[],
  stopped: string[],
  completed: string[],
  failStart = false,
): ProviderRegistration {
  const trigger: TriggerProvider<"slack", { id: string }, { id: string }> = {
    name: "slack",
    eventNames: ["slack.mention"],
    match: () =>
      Promise.resolve([
        {
          triggerName: "mention",
          triggerContext: { id },
          outputContext: { id },
          hubConfig: {},
          invocation: { status: "accepted", prompt: "", inputs: {} },
        },
      ]),
    onAgentExecutionCompleted: () => {
      completed.push(id);
      return Promise.resolve();
    },
  };
  return {
    connection: {
      name: "slack",
      status: () => ({ status: "connected" }),
      actions: {
        start: () => Promise.resolve(Response.json({ url: `https://provider.test/${id}` })),
      },
    },
    triggerProviders: [() => trigger],
    sources: [
      {
        start: () => {
          if (failStart) return Promise.reject(new Error("start failed"));
          started.push(id);
          return Promise.resolve();
        },
        stop: () => {
          stopped.push(id);
          return Promise.resolve();
        },
      },
    ],
    outputs: [],
    requests: [],
  };
}

function downstreamRegistration(
  id: string,
  used: string[],
  stopped: string[],
  configurationGate: Promise<void> = Promise.resolve(),
): ProviderRegistration {
  const trigger: TriggerProvider = {
    name: id.startsWith("A") ? "github" : "slack",
    eventNames: ["github.push", "slack.mention"],
    match: () =>
      Promise.resolve([
        {
          triggerName: "event",
          triggerContext: { id },
          outputContext: { provider: "slack", id },
          hubConfig: {},
          invocation: { status: "accepted", prompt: "", inputs: {} },
        },
      ]),
    materializeLaunch: () => {
      used.push(`launch:${id}`);
      return Promise.resolve({});
    },
  };
  return {
    connection: {
      name: "github",
      status: () => ({ status: "connected" }),
      actions: {},
    },
    integration: {
      resolve: () => {
        used.push(`integration:${id}`);
        return Promise.resolve(`token:${id}`);
      },
      githubAuthority: {
        mint: () => {
          used.push(`authority-mint:${id}`);
          return Promise.resolve({
            token: `authority:${id}`,
            expiresAt: Date.now() + 60_000,
            botUserId: 1,
            botLogin: "paseo-bot",
          });
        },
        revoke: () => {
          used.push(`authority-revoke:${id}`);
          return Promise.resolve();
        },
      },
    },
    triggerProviders: [() => trigger],
    sources: [
      {
        start: () => Promise.resolve(),
        stop: () => {
          stopped.push(id);
          return Promise.resolve();
        },
      },
    ],
    outputs: [
      {
        type: "slack.reply",
        tool: { name: "reply", description: "reply", inputSchema: { type: "object" } },
        execute: () => {
          used.push(`reply:${id}`);
          return Promise.resolve();
        },
      },
    ],
    requests: [],
    attachment: {
      provider: "slack",
      resolve: () => {
        used.push(`attachment:${id}`);
        return Promise.resolve(new Response(id));
      },
    },
    githubConfiguration: {
      listInstallationRepositories: () => Promise.resolve([]),
      readDefaultBranchHead: () => Promise.resolve(id),
      listFilesAtCommit: () => Promise.resolve([]),
      readFileAtCommit: async () => {
        used.push(`configuration:${id}`);
        await configurationGate;
        return { kind: "file", content: id };
      },
    },
  };
}

function externalTrigger(): ExternalTrigger {
  return {
    providerEventReceiptId: "receipt",
    organizationId: "org",
    projectId: "project",
    configurationRevisionId: "revision",
    source: "slack.mention",
    deliveryId: "delivery",
    receivedAt: new Date(),
    payload: {},
  };
}

function durableEvent(payload: string): DurableProviderEvent {
  return {
    providerEventReceiptId: "receipt",
    organizationId: "org",
    projectId: "project",
    configurationRevisionId: "revision",
    source: "slack.mention",
    deliveryId: payload,
    receivedAt: new Date(),
    payload,
    connectionId: null,
    resourceId: null,
  };
}

function testAuth(): AuthServer {
  return {
    handle: () => Promise.reject(new Error("unused")),
    resources: () => Promise.reject(new Error("unused")),
    resolveOrganizationAccess: () => Promise.reject(new Error("unused")),
    resolveAccount: () => Promise.reject(new Error("unused")),
    rejectCookieMutation: () => undefined,
    close: () => Promise.resolve(),
  };
}
