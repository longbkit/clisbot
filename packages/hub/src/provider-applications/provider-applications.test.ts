import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AccountAccessValue } from "../auth/organization-access.js";
import {
  ProviderApplicationError,
  activateProviderApplicationsAtStartup,
  createProviderApplications,
  providerApplicationReturnRoute,
  type ProviderApplicationConfiguration,
  type ProviderApplicationIdentity,
  type Provider,
  type ProviderApplicationStore,
  type ProviderRuntimeCandidate,
  type ProviderRuntimeOwner,
} from "./index.js";

const githubConfiguration: ProviderApplicationConfiguration = {
  provider: "github",
  appId: "42",
  appSlug: "paseo",
  clientId: "client",
  clientSecret: "client-secret",
  privateKey: "private-key",
  webhookSecret: "webhook-secret",
};
const slackConfiguration: ProviderApplicationConfiguration = {
  provider: "slack",
  transport: "webhook",
  appId: "A1",
  clientId: "client",
  clientSecret: "client-secret",
  signingSecret: "signing-secret",
};
const linearConfiguration: ProviderApplicationConfiguration = {
  provider: "linear",
  clientId: "linear-client",
  clientSecret: "linear-client-secret",
  webhookSecret: "linear-webhook-secret",
};

describe("provider applications", () => {
  it("reveals no provider state to a signed-in non-operator", async () => {
    const fixture = createFixture({ operator: false });

    await assert.rejects(
      fixture.applications.overview(request()),
      (error: unknown) => error instanceof ProviderApplicationError && error.code === "forbidden",
    );
    assert.equal(fixture.store.reads, 0);
  });

  it("rejects cross-origin mutations before reading or changing provider state", async () => {
    const fixture = createFixture({ rejectMutation: true });

    await assert.rejects(
      fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration),
      (error: unknown) => error instanceof ProviderApplicationError && error.code === "forbidden",
    );

    assert.equal(fixture.store.reads, 0);
    assert.equal(fixture.runtime.prepareCount("github"), 0);
  });

  it("keeps secrets write-only in every overview projection", async () => {
    const fixture = createFixture();
    await fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration);

    const overview = await fixture.applications.overview(request());
    const serialized = JSON.stringify(overview);
    assert.equal(serialized.includes("client-secret"), false);
    assert.equal(serialized.includes("private-key"), false);
    assert.equal(serialized.includes("webhook-secret"), false);
    assert.deepEqual(overview.providers.github.identifiers, {
      appId: "42",
      appSlug: "paseo",
      clientId: "client",
    });
  });

  it("shows signed-event evidence only for the active identity and configuration version", async () => {
    const fixture = createFixture({ eventEvidenceVersion: 1 });
    await fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration);
    assert.equal(
      (await fixture.applications.overview(request())).providers.github.lastEventAt,
      "2026-08-14T10:00:00.000Z",
    );

    await fixture.applications.verifyAndSave(request("POST"), "github", {
      ...githubConfiguration,
      clientSecret: "rotated-secret",
      expectedVersion: 1,
    });

    assert.equal(
      (await fixture.applications.overview(request())).providers.github.lastEventAt,
      null,
    );
  });

  it("shows Action needed when canonical connection health reports a legacy partial grant", async () => {
    const fixture = createFixture({ connected: true, connectionStatus: "actionNeeded" });
    await fixture.store.save({
      provider: "github",
      configuration: githubConfiguration,
      identity: { provider: "github", id: "42", name: "Paseo", ownerLogin: "acme" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
    });

    assert.equal(
      (await fixture.applications.overview(request())).providers.github.status,
      "actionNeeded",
    );
  });

  it("serializes saves per provider while allowing different providers to proceed", async () => {
    const fixture = createFixture();
    fixture.runtime.block("github");
    fixture.runtime.block("discord");
    const firstGitHub = fixture.applications.verifyAndSave(
      request("POST"),
      "github",
      githubConfiguration,
    );
    await fixture.runtime.waitUntilPrepared("github");
    const secondGitHub = fixture.applications.verifyAndSave(
      request("POST"),
      "github",
      githubConfiguration,
    );
    const discord = fixture.applications.verifyAndSave(request("POST"), "discord", {
      provider: "discord",
      applicationId: "100",
      clientSecret: "discord-secret",
      botToken: "discord-token",
    });

    await fixture.runtime.waitUntilPrepared("discord");
    assert.equal(fixture.runtime.prepareCount("github"), 1);
    fixture.runtime.release("github");
    await firstGitHub;
    await fixture.runtime.waitUntilPrepared("github", 2);
    fixture.runtime.release("github");
    fixture.runtime.release("discord");
    await assert.rejects(
      secondGitHub,
      (error: unknown) =>
        error instanceof ProviderApplicationError && error.code === "configurationConflict",
    );
    await discord;
  });

  it("resolves a queued connection from the configuration saved ahead of it", async () => {
    const fixture = createFixture();
    fixture.runtime.block("github");
    const save = fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration);
    await fixture.runtime.waitUntilPrepared("github");
    const connect = fixture.applications.beginConnection(request("POST"), "github", "org");
    let connectError: unknown;
    const observedConnect = connect.catch((error: unknown) => {
      connectError = error;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(connectError, undefined);

    fixture.runtime.release("github");
    await save;
    await observedConnect;
    assert.equal(connectError, undefined);

    assert.deepEqual(fixture.runtime.preparedConfigurationIds("github"), ["42", "42"]);
    assert.deepEqual(fixture.runtime.preparedVersions("github"), [1, 1]);
  });

  it("preserves the prior active provider and persisted row when candidate start fails", async () => {
    const fixture = createFixture();
    await fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration);
    const previous = fixture.runtime.active("github");
    const stored = fixture.store.values.get("github");
    fixture.runtime.failNextStart("github");

    await assert.rejects(
      fixture.applications.verifyAndSave(request("POST"), "github", {
        ...githubConfiguration,
        clientSecret: "rotated-secret",
      }),
      (error: unknown) => error instanceof ProviderApplicationError && error.code === "internal",
    );

    assert.equal(fixture.runtime.active("github"), previous);
    assert.equal(fixture.store.values.get("github"), stored);
  });

  it("refuses an external application identity change while connections exist", async () => {
    const fixture = createFixture({ connected: true });
    fixture.store.values.set("github", {
      provider: "github",
      configuration: githubConfiguration,
      identity: { provider: "github", id: "42", name: "Paseo", ownerLogin: "acme" },
      version: 1,
      verifiedAt: new Date("2026-08-14T10:00:00Z"),
      updatedAt: new Date("2026-08-14T10:00:00Z"),
      updatedByUserId: "operator",
    });
    fixture.verificationIdentity = {
      provider: "github",
      id: "99",
      name: "Other App",
      ownerLogin: "acme",
    };

    await assert.rejects(
      fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration),
      (error: unknown) =>
        error instanceof ProviderApplicationError &&
        error.code === "identityConflict" &&
        error.safeContext === "Paseo",
    );
    assert.equal(fixture.runtime.prepareCount("github"), 0);
  });

  it("uses a complete environment override without overwriting the stored configuration", async () => {
    const environmentConfiguration = {
      ...githubConfiguration,
      appId: "84",
      appSlug: "environment-app",
      clientId: "environment-client",
    };
    const fixture = createFixture({ environment: { github: environmentConfiguration } });
    fixture.store.values.set("github", {
      provider: "github",
      configuration: githubConfiguration,
      identity: { provider: "github", id: "42", name: "Stored", ownerLogin: "acme" },
      version: 3,
      verifiedAt: new Date(),
      updatedAt: new Date(),
      updatedByUserId: "operator",
    });

    const overridden = await fixture.applications.overview(request());
    assert.equal(overridden.providers.github.status, "managedByEnvironment");
    assert.deepEqual(overridden.providers.github.identifiers, {
      appId: "84",
      appSlug: "environment-app",
      clientId: "environment-client",
    });
    assert.equal(fixture.store.values.get("github")?.version, 3);

    const resumed = createFixture();
    resumed.store.values.set("github", fixture.store.values.get("github")!);
    assert.deepEqual(
      (await resumed.applications.overview(request())).providers.github.identifiers,
      {
        appId: "42",
        appSlug: "paseo",
        clientId: "client",
      },
    );
  });

  it("refuses a changed environment-managed identity when restarting with existing connections", async () => {
    const fixture = createFixture();
    await fixture.store.save({
      provider: "github",
      configuration: githubConfiguration,
      identity: { provider: "github", id: "42", name: "Stored", ownerLogin: "acme" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
    });
    const failures = await activateProviderApplicationsAtStartup({
      store: fixture.store,
      environment: { github: { ...githubConfiguration, appId: "84", clientSecret: "rotated" } },
      runtime: fixture.runtime,
      verifier: {
        verify: () =>
          Promise.resolve({ provider: "github", id: "84", name: "Other", ownerLogin: "acme" }),
      },
      inventory: connectedInventory("42"),
      callbackOrigin: "https://hub.test",
    });

    assert.equal(failures[0]?.provider, "github");
    assert.equal(fixture.runtime.active("github"), undefined);
  });

  it("allows a same-identity environment secret rotation when restarting with connections", async () => {
    const fixture = createFixture();
    await fixture.store.save({
      provider: "github",
      configuration: githubConfiguration,
      identity: { provider: "github", id: "42", name: "Stored", ownerLogin: "acme" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
    });
    const failures = await activateProviderApplicationsAtStartup({
      store: fixture.store,
      environment: { github: { ...githubConfiguration, clientSecret: "rotated" } },
      runtime: fixture.runtime,
      verifier: {
        verify: () =>
          Promise.resolve({ provider: "github", id: "42", name: "Stored", ownerLogin: "acme" }),
      },
      inventory: connectedInventory("42"),
      callbackOrigin: "https://hub.test",
    });

    assert.deepEqual(failures, []);
    assert.equal(fixture.runtime.active("github")?.configurationId, "42");
  });

  it("persists and activates Slack only after the verified OAuth installation", async () => {
    const fixture = createFixture();

    const result = await fixture.applications.verifyAndSave(
      request("POST"),
      "slack",
      slackConfiguration,
    );

    assert.deepEqual(result, {
      status: "continuing",
      provider: "slack",
      url: "https://slack.test/install",
    });
    assert.equal(fixture.store.values.has("slack"), false);
    assert.equal(fixture.runtime.active("slack"), undefined);

    await fixture.runtime.completeSlack({
      configuration: slackConfiguration,
      expectedConfigurationVersion: undefined,
      callbackOrigin: "https://hub.test",
      userId: "operator",
      installation: {
        appId: "A1",
        teamId: "T1",
        teamName: "Acme",
        botUserId: "UBOT",
        botAccessToken: "token",
        scopes: ["chat:write"],
      },
      binding: slackBinding(),
    });

    assert.equal(fixture.store.values.get("slack")?.version, 1);
    assert.notEqual(fixture.runtime.active("slack"), undefined);
  });

  it("persists and activates Linear only after the verified OAuth installation", async () => {
    const fixture = createFixture();

    const result = await fixture.applications.verifyAndSave(
      request("POST"),
      "linear",
      linearConfiguration,
    );

    assert.deepEqual(result, {
      status: "continuing",
      provider: "linear",
      url: "https://slack.test/install",
    });
    assert.equal(fixture.store.values.has("linear"), false);
    assert.equal(fixture.runtime.active("linear"), undefined);

    await fixture.runtime.completeLinear({
      configuration: linearConfiguration,
      expectedConfigurationVersion: undefined,
      callbackOrigin: "https://hub.test",
      userId: "operator",
      installation: {
        linearOrganizationId: "linear-acme",
        linearOrganizationName: "Acme",
        appUserId: "linear-app-user",
        accessToken: "linear-token",
        refreshToken: "linear-refresh-token",
        accessTokenExpiresAt: null,
        scopes: ["read", "comments:create"],
      },
      binding: linearBinding(),
    });

    assert.equal(fixture.store.values.get("linear")?.version, 1);
    assert.notEqual(fixture.runtime.active("linear"), undefined);
  });

  it("requires HTTPS before starting a Linear configuration", async () => {
    const fixture = createFixture();

    await assert.rejects(
      fixture.applications.verifyAndSave(
        request("POST", "http://hub.test"),
        "linear",
        linearConfiguration,
      ),
      (error: unknown) =>
        error instanceof ProviderApplicationError &&
        error.code === "httpsRequired" &&
        error.safeContext === "http://hub.test",
    );

    assert.equal(fixture.store.reads, 0);
    assert.equal(fixture.runtime.prepareCount("linear"), 0);
  });

  it("requires HTTPS before starting an environment-managed Linear connection", async () => {
    const fixture = createFixture({ environment: { linear: linearConfiguration } });

    await assert.rejects(
      fixture.applications.beginConnection(request("POST", "http://hub.test"), "linear", "org"),
      (error: unknown) =>
        error instanceof ProviderApplicationError &&
        error.code === "httpsRequired" &&
        error.safeContext === "http://hub.test",
    );

    assert.equal(fixture.store.reads, 0);
    assert.equal(fixture.runtime.prepareCount("linear"), 0);
  });

  it("verifies and atomically publishes Socket Mode with its first workspace", async () => {
    const fixture = createFixture();

    const result = await fixture.applications.configureSlackSocket(request("POST"), {
      appToken: "xapp-secret",
      botToken: "xoxb-secret",
    });

    assert.deepEqual(result, {
      status: "verified",
      provider: "slack",
      identity: { provider: "slack", id: "A1", name: "A1" },
      configurationVersion: 1,
    });
    assert.deepEqual(fixture.store.values.get("slack")?.configuration, {
      provider: "slack",
      transport: "socket",
      appId: "A1",
      appToken: "xapp-secret",
    });
    assert.equal(fixture.store.socketOrganizationId, "org");
    assert.notEqual(fixture.runtime.active("slack"), undefined);
  });

  it("keeps Slack unconfigured when post-OAuth activation fails", async () => {
    const fixture = createFixture();
    await fixture.applications.verifyAndSave(request("POST"), "slack", slackConfiguration);
    fixture.runtime.failNextStart("slack");

    await assert.rejects(() =>
      fixture.runtime.completeSlack({
        configuration: slackConfiguration,
        expectedConfigurationVersion: undefined,
        callbackOrigin: "https://hub.test",
        userId: "operator",
        installation: {
          appId: "A1",
          teamId: "T1",
          teamName: "Acme",
          botUserId: "UBOT",
          botAccessToken: "token",
          scopes: ["chat:write"],
        },
        binding: slackBinding(),
      }),
    );
    assert.equal(fixture.store.values.has("slack"), false);
    assert.equal(fixture.runtime.active("slack"), undefined);
  });

  it("keeps the prior Slack store and runtime when the atomic bind transition fails", async () => {
    const fixture = createFixture();
    const oldConfiguration = { ...slackConfiguration, clientSecret: "old-secret" };
    await fixture.store.save({
      provider: "slack",
      configuration: oldConfiguration,
      identity: { provider: "slack", id: "A1", name: "Acme" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
    });
    assert.deepEqual(
      await activateProviderApplicationsAtStartup({
        store: fixture.store,
        environment: {},
        runtime: fixture.runtime,
        verifier: { verify: () => Promise.reject(new Error("unused")) },
        inventory: connectedInventory("A1"),
        callbackOrigin: "https://hub.test",
      }),
      [],
    );
    const oldRuntime = fixture.runtime.active("slack");
    fixture.store.failNextSlackCompletion();

    await assert.rejects(() =>
      fixture.runtime.completeSlack({
        configuration: { ...slackConfiguration, expectedVersion: 1 },
        expectedConfigurationVersion: 1,
        callbackOrigin: "https://hub.test",
        userId: "operator",
        installation: {
          appId: "A1",
          teamId: "T1",
          teamName: "Acme",
          botUserId: "UBOT",
          botAccessToken: "token",
          scopes: ["chat:write"],
        },
        binding: slackBinding(),
      }),
    );

    assert.equal(fixture.store.values.get("slack")?.configuration, oldConfiguration);
    assert.equal(fixture.runtime.active("slack"), oldRuntime);
    assert.equal(fixture.runtime.latestCandidate("slack")?.closeCount, 1);
  });

  it("closes an unusable Slack installation candidate exactly once", async () => {
    const fixture = createFixture();
    fixture.runtime.makeConnectionUnavailable("slack");

    await assert.rejects(
      fixture.applications.verifyAndSave(request("POST"), "slack", slackConfiguration),
      (error: unknown) => error instanceof ProviderApplicationError && error.code === "internal",
    );

    assert.equal(fixture.runtime.latestCandidate("slack")?.closeCount, 1);
  });

  it("sends a connection back to the surface it started from, and nowhere else", async () => {
    const fixture = createFixture();
    await fixture.applications.verifyAndSave(request("POST"), "github", githubConfiguration);

    await fixture.applications.beginConnection(request("POST"), "github", "org", "appSetup");
    await fixture.applications.beginConnection(request("POST"), "github", "org", "apps");
    await fixture.applications.beginConnection(request("POST"), "github", "org");

    assert.deepEqual(fixture.returnRoutes, ["/", "/apps", "/apps"]);
  });

  it("carries the surface through a Slack installation", async () => {
    const fixture = createFixture();

    const result = await fixture.applications.verifyAndSave(
      request("POST"),
      "slack",
      slackConfiguration,
      "appSetup",
    );

    assert.equal(result.status, "continuing");
    assert.deepEqual(fixture.returnRoutes, ["/"]);
  });

  it("resolves an unspecified surface to the durable one", () => {
    assert.equal(providerApplicationReturnRoute(undefined), "/apps");
    assert.equal(providerApplicationReturnRoute("appSetup"), "/");
    assert.equal(providerApplicationReturnRoute("apps"), "/apps");
  });
});

function request(method = "GET", origin = "https://hub.test") {
  return new Request(`${origin}/apps`, {
    method,
    headers: {
      cookie: "session=operator",
      origin,
      "x-paseo-trusted-request-origin": origin,
    },
  });
}

function createFixture(
  options: {
    operator?: boolean;
    connected?: boolean;
    connectionStatus?: "connected" | "actionNeeded";
    environment?: Partial<Record<Provider, ProviderApplicationConfiguration>>;
    rejectMutation?: boolean;
    eventEvidenceVersion?: number;
  } = {},
) {
  const store = new MemoryStore();
  const runtime = new BlockingRuntime();
  const returnRoutes: string[] = [];
  let verificationIdentity: ProviderApplicationIdentity = {
    provider: "github",
    id: "42",
    name: "Paseo",
    ownerLogin: "acme",
  };
  const applications = createProviderApplications({
    auth: {
      resolveAccount: () =>
        Promise.resolve({
          session: { id: "session", activeOrganizationId: "org" },
          account: { id: "operator", name: "Operator", email: "operator@hub.test" },
          isInstanceOperator: options.operator ?? true,
        } satisfies AccountAccessValue),
      rejectCookieMutation: () =>
        options.rejectMutation === true ? new Response("forbidden", { status: 403 }) : undefined,
    },
    store,
    environment: options.environment ?? {},
    runtime,
    verifier: {
      verify: (provider) => Promise.resolve(identityFor(provider, verificationIdentity)),
    },
    slackSocketVerifier: {
      verify: (_appToken, botToken) =>
        Promise.resolve({
          appId: "A1",
          teamId: "T1",
          teamName: "Acme",
          botId: "B1",
          botUserId: "U1",
          botAccessToken: botToken,
          scopes: ["app_mentions:read", "chat:write"],
        }),
    },
    inventory: {
      connectedIdentities: (provider) =>
        Promise.resolve(
          options.connected && provider === "github"
            ? [
                {
                  id: "connection",
                  name: "acme",
                  applicationId: "42",
                  status: options.connectionStatus ?? "connected",
                },
              ]
            : [],
        ),
      claimLegacyConnections: () => Promise.resolve(true),
      lastEventAt: (_provider, _identity?: ProviderApplicationIdentity, version?: number) =>
        Promise.resolve(
          version === options.eventEvidenceVersion ? new Date("2026-08-14T10:00:00Z") : null,
        ),
    },
    callbackOrigin: (incoming) =>
      Promise.resolve(incoming.headers.get("x-paseo-trusted-request-origin")!),
    beginCandidateConnection: (incoming, _organizationId, returnRoute, begin) => {
      returnRoutes.push(returnRoute);
      return begin(incoming);
    },
  });
  return {
    applications,
    store,
    runtime,
    returnRoutes,
    get verificationIdentity() {
      return verificationIdentity;
    },
    set verificationIdentity(identity: ProviderApplicationIdentity) {
      verificationIdentity = identity;
    },
  };
}

function identityFor(
  provider: Provider,
  github: ProviderApplicationIdentity,
): ProviderApplicationIdentity {
  if (provider === "github") return github;
  if (provider === "discord") return { provider, id: "100", name: "Paseo" };
  if (provider === "linear") return { provider, id: "linear-client", name: "Paseo" };
  return { provider, id: "A1", name: "Paseo" };
}

function connectedInventory(applicationId: string) {
  return {
    connectedIdentities: (provider: Provider) =>
      Promise.resolve(
        provider === "github"
          ? [
              {
                id: "connection",
                name: "acme",
                applicationId,
                status: "connected" as const,
              },
            ]
          : [],
      ),
    claimLegacyConnections: () => Promise.resolve(true),
    lastEventAt: () => Promise.resolve(null),
  };
}

class MemoryStore implements ProviderApplicationStore {
  readonly values = new Map<string, Awaited<ReturnType<ProviderApplicationStore["read"]>> & {}>();
  reads = 0;
  private failSlackCompletion = false;
  socketOrganizationId: string | undefined;

  failNextSlackCompletion() {
    this.failSlackCompletion = true;
  }

  read(provider: Provider) {
    this.reads += 1;
    return Promise.resolve(this.values.get(provider));
  }

  readAll() {
    this.reads += 1;
    return Promise.resolve([...this.values.values()].filter((value) => value !== undefined));
  }

  save(input: Parameters<ProviderApplicationStore["save"]>[0]) {
    const previous = this.values.get(input.provider);
    if (previous?.version !== input.expectedVersion) {
      const error = new Error("changed");
      error.name = "ProviderConfigurationConflictError";
      return Promise.reject(error);
    }
    const value = {
      ...input,
      version: (previous?.version ?? 0) + 1,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(input.provider, value);
    return Promise.resolve(value);
  }

  activate(_input: Parameters<ProviderApplicationStore["activate"]>[0]) {
    return Promise.resolve();
  }

  async completeSlackInstallation(
    input: Parameters<ProviderApplicationStore["completeSlackInstallation"]>[0],
  ) {
    if (this.failSlackCompletion) {
      this.failSlackCompletion = false;
      throw new Error("atomic bind failed");
    }
    await this.save({
      provider: "slack",
      configuration: input.configuration,
      identity: input.identity,
      expectedVersion: input.expectedVersion,
      updatedByUserId: input.updatedByUserId,
    });
  }

  async completeLinearInstallation(
    input: Parameters<ProviderApplicationStore["completeLinearInstallation"]>[0],
  ) {
    await this.save({
      provider: "linear",
      configuration: input.configuration,
      identity: input.identity,
      expectedVersion: input.expectedVersion,
      updatedByUserId: input.updatedByUserId,
    });
  }

  completeSlackSocketApplication(
    input: Parameters<ProviderApplicationStore["completeSlackSocketApplication"]>[0],
  ) {
    this.socketOrganizationId = input.organizationId;
    return this.save({
      provider: "slack",
      configuration: input.configuration,
      identity: input.identity,
      expectedVersion: input.expectedVersion,
      updatedByUserId: input.updatedByUserId,
    });
  }
}

class BlockingRuntime implements ProviderRuntimeOwner {
  private readonly candidates = new Map<string, Candidate[]>();
  private readonly activeCandidates = new Map<string, Candidate>();
  private readonly failures = new Set<string>();
  private readonly blocked = new Set<string>();
  private readonly unavailableConnections = new Set<string>();
  private slackInstallationHandler:
    | Parameters<NonNullable<ProviderRuntimeOwner["onSlackInstallation"]>>[0]
    | undefined;
  private linearInstallationHandler:
    | Parameters<NonNullable<ProviderRuntimeOwner["onLinearInstallation"]>>[0]
    | undefined;

  onSlackInstallation(
    handler: Parameters<NonNullable<ProviderRuntimeOwner["onSlackInstallation"]>>[0],
  ) {
    this.slackInstallationHandler = handler;
  }

  completeSlack(
    input: Parameters<Parameters<NonNullable<ProviderRuntimeOwner["onSlackInstallation"]>>[0]>[0],
  ) {
    if (this.slackInstallationHandler === undefined) throw new Error("handler unavailable");
    return this.slackInstallationHandler(input);
  }

  onLinearInstallation(
    handler: Parameters<NonNullable<ProviderRuntimeOwner["onLinearInstallation"]>>[0],
  ) {
    this.linearInstallationHandler = handler;
  }

  completeLinear(
    input: Parameters<Parameters<NonNullable<ProviderRuntimeOwner["onLinearInstallation"]>>[0]>[0],
  ) {
    if (this.linearInstallationHandler === undefined) throw new Error("handler unavailable");
    return this.linearInstallationHandler(input);
  }

  prepare(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
    _callbackOrigin: string,
    _identity: ProviderApplicationIdentity,
    configurationVersion: number,
  ): Promise<ProviderRuntimeCandidate> {
    const candidate = new Candidate(
      provider,
      this,
      candidateConfigurationId(configuration),
      configurationVersion,
    );
    const candidates = this.candidates.get(provider) ?? [];
    candidates.push(candidate);
    this.candidates.set(provider, candidates);
    return Promise.resolve(candidate);
  }

  prepareCount(provider: string) {
    return this.candidates.get(provider)?.length ?? 0;
  }

  active(provider: string) {
    return this.activeCandidates.get(provider);
  }

  latestCandidate(provider: string) {
    return this.candidates.get(provider)?.at(-1);
  }

  preparedConfigurationIds(provider: string) {
    return this.candidates.get(provider)?.map((candidate) => candidate.configurationId) ?? [];
  }

  preparedVersions(provider: string) {
    return this.candidates.get(provider)?.map((candidate) => candidate.configurationVersion) ?? [];
  }

  makeConnectionUnavailable(provider: string) {
    this.unavailableConnections.add(provider);
  }

  connectionUnavailable(provider: string) {
    return this.unavailableConnections.has(provider);
  }

  failNextStart(provider: string) {
    this.failures.add(provider);
  }

  block(provider: string) {
    this.blocked.add(provider);
  }

  shouldBlock(provider: string) {
    return this.blocked.has(provider);
  }

  shouldFail(provider: string) {
    return this.failures.delete(provider);
  }

  publish(candidate: Candidate) {
    this.activeCandidates.set(candidate.provider, candidate);
  }

  release(provider: string) {
    this.candidates.get(provider)?.at(-1)?.release();
  }

  async waitUntilPrepared(provider: string, count = 1) {
    while (this.prepareCount(provider) < count)
      await new Promise((resolve) => setImmediate(resolve));
  }
}

class Candidate implements ProviderRuntimeCandidate {
  private unblock: (() => void) | undefined;
  private released = false;
  readonly beginConnection?: () => Promise<{ url: string }>;
  closeCount = 0;

  constructor(
    readonly provider: Provider,
    private readonly owner: BlockingRuntime,
    readonly configurationId: string,
    readonly configurationVersion: number,
  ) {
    if (!owner.connectionUnavailable(provider)) {
      this.beginConnection = () => Promise.resolve({ url: "https://slack.test/install" });
    }
  }

  async start() {
    if (this.owner.shouldFail(this.provider)) throw new Error("candidate failed");
    if (!this.owner.shouldBlock(this.provider)) return;
    await new Promise<void>((resolve) => {
      if (this.released) {
        resolve();
        return;
      }
      this.unblock = resolve;
    });
  }

  publish() {
    this.owner.publish(this);
  }

  close() {
    this.closeCount += 1;
    return Promise.resolve();
  }

  release() {
    this.released = true;
    this.unblock?.();
  }
}

function candidateConfigurationId(configuration: ProviderApplicationConfiguration): string {
  if (configuration.provider === "github" || configuration.provider === "slack") {
    return configuration.appId;
  }
  if (configuration.provider === "linear") return configuration.clientId;
  return configuration.applicationId;
}

function slackBinding() {
  return {
    providerApplicationId: "A1",
    stateVerifier: "state",
    phase: "slack_authorization" as const,
    access: { sessionId: "session", userId: "operator" },
    teamId: "T1",
    teamName: "Acme",
    botUserId: "UBOT",
    botAccessToken: "token",
    scopes: ["chat:write"],
  };
}

function linearBinding() {
  return {
    providerApplicationId: "linear-client",
    stateVerifier: "state",
    phase: "linear_authorization" as const,
    access: { sessionId: "session", userId: "operator" },
    linearOrganizationId: "linear-acme",
    linearOrganizationName: "Acme",
    appUserId: "linear-app-user",
    accessToken: "linear-token",
    refreshToken: "linear-refresh-token",
    accessTokenExpiresAt: null,
    scopes: ["read", "comments:create"],
  };
}
