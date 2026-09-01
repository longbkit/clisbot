import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import type { OrganizationAccessValue } from "../../auth/organization-access.js";
import type { AuthServer } from "../../auth/server.js";
import { createMemoryDatabase } from "../../db/memory.js";
import type {
  BindSlackConnectionInput,
  ConnectionAttemptRecord,
  StartConnectionAttemptInput,
} from "../../db/types.js";
import type { SlackBotClient } from "../../triggers/slack/client.js";
import {
  SlackBotVerificationError,
  type SlackConnectionClient,
  type SlackInstallation,
} from "./client.js";
import { createSlackRegistration } from "./index.js";

describe("Slack registration", () => {
  it("constructs the complete webhook slice and starts OAuth with a protected state", async () => {
    const callback = callbackDatabase();
    const database = callback.database;
    let attempt: StartConnectionAttemptInput | undefined;
    database.startConnectionAttempt = (input) => {
      attempt = input;
      return Promise.resolve();
    };
    const registration = createSlackRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: slackConfiguration(),
      configurationVersion: 3,
      expectedConfigurationVersion: 2,
      activateConfiguration: true,
      connectionClient: new SlackConnectionFake(),
      botClient: new SlackBotFake(),
    });

    assert.equal(registration.connection.name, "slack");
    assert.equal(registration.sources.length, 1);
    assert.equal(registration.triggerProviders.length, 1);
    assert.deepEqual(
      registration.outputs.map((output) => output.type),
      ["slack.reply"],
    );
    assert.deepEqual(
      registration.requests.map((request) => request.name),
      ["slack.events"],
    );

    const response = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    assert.equal(response.status, 200);
    assert.equal(attempt?.provider, "slack");
    assert.equal(attempt?.configurationVersion, 3);
    assert.equal(attempt?.callbackOrigin, "https://hub.test");
    assert.deepEqual(attempt?.configurationSnapshot, {
      provider: "slack",
      ...slackConfiguration(),
    });
    assert.equal(attempt?.expectedConfigurationVersion, 2);
    assert.equal(attempt?.activateConfiguration, true);
    const body = z.object({ url: z.string() }).parse(await response.json());
    const state = new URL(body.url).searchParams.get("state");
    assert(state !== null && state.length > 20);
    assert.notEqual(attempt?.stateVerifier, state);
  });

  it("does not construct partial behavior when app configuration is absent", () => {
    const registration = createSlackRegistration({
      database: createMemoryDatabase(),
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: null,
    });
    assert.deepEqual(
      registration.connection.status({ github: [], discord: [], slack: [], linear: [] }),
      {
        status: "notConfigured",
      },
    );
    assert.deepEqual(registration.sources, []);
    assert.deepEqual(registration.outputs, []);
    assert.deepEqual(registration.requests, []);
  });

  it("verifies the returned bot before activating and binding the workspace", async () => {
    const callback = callbackDatabase();
    const database = callback.database;
    const client = new CompletingSlackConnectionFake();
    let activated = false;
    const registration = createSlackRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://callback.test",
      configuration: slackConfiguration(),
      connectionClient: client,
      botClient: new SlackBotFake(),
      configurationVersion: 1,
      activateConfiguration: true,
      onVerifiedInstallation: async (input) => {
        assert.equal(client.verified, true);
        assert.deepEqual(input.configuration, { provider: "slack", ...slackConfiguration() });
        assert.equal(input.callbackOrigin, "https://callback.test");
        assert.equal(input.installation.teamName, "Acme");
        await database.bindSlackConnection(input.binding);
        activated = true;
      },
    });
    const start = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    const state = new URL(
      z.object({ url: z.string() }).parse(await start.json()).url,
    ).searchParams.get("state");
    assert(state !== null);

    const response = await registration.connection.actions["callback"]!(
      new Request(`https://hub.test/callback?state=${state}&code=accepted`),
    );

    assert.equal(activated, true);
    assert.equal(
      response.headers.get("location"),
      "https://callback.test/o/org/connections?app=slack&result=slack_connected",
    );
    assert.equal(callback.boundInstallation?.teamName, "Acme");
  });

  it("does not activate or bind Slack when the returned bot token fails", async () => {
    const callback = callbackDatabase();
    const database = callback.database;
    const client = new CompletingSlackConnectionFake(true);
    let activated = false;
    const registration = createSlackRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://callback.test",
      configuration: slackConfiguration(),
      connectionClient: client,
      botClient: new SlackBotFake(),
      activateConfiguration: true,
      onVerifiedInstallation: () => {
        activated = true;
        return Promise.resolve();
      },
    });
    const start = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    const state = new URL(
      z.object({ url: z.string() }).parse(await start.json()).url,
    ).searchParams.get("state");
    assert(state !== null);

    const response = await registration.connection.actions["callback"]!(
      new Request(`https://hub.test/callback?state=${state}&code=accepted`),
    );

    assert.equal(activated, false);
    assert.equal(
      response.headers.get("location"),
      "https://callback.test/o/org/connections?app=slack&result=slack_bot_failed",
    );
    assert.equal(callback.boundInstallation, undefined);
  });

  it("rejects a new installation that did not grant every required bot scope", async () => {
    const callback = callbackDatabase();
    const client = new CompletingSlackConnectionFake(false, ["app_mentions:read", "chat:write"]);
    let activated = false;
    const registration = createSlackRegistration({
      database: callback.database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://callback.test",
      configuration: slackConfiguration(),
      connectionClient: client,
      botClient: new SlackBotFake(),
      activateConfiguration: true,
      onVerifiedInstallation: () => {
        activated = true;
        return Promise.resolve();
      },
    });
    const start = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    const state = new URL(
      z.object({ url: z.string() }).parse(await start.json()).url,
    ).searchParams.get("state");
    assert(state !== null);

    const response = await registration.connection.actions["callback"]!(
      new Request(`https://hub.test/callback?state=${state}&code=accepted`),
    );

    assert.equal(activated, false);
    assert.equal(callback.boundInstallation, undefined);
    assert.equal(
      response.headers.get("location"),
      "https://callback.test/o/org/connections?app=slack&result=slack_bot_failed",
    );
  });

  it("does not publish configuration when the durable workspace bind fails", async () => {
    const callback = callbackDatabase();
    callback.database.bindSlackConnection = () => Promise.reject(new Error("bind failed"));
    let published = false;
    const registration = createSlackRegistration({
      database: callback.database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://callback.test",
      configuration: slackConfiguration(),
      connectionClient: new CompletingSlackConnectionFake(),
      botClient: new SlackBotFake(),
      activateConfiguration: true,
      onVerifiedInstallation: async (input) => {
        await callback.database.bindSlackConnection(input.binding);
        published = true;
      },
    });
    const start = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    const state = new URL(
      z.object({ url: z.string() }).parse(await start.json()).url,
    ).searchParams.get("state");
    assert(state !== null);

    await registration.connection.actions["callback"]!(
      new Request(`https://hub.test/callback?state=${state}&code=accepted`),
    );

    assert.equal(published, false);
  });

  it("returns a trusted callback result when the operator cancels at Slack", async () => {
    const callback = callbackDatabase();
    const registration = createSlackRegistration({
      database: callback.database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://callback.test",
      configuration: slackConfiguration(),
      connectionClient: new CompletingSlackConnectionFake(),
      botClient: new SlackBotFake(),
    });
    const start = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    const state = new URL(
      z.object({ url: z.string() }).parse(await start.json()).url,
    ).searchParams.get("state");
    assert(state !== null);

    const response = await registration.connection.actions["callback"]!(
      new Request(`https://hub.test/callback?state=${state}&error=access_denied`),
    );

    assert.equal(
      response.headers.get("location"),
      "https://callback.test/o/org/connections?app=slack&result=slack_cancelled",
    );
    assert.equal(callback.boundInstallation, undefined);
  });

  it("surfaces legacy Slack installations that need the expanded grant", () => {
    const registration = createSlackRegistration({
      database: createMemoryDatabase(),
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: slackConfiguration(),
    });
    assert.deepEqual(
      registration.connection.status({
        github: [],
        discord: [],
        slack: [
          {
            id: "slack-connection",
            organizationId: "org",
            slug: "slack-workspace",
            teamId: "T1",
            teamName: "Workspace",
            botUserId: "UBOT",
            botAccessToken: "token",
            scopes: [],
            providerApplicationId: "A1",
          },
        ],
        linear: [],
      }),
      { status: "requiresReauthorization" },
    );
  });

  it("does not lend a rebound workspace token to an older organization execution", async () => {
    const database = createMemoryDatabase();
    database.findSlackConnectionForOrganization = () =>
      Promise.resolve({
        id: "slack-connection",
        organizationId: "org-b",
        slug: "slack-workspace",
        teamId: "T1",
        teamName: "Workspace",
        botUserId: "UBOT-B",
        botAccessToken: "token-b",
        providerApplicationId: "A1",
        scopes: [
          "app_mentions:read",
          "channels:history",
          "chat:write",
          "files:read",
          "groups:history",
          "reactions:write",
          "users:read",
        ],
      });
    const requests: string[] = [];
    const registration = createSlackRegistration({
      database,
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: slackConfiguration(),
      fetch: async (_input, init) => {
        requests.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json({ ok: true });
      },
    });
    const reply = registration.outputs[0]?.execute;
    assert(reply !== undefined);
    const context = {
      provider: "slack",
      teamId: "T1",
      channelId: "C1",
      threadTs: "1.1",
      messageTs: "1.1",
    };

    await assert.rejects(() =>
      reply({
        agentExecutionId: "old-org-a-execution",
        toolType: "slack.reply",
        args: { content: "old reply" },
        outputContext: { ...context, organizationId: "org-a" },
      }),
    );
    assert.deepEqual(requests, []);

    await reply({
      agentExecutionId: "new-org-b-execution",
      toolType: "slack.reply",
      args: { content: "new reply" },
      outputContext: { ...context, organizationId: "org-b" },
    });
    assert.deepEqual(requests, ["Bearer token-b"]);
  });
});

function slackConfiguration() {
  return {
    transport: "webhook" as const,
    appId: "A1",
    clientId: "client",
    clientSecret: "secret",
    signingSecret: "signing",
  };
}

function callbackDatabase() {
  const database = createMemoryDatabase({
    memberships: [
      {
        userId: "user",
        organizationId: "org",
        organizationName: "Org",
        organizationSlug: "org",
        membershipId: "membership",
        role: "owner",
      },
    ],
  });
  let attempt: ConnectionAttemptRecord | undefined;
  let boundInstallation: BindSlackConnectionInput | undefined;
  database.startConnectionAttempt = (input) => {
    attempt = {
      id: "attempt",
      provider: "slack",
      phase: "slack_authorization",
      organizationId: input.access.organizationId,
      returnRoute: input.access.returnRoute,
      userId: input.access.userId,
      sessionId: input.access.sessionId,
      candidateExternalId: null,
      pkceVerifier: null,
      configurationVersion: input.configurationVersion,
      providerApplicationId: input.providerApplicationId,
      callbackOrigin: input.callbackOrigin,
      configurationSnapshot: input.configurationSnapshot,
      expectedConfigurationVersion: input.expectedConfigurationVersion,
      activateConfiguration: input.activateConfiguration,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    return Promise.resolve();
  };
  database.readConnectionAttempt = () => {
    if (attempt === undefined) return Promise.reject(new Error("attempt unavailable"));
    return Promise.resolve(attempt);
  };
  database.consumeConnectionAttempt = () => {
    attempt = undefined;
    return Promise.resolve();
  };
  database.bindSlackConnection = (input) => {
    boundInstallation = input;
    return Promise.resolve();
  };
  return {
    database,
    get boundInstallation() {
      return boundInstallation;
    },
  };
}

class SlackConnectionFake implements SlackConnectionClient {
  authorizationUrl(state: string): string {
    return `https://slack.test/oauth?state=${state}`;
  }
  exchangeCode(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  verifyInstallation(): Promise<void> {
    return Promise.resolve();
  }
  revoke(): Promise<void> {
    return Promise.resolve();
  }
}

class CompletingSlackConnectionFake implements SlackConnectionClient {
  verified = false;

  constructor(
    private readonly failVerification = false,
    private readonly scopes = [
      "app_mentions:read",
      "channels:history",
      "chat:write",
      "files:read",
      "groups:history",
      "reactions:write",
      "users:read",
    ],
  ) {}

  authorizationUrl(state: string): string {
    return `https://slack.test/oauth?state=${state}`;
  }

  exchangeCode(): Promise<SlackInstallation> {
    return Promise.resolve({
      appId: "A1",
      teamId: "T1",
      teamName: "Acme",
      botUserId: "UBOT",
      botAccessToken: "xoxb-token",
      scopes: this.scopes,
    });
  }

  verifyInstallation(): Promise<void> {
    if (this.failVerification) return Promise.reject(new SlackBotVerificationError());
    this.verified = true;
    return Promise.resolve();
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}

class SlackBotFake implements SlackBotClient {
  sendMessage(): Promise<void> {
    return Promise.resolve();
  }
  addReaction(): Promise<void> {
    return Promise.resolve();
  }
  removeReaction(): Promise<void> {
    return Promise.resolve();
  }
}

class RegistrationAuth implements AuthServer {
  handle(): Promise<Response> {
    return Promise.resolve(new Response());
  }
  resources(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  resolveOrganizationAccess(): Promise<OrganizationAccessValue> {
    return Promise.resolve({
      session: { id: "session" },
      account: { id: "user", name: "User", email: "user@example.test" },
      organization: { id: "org", name: "Org" },
      membership: { id: "membership", role: "owner" },
      capabilities: { view: true, manageMembers: true, manageOwners: true, manageResources: true },
    });
  }
  async resolveAccount() {
    const access = await this.resolveOrganizationAccess();
    return {
      session: { id: access.session.id, activeOrganizationId: null },
      account: access.account,
      isInstanceOperator: false,
    };
  }
  rejectCookieMutation(): Response | undefined {
    return undefined;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
