import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "vitest";
import type { AuthServer } from "../../auth/server.js";
import type { OrganizationAccessValue } from "../../auth/organization-access.js";
import { createMemoryDatabase } from "../../db/memory.js";
import {
  createActiveProjectConfiguration,
  enrollTestDaemon,
  TEST_DAEMON_SLUG,
} from "../../test-utils/project-configuration.js";
import type { ProjectRecord, StartConnectionAttemptInput } from "../../db/types.js";
import type { GitHubConnectionClient } from "./client.js";
import { createGitHubRegistration } from "./index.js";
import type { GitHubConfigurationProvider } from "../../configuration/github-sync.js";
import { configurationBundleFixture } from "../../test-utils/configuration-bundle.js";

describe("GitHub registration", () => {
  it("synchronizes the default branch at the exact push SHA and preserves the valid revision", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database);
    const {
      project,
      revision: initial,
      store,
    } = await createActiveProjectConfiguration(database, {
      environments: [{ name: "runner", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
      triggers: [],
    });
    await database.setProjectGitHubConfigurationSource({
      projectId: project.id,
      githubConnectionId: "connection-1",
      githubRepositoryId: 9001,
      githubRepositoryFullName: "acme/app",
      githubDefaultBranch: "main",
      automaticDeploymentEnabled: true,
      userId: "user",
    });
    database.findGitHubConnection = () =>
      Promise.resolve({
        id: "connection-1",
        organizationId: project.organizationId,
        slug: "connection-1",
        installationId: 42,
        accountId: "account-42",
        accountLogin: "acme",
        accountType: "Organization",
        status: "active" as const,
        providerApplicationId: "42",
      });
    const target = {
      id: "repository-catalog-1",
      organizationId: project.organizationId,
      projectId: project.id,
      connectionId: "connection-1",
      installationId: 42,
      repositoryId: 9001,
      fullName: "acme/app",
      defaultBranch: "main",
      automaticDeploymentEnabled: true,
    } as const;
    database.findGitHubConfigurationTarget = () => Promise.resolve(target);
    database.listGitHubConfigurationTargets = () => Promise.resolve([target]);
    database.acceptGitHubEvent = (input) =>
      Promise.resolve({
        status: "accepted",
        events: [
          {
            providerEventReceiptId: `trigger-${input.deliveryId}`,
            organizationId: project.organizationId,
            projectId: project.id,
            configurationRevisionId: "11111111-1111-4111-8111-111111111130",
            deliveryId: input.deliveryId,
            source: input.source,
            payload: input.payload,
            receivedAt: input.receivedAt,
            connectionId: "connection-1",
            resourceId: input.repositoryId === undefined ? null : String(input.repositoryId),
          },
        ],
        receiptId: `receipt-${input.deliveryId}`,
      });
    const configuration = new RegistrationConfigurationFake({
      "valid-sha": `environments:\n  - name: runner\n    kind: daemon\n    daemon: ${TEST_DAEMON_SLUG}\n    cwd: /repo\ntriggers:\n  - name: noop\n    on: manual.run\n    max_runtime: 1h\n    steps:\n      - id: work\n        environment: runner\n        max_runtime: 10m\n        idle_timeout: 1m\n        agent: { provider: test }\n        prompt: [{ text: noop }]`,
      "invalid-sha": "environments: []\ntriggers: invalid",
    });
    const registration = createGitHubRegistration({
      database,
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: githubConfiguration(),
      appAuth: githubAuth(),
      connectionClient: new GitHubClientFake(),
      configurationProvider: configuration,
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });
    registration.triggerProviders[0]?.({
      configurationStoreForProject: () => store,
      connectionsForProject: () => async () => "unused",
    });

    await configuration.push(registration, "valid-sha", "push-valid");
    const active = await database.findActiveProjectConfiguration(project.id);
    assert.notEqual(active?.id, initial.id);
    await configuration.push(registration, "invalid-sha", "push-invalid");
    assert.equal((await database.findActiveProjectConfiguration(project.id))?.id, active?.id);
    assert.deepEqual(configuration.reads, [
      { installationId: 42, repositoryId: 9001, commitSha: "valid-sha", path: ".paseo/hub.yml" },
      {
        installationId: 42,
        repositoryId: 9001,
        commitSha: "valid-sha",
        path: ".paseo/workflows/noop.yml",
      },
      { installationId: 42, repositoryId: 9001, commitSha: "invalid-sha", path: ".paseo/hub.yml" },
    ]);
    assert.equal(
      (await database.projectConfigurationReadModel(project.id)).lastSyncAttempt?.outcome,
      "invalid",
    );
  });

  it("constructs the complete GitHub slice and delegates connection start", async () => {
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
    let attempt: StartConnectionAttemptInput | undefined;
    database.startConnectionAttempt = (input) => {
      attempt = input;
      return Promise.resolve();
    };
    const registration = createGitHubRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: {
        appId: "42",
        appSlug: "paseo",
        clientId: "client",
        clientSecret: "secret",
        webhookSecret: "webhook-secret",
        privateKey: "test-private-key",
      },
      appAuth: {
        getInstallation: () => Promise.resolve(undefined),
        getInstallationToken: () => Promise.resolve("token"),
        mintInstallationToken: () => Promise.resolve("token"),
        mintInstallationAccessToken: () =>
          Promise.resolve({ token: "scoped-token", expiresAt: Date.now() + 3_600_000 }),
        getAppBotIdentity: () => Promise.resolve({ id: 123, login: "paseo[bot]" }),
        revokeInstallationToken: () => Promise.resolve(),
        createInstallationOctokit: () => Promise.reject(new Error("unused")),
      },
      connectionClient: new GitHubClientFake(),
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });

    assert.equal(registration.connection.name, "github");
    assert.equal(registration.sources.length, 1);
    assert.equal(registration.triggerProviders.length, 1);
    assert.deepEqual(
      registration.outputs.map((output) => output.type),
      ["github.reply"],
    );
    assert.deepEqual(
      registration.requests.map((request) => request.name),
      ["webhook"],
    );

    const response = await registration.connection.actions["start"]!(
      new Request("https://hub.test/start?organizationSlug=org", { method: "POST" }),
    );
    assert.equal(response.status, 200);
    assert.equal(attempt?.provider, "github");
    const body: unknown = await response.json();
    assert(body !== null && typeof body === "object" && "url" in body);
    assert(typeof body.url === "string");
    assert.match(body.url, /^https:\/\/github\.test\/setup/u);
  });

  it("reports readiness without constructing partial provider behavior", () => {
    const registration = createGitHubRegistration({
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
  });

  it("resolves the project's active GitHub installation token", async () => {
    const database = createMemoryDatabase();
    database.findProjectById = async (projectId) =>
      testProject(projectId, projectId === "project-1" ? "org_1" : "org_2");
    database.organizationConnectionUsage = async (_organizationId) => ({
      github: [
        {
          id: "github-connection",
          organizationId: "org_1",
          slug: "getpaseo-github",
          installationId: 142,
          accountId: "501",
          accountLogin: "getpaseo",
          accountType: "Organization",
          status: "active",
          providerApplicationId: "42",
        },
      ],
      discord: [],
      slack: [],
      linear: [],
    });
    const installations: number[] = [];
    const registration = createGitHubRegistration({
      database,
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: githubConfiguration(),
      appAuth: {
        getInstallation: () => Promise.resolve(undefined),
        getInstallationToken: () => Promise.reject(new Error("unused")),
        mintInstallationToken: (installationId) => {
          installations.push(installationId);
          return Promise.resolve("test-installation-token");
        },
        mintInstallationAccessToken: () =>
          Promise.resolve({ token: "scoped-token", expiresAt: Date.now() + 3_600_000 }),
        getAppBotIdentity: () => Promise.resolve({ id: 123, login: "paseo[bot]" }),
        revokeInstallationToken: () => Promise.resolve(),
        createInstallationOctokit: () => Promise.reject(new Error("unused")),
      },
      connectionClient: new GitHubClientFake(),
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });

    assert.equal(
      await registration.integration?.resolve("project-1", "getpaseo-github", "token"),
      "test-installation-token",
    );
    assert.deepEqual(installations, [142]);
    await assert.rejects(
      () => registration.integration!.resolve("project-2", "getpaseo-github", "token"),
      /connection is unavailable/u,
    );
  });

  it("mints and revokes explicit scoped authority only for the project's active organization connection", async () => {
    const database = createMemoryDatabase();
    database.findProjectById = async (projectId) =>
      testProject(projectId, projectId === "project-1" ? "org_1" : "org_2");
    database.organizationConnectionUsage = async (_organizationId) => ({
      github: [
        {
          id: "github-connection",
          organizationId: "org_1",
          slug: "getpaseo-github",
          installationId: 142,
          accountId: "501",
          accountLogin: "getpaseo",
          accountType: "Organization",
          status: "active",
          providerApplicationId: "42",
        },
      ],
      discord: [],
      slack: [],
      linear: [],
    });
    const requests: unknown[] = [];
    const revoked: string[] = [];
    const identityTokens: string[] = [];
    let identityLookups = 0;
    let identityFailure: Error | undefined;
    const registration = createGitHubRegistration({
      database,
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: githubConfiguration(),
      appAuth: {
        getInstallation: () => Promise.resolve(undefined),
        getInstallationToken: () => Promise.resolve("token"),
        mintInstallationToken: () => Promise.resolve("token"),
        mintInstallationAccessToken: (input) => {
          requests.push(input);
          return Promise.resolve({ token: "scoped-token", expiresAt: Date.now() + 3_600_000 });
        },
        getAppBotIdentity: (_appSlug, token) => {
          identityLookups += 1;
          identityTokens.push(token);
          if (identityFailure !== undefined) return Promise.reject(identityFailure);
          return Promise.resolve({ id: 123, login: "paseo[bot]" });
        },
        revokeInstallationToken: (token) => {
          revoked.push(token);
          return Promise.resolve();
        },
        createInstallationOctokit: () => Promise.reject(new Error("unused")),
      },
      connectionClient: new GitHubClientFake(),
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });

    const authority = registration.integration?.githubAuthority;
    assert.ok(authority);
    const minted = await authority.mint({
      projectId: "project-1",
      connectionSlug: "getpaseo-github",
      repositories: ["getpaseo/paseo", "getpaseo/hub"],
      permissions: { contents: "write", pull_requests: "read" },
    });
    assert.deepEqual(requests, [
      {
        installationId: 142,
        accountLogin: "getpaseo",
        repositories: ["getpaseo/paseo", "getpaseo/hub"],
        permissions: { contents: "write", pull_requests: "read" },
      },
    ]);
    assert.deepEqual(minted, {
      token: "scoped-token",
      expiresAt: minted.expiresAt,
      botUserId: 123,
      botLogin: "paseo[bot]",
    });
    assert.equal(identityLookups, 1);
    assert.deepEqual(identityTokens, ["scoped-token"]);

    await assert.rejects(
      () =>
        authority.mint({
          projectId: "project-1",
          connectionSlug: "getpaseo-github",
          repositories: ["other-owner/paseo"],
          permissions: { contents: "read" },
        }),
      /repository owner.*other-owner.*getpaseo/iu,
    );
    assert.equal(requests.length, 1);
    assert.equal(identityLookups, 1);

    const caseInsensitive = await authority.mint({
      projectId: "project-1",
      connectionSlug: "getpaseo-github",
      repositories: ["GETPASEO/private"],
      permissions: { contents: "read" },
    });
    assert.deepEqual(requests[1], {
      installationId: 142,
      accountLogin: "getpaseo",
      repositories: ["GETPASEO/private"],
      permissions: { contents: "read" },
    });

    identityFailure = new Error("identity unavailable");
    await assert.rejects(
      () =>
        authority.mint({
          projectId: "project-1",
          connectionSlug: "getpaseo-github",
          repositories: ["getpaseo/hub"],
          permissions: { contents: "read" },
        }),
      /identity unavailable/u,
    );
    assert.deepEqual(revoked, ["scoped-token"]);

    await authority.revoke(minted.token);
    await authority.revoke(caseInsensitive.token);
    assert.deepEqual(revoked, ["scoped-token", "scoped-token", "scoped-token"]);
    await assert.rejects(
      () =>
        authority.mint({
          projectId: "project-2",
          connectionSlug: "getpaseo-github",
          repositories: ["getpaseo/paseo"],
          permissions: { contents: "read" },
        }),
      /connection is unavailable/u,
    );
  });

  it("keeps provider runtime active without browser authentication", async () => {
    const registration = createGitHubRegistration({
      database: createMemoryDatabase(),
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: githubConfiguration(),
      appAuth: githubAuth(),
      connectionClient: new GitHubClientFake(),
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });

    assert.equal(registration.sources.length, 1);
    assert.equal(registration.triggerProviders.length, 1);
    assert.deepEqual(
      registration.outputs.map((output) => output.type),
      ["github.reply"],
    );
    assert.deepEqual(registration.connection.actions, {});
  });

  it("keeps signature verification available while the database is unavailable", async () => {
    const registration = createGitHubRegistration({
      database: null,
      auth: null,
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: githubConfiguration(),
    });

    const response = await registration.requests[0]!.handle(
      signedWebhookRequest("database-unavailable"),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "database_unavailable" });
  });

  it("claims lifecycle replay before provider I/O and applies verified evidence afterward", async () => {
    const database = createMemoryDatabase();
    const order: string[] = [];
    database.claimGitHubLifecycleReceipt = (input) => {
      order.push(`claim:${input.deliveryId}`);
      return Promise.resolve({
        status: "claimed",
        providerEventReceiptId: "lifecycle-trigger",
        installationId: 42,
      });
    };
    database.applyGitHubLifecycle = (_claim, result) => {
      order.push(`apply:${result.status}`);
      return Promise.resolve();
    };
    const client = new GitHubClientFake();
    client.getInstallation = () => {
      order.push("verify");
      return Promise.resolve({
        status: "present" as const,
        identity: {
          installationId: 42,
          accountId: "account-42",
          accountLogin: "acme",
          accountType: "Organization",
          status: "suspended" as const,
        },
      });
    };
    const registration = createGitHubRegistration({
      database,
      auth: new RegistrationAuth(),
      applicationBaseUrl: "https://hub.test",
      publicBaseUrl: "https://hub.test",
      configuration: {
        appId: "42",
        appSlug: "paseo",
        clientId: "client",
        clientSecret: "secret",
        webhookSecret: "webhook-secret",
        privateKey: "test-private-key",
      },
      appAuth: {
        getInstallation: () => Promise.resolve(undefined),
        getInstallationToken: () => Promise.resolve("token"),
        mintInstallationToken: () => Promise.resolve("token"),
        mintInstallationAccessToken: () =>
          Promise.resolve({ token: "scoped-token", expiresAt: Date.now() + 3_600_000 }),
        getAppBotIdentity: () => Promise.resolve({ id: 123, login: "paseo[bot]" }),
        revokeInstallationToken: () => Promise.resolve(),
        createInstallationOctokit: () => Promise.reject(new Error("unused")),
      },
      connectionClient: client,
      reactionClient: {
        createReaction: () => Promise.resolve({ id: 1 }),
        deleteReaction: () => Promise.resolve(),
      },
    });
    const body = JSON.stringify({ action: "suspend", installation: { id: 42 } });
    const signature = "sha256=" + createHmac("sha256", "webhook-secret").update(body).digest("hex");
    const response = await registration.requests[0]!.handle(
      new Request("https://hub.test/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "lifecycle-1",
          "x-github-event": "installation",
          "x-hub-signature-256": signature,
        },
        body,
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(order, ["claim:lifecycle-1", "verify", "apply:present"]);
  });
});

class RegistrationConfigurationFake implements GitHubConfigurationProvider {
  readonly reads: Array<{ repositoryId: number; commitSha: string; path: string }> = [];
  private head = "";
  constructor(private readonly files: Readonly<Record<string, string>>) {}
  listInstallationRepositories() {
    return Promise.resolve([]);
  }
  readDefaultBranchHead() {
    return Promise.resolve(this.head);
  }
  listFilesAtCommit(input: { commitSha: string }) {
    const yaml = this.files[input.commitSha];
    if (yaml === undefined) return Promise.resolve([]);
    try {
      return Promise.resolve(
        configurationBundleFixture(yaml).map(({ path }) => ({ path, kind: "file" as const })),
      );
    } catch {
      return Promise.resolve([{ path: ".paseo/hub.yml", kind: "file" as const }]);
    }
  }
  readFileAtCommit(input: { repositoryId: number; commitSha: string; path: string }) {
    this.reads.push(input);
    const rawYaml = this.files[input.commitSha];
    let content: string | undefined;
    if (rawYaml !== undefined) {
      try {
        content = configurationBundleFixture(rawYaml).find(
          ({ path }) => path === input.path,
        )?.content;
      } catch {
        content = input.path === ".paseo/hub.yml" ? rawYaml : undefined;
      }
    }
    return Promise.resolve(content === undefined ? undefined : { kind: "file" as const, content });
  }
  async push(
    registration: ReturnType<typeof createGitHubRegistration>,
    sha: string,
    deliveryId: string,
  ) {
    this.head = sha;
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: sha,
      repository: { id: 9001, full_name: "acme/app" },
      installation: { id: 42 },
      commits: [],
    });
    const signature = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
    const response = await registration.requests[0]!.handle(
      new Request("https://hub.test/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": deliveryId,
          "x-github-event": "push",
          "x-hub-signature-256": signature,
        },
        body,
      }),
    );
    assert.equal(response.status, 200);
  }
}

class GitHubClientFake implements GitHubConnectionClient {
  setupUrl(state: string): string {
    return `https://github.test/setup?state=${state}`;
  }
  authorizationUrl({ state }: { state: string; challenge: string }): string {
    return `https://github.test/authorize?state=${state}`;
  }
  verifyUserInstallation() {
    return Promise.resolve(undefined);
  }
  getInstallation(): ReturnType<GitHubConnectionClient["getInstallation"]> {
    return Promise.resolve({ status: "absent" as const });
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

function githubConfiguration() {
  return {
    appId: "42",
    appSlug: "paseo",
    clientId: "client",
    clientSecret: "secret",
    webhookSecret: "webhook-secret",
    privateKey: "test-private-key",
  };
}

function testProject(id: string, organizationId: string): ProjectRecord {
  const now = new Date(0);
  return {
    id,
    organizationId,
    name: "Test project",
    slug: "test-project",
    status: "active",
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    activeConfigurationRevisionId: null,
  };
}

function githubAuth() {
  return {
    getInstallation: () => Promise.resolve(undefined),
    getInstallationToken: () => Promise.resolve("token"),
    mintInstallationToken: () => Promise.resolve("token"),
    mintInstallationAccessToken: () =>
      Promise.resolve({ token: "scoped-token", expiresAt: Date.now() + 3_600_000 }),
    getAppBotIdentity: () => Promise.resolve({ id: 123, login: "paseo[bot]" }),
    revokeInstallationToken: () => Promise.resolve(),
    createInstallationOctokit: () => Promise.reject(new Error("unused")),
  };
}

function signedWebhookRequest(deliveryId: string): Request {
  const body = JSON.stringify({ installation: { id: 42 }, repository: { full_name: "acme/app" } });
  const signature = "sha256=" + createHmac("sha256", "webhook-secret").update(body).digest("hex");
  return new Request("https://hub.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": "issue_comment",
      "x-hub-signature-256": signature,
    },
    body,
  });
}
