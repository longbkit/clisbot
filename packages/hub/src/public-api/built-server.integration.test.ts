import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { createApplicationRuntime } from "../application-runtime.js";
import { createAuthServer, type AuthServer } from "../auth/server.js";
import { composeEntitlements } from "../auth/entitlements.js";
import { CliAuthorizations } from "../cli-authorizations/index.js";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import { TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";
import { configurationBundleFixture } from "../test-utils/configuration-bundle.js";
import {
  EnrollmentTokenSchema,
  CliAuthorizationPollSchema,
  CliAuthorizationSchema,
  ConfigurationResourcesSchema,
  SetupResourcesSchema,
  InstalledConfigurationSchema,
  ProblemSchema,
  ProjectListSchema,
  ValidatedConfigurationSchema,
} from "./contracts.js";
import { loadBuiltStartServer, type BuiltStartServer } from "../server/build.js";

const builtServerTests = describe.runIf(process.env["RUN_BUILT_PUBLIC_API_TESTS"] === "1");

builtServerTests("built TanStack public API PostgreSQL contract", () => {
  let postgres: StartedPostgreSqlContainer;
  let auth: AuthServer;
  let built: BuiltStartServer;
  let databaseUrl: string;
  let secrets: Record<"organization-a" | "organization-b", string>;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = postgres.getConnectionUri();
    const database = await createDatabase(databaseUrl);
    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query(`
      insert into organization (id, name, slug) values
        ('organization-a', 'Organization A', 'organization-a'),
        ('organization-b', 'Organization B', 'organization-b');
      insert into "user" (id, name, email, email_verified) values
        ('user-a', 'Owner A', 'owner-a@example.test', true),
        ('user-b', 'Owner B', 'owner-b@example.test', true);
      insert into member (id, organization_id, user_id, role) values
        ('member-a', 'organization-a', 'user-a', 'owner'),
        ('member-b', 'organization-b', 'user-b', 'owner');
      insert into session (id, token, user_id, active_organization_id, expires_at) values
        ('session-a', 'session-token-a', 'user-a', 'organization-a', now() + interval '1 day');
      insert into github_connections
        (id, organization_id, installation_id, slug, account_id, account_login, account_type, status)
      values
        ('10000000-0000-4000-8000-000000000001', 'organization-a', 101, 'github-a', 'account-a', 'octocat-a', 'User', 'active'),
        ('10000000-0000-4000-8000-000000000002', 'organization-b', 102, 'github-b', 'account-b', 'octocat-b', 'Organization', 'active');
      insert into github_repositories
        (organization_id, connection_id, repository_id, full_name, default_branch)
      values
        ('organization-a', '10000000-0000-4000-8000-000000000001', 1001, 'octocat-a/starter', 'main'),
        ('organization-b', '10000000-0000-4000-8000-000000000002', 1002, 'octocat-b/starter', 'main');
      insert into discord_connections (organization_id, guild_id, slug, guild_name) values
        ('organization-a', 'guild-a', 'discord-a', 'Discord A'),
        ('organization-b', 'guild-b', 'discord-b', 'Discord B');
      insert into slack_connections
        (organization_id, team_id, slug, team_name, bot_user_id, bot_access_token, scopes)
      values
        ('organization-a', 'team-a', 'slack-a', 'Slack A', 'bot-a', 'token-a', '[]'::jsonb),
        ('organization-b', 'team-b', 'slack-b', 'Slack B', 'bot-b', 'token-b', '[]'::jsonb);
    `);
    await client.close();
    for (const [organizationId, userId] of [
      ["organization-a", "user-a"],
      ["organization-b", "user-b"],
    ] as const) {
      await database.createProject({
        organizationId,
        name: "Shared slug",
        slug: "same-project",
        createdByUserId: userId,
      });
      await database.createProject({
        organizationId,
        name: "Bundle project",
        slug: "bundle-project",
        createdByUserId: userId,
      });
      const daemonId =
        organizationId === "organization-a"
          ? "10000000-0000-4000-8000-000000000001"
          : "10000000-0000-4000-8000-000000000002";
      const tokenVerifier = `built-token-${organizationId}`;
      await database.issueEnrollmentToken({
        id: randomUUID(),
        verifier: tokenVerifier,
        organizationId,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        consumedAt: null,
      });
      await database.enrollDaemon({
        tokenVerifier,
        daemonId,
        idempotencyKey: `built-daemon-${organizationId}`,
        serverId: "built-test-server",
        daemonPublicKey: `built-public-key-${organizationId}`,
        credentialVerifier: `built-credential-${organizationId}`,
        scopes: ["hub.execution.*"],
        now: new Date("2026-08-07T00:00:00.000Z"),
      });
    }
    const entitlements = composeEntitlements(database, testDatabaseRuntime(database));
    auth = createAuthServer({
      database: testDatabaseRuntime(database),
      locks: testDatabaseLocks(database),
      entitlements: entitlements.service,
      secret: "built-public-api-test-secret".padEnd(32, "-"),
      baseURL: "http://hub.test",
      policy: {
        registrationMode: "open",
        organizationCreation: "disabled",
        bootstrap: undefined,
      },
    });
    const keyB = await auth.apiKeys!.create("organization-b", "user-b", "built B", [
      "projects:read",
      "configuration:validate",
      "configuration:install",
      "runs:dispatch",
      "daemons:enroll",
    ]);
    const cliAuthorizations = new CliAuthorizations(database, {
      resolveOrganizationAccess: () =>
        Promise.resolve({
          session: { id: "session-a" },
          account: { id: "user-a", name: "Owner A", email: "owner-a@example.test" },
          organization: { id: "organization-a", name: "Organization A", slug: "organization-a" },
          membership: { id: "member-a", role: "owner" as const },
          capabilities: {
            view: true as const,
            manageResources: true,
            manageMembers: true,
            manageOwners: true,
          },
        }),
      resolveAccount: () => Promise.reject(new Error("unused")),
      rejectCookieMutation: () => undefined,
    });
    const cliAuthorization = CliAuthorizationSchema.parse(
      await (await cliAuthorizations.start(jsonRequest("/api/v1/cli-authorizations", {}))).json(),
    );
    assert.equal(
      (
        await cliAuthorizations.decide(
          jsonRequest("/cli-authorizations/decision", {
            userCode: cliAuthorization.userCode,
            decision: "approve",
            organizationId: "organization-a",
          }),
        )
      ).status,
      200,
    );
    const pollClient = await createPostgresQueryRuntime(databaseUrl);

    await pollClient.query("update cli_authorizations set next_poll_at = now()");
    await pollClient.close();
    const cliPoll = CliAuthorizationPollSchema.parse(
      await (
        await cliAuthorizations.poll(
          jsonRequest("/api/v1/cli-authorizations/poll", {
            deviceCode: cliAuthorization.deviceCode,
          }),
        )
      ).json(),
    );
    assert.equal(cliPoll.status, "authorized");
    if (cliPoll.status !== "authorized") throw new Error("CLI login did not issue a credential");
    secrets = { "organization-a": cliPoll.credential, "organization-b": keyB.secret };
    const runtime = await createApplicationRuntime({
      database,
      auth,
      entitlements: entitlements.service,
      billing: null,
      async close() {
        await auth.close();
        await entitlements.close();
        await database.close();
      },
    });
    await runtime.hub.start();
    built = await loadBuiltStartServer();
    await built.startApplication(() => runtime);
  }, 120_000);

  afterAll(async () => {
    await built?.stopProductionRuntime();
    await postgres?.stop();
  }, 120_000);

  it("covers every canonical operation with isolated colliding tenants and persisted effects", async () => {
    for (const organizationId of ["organization-a", "organization-b"] as const) {
      const projects = await get("/api/v1/projects", secrets[organizationId]);
      assert.equal(projects.status, 200);
      assert.deepEqual(
        ProjectListSchema.parse(await projects.json()).projects.map(({ slug }) => slug),
        ["bundle-project", "same-project"],
      );
      const resources = await get("/api/v1/configuration-resources", secrets[organizationId]);
      assert.equal(resources.status, 200);
      const configurationResources = ConfigurationResourcesSchema.parse(await resources.json());
      assert.equal(configurationResources.daemons.length, 1);
      assert.deepEqual(configurationResources.github, [
        {
          slug: `github-${organizationId.at(-1)}`,
          accountLogin: `octocat-${organizationId.at(-1)}`,
          accountType: organizationId === "organization-a" ? "User" : "Organization",
          repositories: [`octocat-${organizationId.at(-1)}/starter`],
        },
      ]);
      assert.deepEqual(configurationResources.discord, [
        {
          slug: `discord-${organizationId.at(-1)}`,
          guildName: `Discord ${organizationId.at(-1)?.toUpperCase()}`,
        },
      ]);
      assert.deepEqual(configurationResources.slack, [
        {
          slug: `slack-${organizationId.at(-1)}`,
          teamName: `Slack ${organizationId.at(-1)?.toUpperCase()}`,
        },
      ]);
      const setupResources = await get("/api/v1/setup-resources", secrets[organizationId]);
      assert.equal(setupResources.status, 200);
      assert.deepEqual(SetupResourcesSchema.parse(await setupResources.json()), {
        github: [
          {
            slug: `github-${organizationId.at(-1)}`,
            accountLogin: `octocat-${organizationId.at(-1)}`,
            accountType: organizationId === "organization-a" ? "User" : "Organization",
            repositories: [`octocat-${organizationId.at(-1)}/starter`],
          },
        ],
        discord: [
          {
            guildId: `guild-${organizationId.at(-1)}`,
            guildName: `Discord ${organizationId.at(-1)?.toUpperCase()}`,
          },
        ],
        slack: [
          {
            teamId: `team-${organizationId.at(-1)}`,
            teamName: `Slack ${organizationId.at(-1)?.toUpperCase()}`,
          },
        ],
      });
      const validation = await post("/api/v1/configurations/validate", secrets[organizationId], {
        projectSlug: "same-project",
        files: configurationBundleFixture(validPublicApiConfiguration()),
      });
      assert.equal(validation.status, 200, await validation.clone().text());
      ValidatedConfigurationSchema.parse(await validation.json());
      const install = await post("/api/v1/configurations/install", secrets[organizationId], {
        projectSlug: "same-project",
        files: configurationBundleFixture(validPublicApiConfiguration()),
      });
      assert.equal(install.status, 201);
      const installed = InstalledConfigurationSchema.parse(await install.json());
      assert.equal(installed.projectSlug, "same-project");
      assert.match(installed.versionId, /^[0-9a-f-]{36}$/u);

      const manualBody = {
        projectSlug: "same-project",
        trigger: "not-configured",
        actor: "automation",
        deliveryKey: "shared-delivery-key",
        input: { organizationId },
      };
      const first = await post("/api/v1/manual-runs", secrets[organizationId], manualBody);
      assert.equal(first.status, 404);
      assert.equal(ProblemSchema.parse(await first.json()).code, "trigger_not_found");
      const duplicate = await post("/api/v1/manual-runs", secrets[organizationId], manualBody);
      assert.equal(duplicate.status, 404);
      assert.equal(ProblemSchema.parse(await duplicate.json()).code, "trigger_not_found");

      const enrollment = await post("/api/v1/daemons/enrollment-tokens", secrets[organizationId]);
      assert.equal(enrollment.status, 201);
      assert.equal(typeof EnrollmentTokenSchema.parse(await enrollment.json()).token, "string");
    }

    const client = await createPostgresQueryRuntime(databaseUrl);

    const revisions = await client.query<{ organization_id: string; project_slug: string }>(`
      select revision.organization_id, project.slug as project_slug
      from project_configuration_revisions revision
      join projects project on project.id = revision.project_id
      order by revision.organization_id
    `);
    const receipts = await client.query<{
      organization_id: string;
      project_organization_id: string;
      public_delivery_key: string;
    }>(`
      select receipt.organization_id, project.organization_id as project_organization_id,
             receipt.payload->>'publicDeliveryKey' as public_delivery_key
      from provider_event_receipts receipt
      join projects project on project.id = (receipt.accepted_routes->0->>'projectId')::uuid
      where receipt.provider = 'manual'
        and receipt.payload->>'publicDeliveryKey' = 'shared-delivery-key'
      order by receipt.organization_id
    `);
    const enrollments = await client.query<{ organization_id: string; count: string }>(`
      select organization_id, count(*)::text as count
      from daemon_enrollment_tokens group by organization_id order by organization_id
    `);
    await client.close();
    assert.deepEqual(revisions.rows, [
      { organization_id: "organization-a", project_slug: "same-project" },
      { organization_id: "organization-b", project_slug: "same-project" },
    ]);
    assert.deepEqual(receipts.rows, [
      {
        organization_id: "organization-a",
        project_organization_id: "organization-a",
        public_delivery_key: "shared-delivery-key",
      },
      {
        organization_id: "organization-b",
        project_organization_id: "organization-b",
        public_delivery_key: "shared-delivery-key",
      },
    ]);
    assert.deepEqual(enrollments.rows, [
      { organization_id: "organization-a", count: "2" },
      { organization_id: "organization-b", count: "2" },
    ]);
  }, 120_000);

  it("contains unexpected PostgreSQL details behind the canonical internal-error boundary", async () => {
    const client = await createPostgresQueryRuntime(databaseUrl);

    await client.query("alter table projects rename to projects_unavailable_for_boundary_test");
    await client.close();

    const response = await post("/api/v1/configurations/install", secrets["organization-a"], {
      projectSlug: "same-project",
      files: configurationBundleFixture(
        "environments:\n  - name: runner\n    kind: docker\n    image: paseo/valid\ntriggers: []",
      ),
    });
    const restore = await createPostgresQueryRuntime(databaseUrl);

    await restore.query("alter table projects_unavailable_for_boundary_test rename to projects");
    await restore.close();
    assert.equal(response.status, 500);
    const serialized = JSON.stringify(await response.json());
    assert.equal(ProblemSchema.parse(JSON.parse(serialized)).code, "internal_error");
    assert.equal(serialized.includes("projects_unavailable_for_boundary_test"), false);
    assert.equal(serialized.includes("relation"), false);
    assert.equal(serialized.includes("42P01"), false);
  }, 120_000);

  it("installs exact submitted partial bundles and rejects invalid bundle boundaries", async () => {
    const yaml = partialConfigurationYaml();
    const baseFiles = configurationBundleFixture(yaml);
    const partial = (content: unknown) => ({
      path: ".paseo/workflows/partials/docs/safety.md",
      content,
    });
    const cases = [
      {
        name: "missing",
        body: { projectSlug: "bundle-project", files: baseFiles },
        expectedPath: [".paseo/workflows/partials/docs/safety.md"],
      },
      {
        name: "unsafe",
        body: {
          projectSlug: "bundle-project",
          files: [...baseFiles, { path: "../secret.md", content: "secret" }],
        },
        expectedPath: ["../secret.md"],
      },
      {
        name: "duplicate",
        body: {
          projectSlug: "bundle-project",
          files: [...baseFiles, partial("one"), partial("two")],
        },
        expectedPath: [".paseo/workflows/partials/docs/safety.md"],
      },
      {
        name: "toml",
        body: {
          projectSlug: "bundle-project",
          files: [...baseFiles, { path: ".paseo/hub.toml", content: "" }],
        },
        expectedPath: [".paseo/hub.toml"],
      },
    ] as const;
    for (const testCase of cases) {
      const response = await post(
        "/api/v1/configurations/install",
        secrets["organization-a"],
        testCase.body,
      );
      assert.equal(response.status, 422, testCase.name);
      const problem = ProblemSchema.parse(await response.json());
      assert.equal(problem.code, "invalid_configuration_bundle", testCase.name);
      assert.deepEqual(problem.issues?.[0]?.path, testCase.expectedPath, testCase.name);
    }

    const malformed = await post("/api/v1/configurations/install", secrets["organization-a"], {
      projectSlug: "bundle-project",
      files: [...baseFiles, partial(42)],
    });
    assert.equal(malformed.status, 400);
    assert.equal(ProblemSchema.parse(await malformed.json()).code, "invalid_request");

    const first = await post("/api/v1/configurations/install", secrets["organization-a"], {
      projectSlug: "bundle-project",
      files: [...baseFiles, partial("First instructions")],
    });
    const second = await post("/api/v1/configurations/install", secrets["organization-a"], {
      projectSlug: "bundle-project",
      files: [...baseFiles, partial("Second instructions")],
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstInstalled = InstalledConfigurationSchema.parse(await first.json());
    const secondInstalled = InstalledConfigurationSchema.parse(await second.json());
    assert.notEqual(firstInstalled.versionId, secondInstalled.versionId);

    const client = await createPostgresQueryRuntime(databaseUrl);

    const revisions = await client.query<{
      raw_yaml: string;
      partial_content: string;
    }>(
      `select raw_yaml,
              jsonb_path_query_first(
                source_evidence,
                '$.bundle.files[*] ? (@.path == ".paseo/workflows/partials/docs/safety.md")'
              )->>'content' as partial_content
       from project_configuration_revisions revision
       join projects project on project.id = revision.project_id
       where project.organization_id = 'organization-a' and project.slug = 'bundle-project'
       order by revision.version`,
    );
    await client.close();
    assert.deepEqual(
      revisions.rows.map((row) => row.partial_content),
      ["First instructions", "Second instructions"],
    );
    assert.equal(revisions.rows[0]?.raw_yaml, baseFiles[0]?.content);
    assert.equal(revisions.rows[1]?.raw_yaml, baseFiles[0]?.content);

    const otherTenant = await post("/api/v1/configurations/install", secrets["organization-b"], {
      projectSlug: "bundle-project",
      files: [...baseFiles, partial("Organization B")],
    });
    assert.equal(otherTenant.status, 201);
  }, 120_000);

  async function post(path: string, secret: string, body?: unknown): Promise<Response> {
    return built.default.fetch(
      new Request(`http://hub.test${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  async function get(path: string, secret: string): Promise<Response> {
    return built.default.fetch(
      new Request(`http://hub.test${path}`, {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
  }

  function partialConfigurationYaml(): string {
    return [
      "environments:",
      "  - name: runner",
      "    kind: daemon",
      `    daemon: ${TEST_DAEMON_SLUG}`,
      "    cwd: /repo",
      "triggers:",
      "  - name: request",
      "    on: manual.run",
      "    max_runtime: 1h",
      "    steps:",
      "      - id: work",
      "        environment: runner",
      "        max_runtime: 10m",
      "        idle_timeout: 1m",
      "        agent: { provider: test }",
      "        prompt:",
      "          - include: partials/docs/safety.md",
    ].join("\n");
  }

  function jsonRequest(path: string, body: unknown): Request {
    return new Request(`http://hub.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
});

function validPublicApiConfiguration(): string {
  return [
    "environments:",
    "  - name: runner",
    "    kind: daemon",
    `    daemon: ${TEST_DAEMON_SLUG}`,
    "    cwd: /repo",
    "triggers:",
    "  - name: configured",
    "    on: manual.run",
    "    max_runtime: 1h",
    "    steps:",
    "      - id: work",
    "        environment: runner",
    "        max_runtime: 10m",
    "        idle_timeout: 1m",
    "        agent: { provider: test }",
    '        prompt: [{ text: "Run the configured work" }]',
  ].join("\n");
}
