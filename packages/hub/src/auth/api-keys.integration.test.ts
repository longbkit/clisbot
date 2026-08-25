import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import {
  createDatabase,
  testDatabaseLocks,
  testDatabaseRuntime,
} from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { createAuthServer, type AuthServer } from "./server.js";
import { composeEntitlements, type ComposedEntitlements } from "./entitlements.js";
import { z } from "zod";
import { createHubApplication } from "../app.js";
import { createUnlimitedEntitlementsService } from "../entitlements/test-utils.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";

const createdApiKeyResponseSchema = z.object({ key: z.object({ id: z.string().uuid() }) });

describe("organization API-key boundary", () => {
  let postgres: StartedPostgreSqlContainer;
  let auth: AuthServer;
  let authEntitlements: ComposedEntitlements;
  let authDatabase: Database;
  let databaseUrl: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = postgres.getConnectionUri();
    authDatabase = await createDatabase(databaseUrl);
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
    `);
    await client.close();
    authEntitlements = composeEntitlements(authDatabase, testDatabaseRuntime(authDatabase));
    auth = createAuthServer({
      database: testDatabaseRuntime(authDatabase),
      locks: testDatabaseLocks(authDatabase),
      entitlements: authEntitlements.service,
      secret: "test".repeat(8),
      baseURL: "http://localhost:3000",
      policy: {
        registrationMode: "open",
        organizationCreation: "disabled",
        bootstrap: undefined,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await authDatabase.close();
    await auth.close();
    await authEntitlements.close();
    await postgres.stop();
  }, 120_000);

  it("reveals a secret once and keeps key authentication tenant-scoped", async () => {
    const keyA = await auth.apiKeys!.create("organization-a", "user-a", "deployment A", [
      "configuration:install",
      "runs:dispatch",
    ]);
    const keyB = await auth.apiKeys!.create("organization-b", "user-b", "deployment B", [
      "configuration:install",
    ]);

    const listed = await auth.apiKeys!.list("organization-a");
    assert.deepEqual(
      listed.map(({ id, name, prefix, scopes }) => ({ id, name, prefix, scopes })),
      [
        {
          id: keyA.summary.id,
          name: "deployment A",
          prefix: keyA.summary.prefix,
          scopes: ["configuration:install", "runs:dispatch"],
        },
      ],
    );
    assert.equal(JSON.stringify(listed).includes(keyA.secret), false);

    const authorized = await auth.apiKeys!.authorize(request(keyA.secret), "runs:dispatch");
    assert.equal(authorized.status, "authorized");
    if (authorized.status === "authorized") {
      assert.equal(authorized.access.organizationId, "organization-a");
      assert.equal(authorized.access.credentialId, keyA.summary.id);
    }
    assert.equal(
      (await auth.apiKeys!.authorize(request(keyA.secret), "daemons:enroll")).status,
      "forbidden",
    );
    assert.equal(
      (
        await auth.apiKeys!.authorize(
          request(keyA.secret.replace(/[^_]+$/u, "wrong")),
          "runs:dispatch",
        )
      ).status,
      "unauthorized",
    );
    assert.equal(
      (await auth.apiKeys!.authorize(request(keyB.secret), "runs:dispatch")).status,
      "forbidden",
    );
    assert.equal(
      (await auth.apiKeys!.authorize(request("Bearer nope"), "runs:dispatch")).status,
      "unauthorized",
    );
    assert.equal(
      (await auth.apiKeys!.authorize(request(keyA.secret), "runs:dispatch")).status,
      "authorized",
    );

    assert.equal(await auth.apiKeys!.revoke("organization-a", keyA.summary.id), true);
    assert.equal(
      (await auth.apiKeys!.authorize(request(keyA.secret), "runs:dispatch")).status,
      "unauthorized",
    );
    assert.equal(await auth.apiKeys!.revoke("organization-b", keyA.summary.id), false);
  });

  it("keeps last-use evidence conditional on successful authentication", async () => {
    const key = await auth.apiKeys!.create("organization-a", "user-a", `last-use-${randomUUID()}`, [
      "configuration:install",
    ]);
    const before = (await auth.apiKeys!.list("organization-a")).find(
      ({ id }) => id === key.summary.id,
    );
    assert.equal(before?.lastUsedAt, null);
    assert.equal(
      (
        await auth.apiKeys!.authorize(
          request(`${key.summary.prefix}_wrong`),
          "configuration:install",
        )
      ).status,
      "unauthorized",
    );
    const failed = (await auth.apiKeys!.list("organization-a")).find(
      ({ id }) => id === key.summary.id,
    );
    assert.equal(failed?.lastUsedAt, null);
    assert.equal(
      (await auth.apiKeys!.authorize(request(key.secret), "configuration:install")).status,
      "authorized",
    );
    const used = (await auth.apiKeys!.list("organization-a")).find(
      ({ id }) => id === key.summary.id,
    );
    assert.notEqual(used?.lastUsedAt, null);
  });

  it("authenticates every public v1 operation across the real PostgreSQL key matrix", async () => {
    const database = await createDatabase(databaseUrl);
    const projectSlug = `public-api-${randomUUID()}`;
    await database.createProject({
      organizationId: "organization-a",
      name: "Public API project",
      slug: projectSlug,
      createdByUserId: "user-a",
    });
    await enrollTestDaemon(database, "organization-a");
    const application = createHubApplication({
      database,
      entitlements: createUnlimitedEntitlementsService(),
      publicApi: { status: "enabled", authenticator: auth.publicCredentials! },
    });
    await application.hub.start();
    try {
      const cases = [
        {
          path: "/api/v1/configurations/install",
          scope: "configuration:install" as const,
          validStatus: 201,
          body: {
            projectSlug,
            files: [
              {
                path: ".paseo/hub.yml",
                content: `environments:\n  runner:\n    kind: daemon\n    daemon: ${TEST_DAEMON_SLUG}\n    cwd: /repo\nagents: {}`,
              },
              {
                path: ".paseo/workflows/noop.yml",
                content:
                  "name: noop\non: manual.run\nmax_runtime: 1h\nsteps:\n  - id: work\n    environment: runner\n    max_runtime: 10m\n    idle_timeout: 1m\n    agent: { provider: test }\n    prompt: [{ text: noop }]",
              },
            ],
          },
        },
        {
          path: "/api/v1/manual-runs",
          scope: "runs:dispatch" as const,
          validStatus: 404,
          body: {
            projectSlug,
            trigger: "not-configured",
            actor: "automation",
            deliveryKey: randomUUID(),
            input: {},
          },
        },
        {
          path: "/api/v1/daemons/enrollment-tokens",
          scope: "daemons:enroll" as const,
          validStatus: 201,
        },
      ];
      for (const operation of cases) {
        const valid = await auth.apiKeys!.create(
          "organization-a",
          "user-a",
          `valid-${operation.scope}-${randomUUID()}`,
          [operation.scope],
        );
        const insufficientScope =
          operation.scope === "configuration:install" ? "runs:dispatch" : "configuration:install";
        const insufficient = await auth.apiKeys!.create(
          "organization-a",
          "user-a",
          `insufficient-${operation.scope}-${randomUUID()}`,
          [insufficientScope],
        );
        const revoked = await auth.apiKeys!.create(
          "organization-a",
          "user-a",
          `revoked-${operation.scope}-${randomUUID()}`,
          [operation.scope],
        );
        assert.equal(await auth.apiKeys!.revoke("organization-a", revoked.summary.id), true);
        for (const [name, credential, expected] of [
          ["missing", undefined, 401],
          ["malformed", "not-a-paseo-key", 401],
          ["revoked", revoked.secret, 401],
          ["insufficient", insufficient.secret, 403],
          ["valid", valid.secret, operation.validStatus],
        ] as const) {
          const response = await application.publicApi.handle(
            new Request(`http://localhost:3000${operation.path}`, {
              method: "POST",
              headers: {
                ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
                ...(operation.body === undefined ? {} : { "content-type": "application/json" }),
              },
              ...(operation.body === undefined ? {} : { body: JSON.stringify(operation.body) }),
            }),
          );
          assert.equal(response.status, expected, `${operation.scope}: ${name}`);
          if (expected === 401) {
            assert.equal(
              response.headers.get("www-authenticate"),
              "Bearer",
              `${operation.scope}: ${name}`,
            );
          }
        }
      }
    } finally {
      await application.hub.stop();
      await database.close();
    }
  }, 120_000);

  it("serializes enrollment issuance with API-key revocation", async () => {
    const database = await createDatabase(databaseUrl);
    const client = await createPostgresQueryRuntime(databaseUrl);

    try {
      const revokedFirst = await auth.apiKeys!.create(
        "organization-a",
        "user-a",
        `revoked-first-${randomUUID()}`,
        ["daemons:enroll"],
      );
      const { revokeFirst, rejectedIssue } = await client.transaction(async (transaction) => {
        await transaction.query(`select id from organization_api_keys where id = $1 for update`, [
          revokedFirst.summary.id,
        ]);
        const revokeOperation = auth.apiKeys!.revoke("organization-a", revokedFirst.summary.id);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const issueOperation = database.issueEnrollmentToken({
          id: randomUUID(),
          verifier: `race-rejected-${randomUUID()}`,
          organizationId: "organization-a",
          issuedByApiKeyId: revokedFirst.summary.id,
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
        });
        return { revokeFirst: revokeOperation, rejectedIssue: issueOperation };
      });
      assert.equal(await revokeFirst, true);
      assert.equal(await rejectedIssue, false);

      const issuedFirst = await auth.apiKeys!.create(
        "organization-a",
        "user-a",
        `issued-first-${randomUUID()}`,
        ["daemons:enroll"],
      );
      const issuedTokenId = randomUUID();
      const { acceptedIssue, revokeAfterIssue } = await client.transaction(async (transaction) => {
        await transaction.query(`select id from organization_api_keys where id = $1 for update`, [
          issuedFirst.summary.id,
        ]);
        const issueOperation = database.issueEnrollmentToken({
          id: issuedTokenId,
          verifier: `race-accepted-${randomUUID()}`,
          organizationId: "organization-a",
          issuedByApiKeyId: issuedFirst.summary.id,
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const revokeOperation = auth.apiKeys!.revoke("organization-a", issuedFirst.summary.id);
        return { acceptedIssue: issueOperation, revokeAfterIssue: revokeOperation };
      });
      assert.equal(await acceptedIssue, true);
      assert.equal(await revokeAfterIssue, true);
      const token = await client.query<{ expires_at: Date }>(
        `select expires_at from daemon_enrollment_tokens where id = $1`,
        [issuedTokenId],
      );
      assert.equal(token.rowCount, 1);
      assert.ok(token.rows[0]!.expires_at <= new Date());
    } finally {
      await client.close();
      await database.close();
    }
  });

  it("denies API-key management at the HTTP boundary for organization members", async () => {
    const email = `member-${randomUUID()}@example.test`;
    const signup = await auth.handle(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ name: "Member", email, password: "member-password-123" }),
      }),
    );
    assert.equal(signup.status, 200);
    const cookie = signup.headers
      .get("set-cookie")
      ?.match(/^(?:[^;]+);/u)?.[0]
      ?.slice(0, -1);
    assert.ok(cookie);
    const client = await createPostgresQueryRuntime(databaseUrl);

    const user = await client.query<{ id: string }>(`select id from "user" where email = $1`, [
      email,
    ]);
    await client.query(
      `insert into member (id, organization_id, user_id, role) values ($1, 'organization-a', $2, 'member')`,
      [randomUUID(), user.rows[0]!.id],
    );
    await client.close();
    const select = await auth.handle(
      new Request("http://localhost:3000/api/auth/paseo/select-organization", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ organizationId: "organization-a" }),
      }),
    );
    assert.equal(select.status, 200);
    const list = await auth.handle(
      new Request("http://localhost:3000/api/auth/paseo/api-keys", {
        headers: { cookie, origin: "http://localhost:3000" },
      }),
    );
    assert.equal(list.status, 403);
    assert.deepEqual(await list.json(), { error: "forbidden" });
  });

  it("keeps concurrent browser key mutations from exhausting the auth pool", async () => {
    const email = `pool-owner-${randomUUID()}@example.test`;
    const signup = await auth.handle(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ name: "Pool owner", email, password: "pool-owner-password-123" }),
      }),
    );
    assert.equal(signup.status, 200);
    const cookie = signup.headers
      .get("set-cookie")
      ?.match(/^(?:[^;]+);/u)?.[0]
      ?.slice(0, -1);
    assert.ok(cookie);
    const client = await createPostgresQueryRuntime(databaseUrl);

    const user = await client.query<{ id: string }>(`select id from "user" where email = $1`, [
      email,
    ]);
    await client.query(
      `insert into member (id, organization_id, user_id, role)
       values ($1, 'organization-a', $2, 'owner')`,
      [randomUUID(), user.rows[0]!.id],
    );
    await client.close();
    const select = await auth.handle(
      new Request("http://localhost:3000/api/auth/paseo/select-organization", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ organizationId: "organization-a" }),
      }),
    );
    assert.equal(select.status, 200);

    const concurrent = 20;
    const created = await Promise.all(
      Array.from({ length: concurrent }, (_, index) =>
        auth.handle(
          new Request("http://localhost:3000/api/auth/paseo/api-keys", {
            method: "POST",
            headers: {
              cookie,
              origin: "http://localhost:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({ name: `pool-key-${index}`, scopes: ["runs:dispatch"] }),
          }),
        ),
      ),
    );
    assert.deepEqual(
      created.map((response) => response.status),
      Array(concurrent).fill(201),
    );
    const keyIds = await Promise.all(
      created.map(
        async (response) => createdApiKeyResponseSchema.parse(await response.json()).key.id,
      ),
    );
    const revoked = await Promise.all(
      keyIds.map((id) =>
        auth.handle(
          new Request("http://localhost:3000/api/auth/paseo/revoke-api-key", {
            method: "POST",
            headers: {
              cookie,
              origin: "http://localhost:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({ id }),
          }),
        ),
      ),
    );
    assert.deepEqual(
      revoked.map((response) => response.status),
      Array(concurrent).fill(200),
    );
  });
});

function request(secret: string): Request {
  return new Request("http://localhost:3000/api/machine", {
    headers: { authorization: secret.startsWith("Bearer ") ? secret : `Bearer ${secret}` },
  });
}
