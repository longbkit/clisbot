import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { QueryRow } from "../db/runtime/index.js";
import { createPostgresQueryRuntime } from "../db/test-utils/runtime.js";
import { z } from "zod";
import { createDatabase, createPostgresPool } from "../db/test-utils/runtime.js";
import type { Database } from "../db/types.js";
import { OrganizationCliCredentials } from "../auth/cli-credentials.js";
import { CliAuthorizations } from "./index.js";

const startSchema = z.object({ deviceCode: z.string(), userCode: z.string() });
const pollSchema = z.object({ status: z.string(), credential: z.string().optional() });

describe("CLI authorization PostgreSQL state machine", () => {
  let postgres: StartedPostgreSqlContainer;
  let database: Database;
  let databaseUrl: string;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = postgres.getConnectionUri();
    database = await createDatabase(databaseUrl);
    await sql(
      `insert into organization (id, name, slug) values ('org-acme', 'Acme', 'acme');
       insert into "user" (id, name, email) values ('user-owner', 'Owner', 'owner@example.test');
       insert into session (id, token, user_id, active_organization_id, expires_at)
         values ('session-owner', 'session-token', 'user-owner', 'org-acme', now() + interval '1 day');
       insert into member (id, organization_id, user_id, role)
         values ('member-owner', 'org-acme', 'user-owner', 'owner')`,
    );
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await postgres.stop();
  }, 120_000);

  it("serializes approval, expiry, throttling, and single credential disclosure", async () => {
    const authorizations = new CliAuthorizations(database, browserAccess());
    const started = startSchema.parse(
      await (await authorizations.start(post("/api/v1/cli-authorizations", {}))).json(),
    );
    const decisions = await Promise.all([
      authorizations.decide(decision(started.userCode, "approve")),
      authorizations.decide(decision(started.userCode, "approve")),
    ]);
    assert.deepEqual(
      decisions.map(({ status }) => status).sort((left, right) => left - right),
      [200, 404],
    );

    await sql(`update cli_authorizations set next_poll_at = now()`);
    const polls = await Promise.all([
      authorizations.poll(post("/poll", { deviceCode: started.deviceCode })),
      authorizations.poll(post("/poll", { deviceCode: started.deviceCode })),
    ]);
    const bodies = await Promise.all(
      polls.map(async (response) => pollSchema.parse(await response.json())),
    );
    assert.deepEqual(
      bodies.map(({ status }) => status).sort((left, right) => left.localeCompare(right)),
      ["authorized", "disclosed"],
    );
    const credential = bodies.find(({ status }) => status === "authorized")?.credential;
    assert.ok(credential);
    const stored = await rows<{ verifier: string; count: number }>(
      `select min(verifier) as verifier, count(*)::integer as count
       from organization_cli_credentials`,
    );
    assert.equal(stored[0]?.count, 1);
    assert.notEqual(stored[0]?.verifier, credential);
    const pool = await createPostgresPool(databaseUrl);
    const cliCredentials = new OrganizationCliCredentials(pool);
    const authorized = await cliCredentials.authorize(
      new Request("https://hub.test/api/v1/projects", {
        headers: { authorization: `Bearer ${credential}` },
      }),
      "projects:read",
    );
    assert.equal(authorized.status, "authorized");
    assert.equal(
      authorized.status === "authorized" ? authorized.access.organizationId : undefined,
      "org-acme",
    );
    const summaries = await cliCredentials.list("org-acme");
    assert.equal(summaries.length, 1);
    assert.equal(await cliCredentials.revoke("org-acme", summaries[0]!.id), true);
    assert.equal(
      (
        await cliCredentials.authorize(
          new Request("https://hub.test/api/v1/projects", {
            headers: { authorization: `Bearer ${credential}` },
          }),
          "projects:read",
        )
      ).status,
      "unauthorized",
    );
    await pool.close();
    assert.equal(
      (await authorizations.poll(post("/poll", { deviceCode: started.deviceCode }))).status,
      200,
    );

    const throttled = startSchema.parse(
      await (await authorizations.start(post("/api/v1/cli-authorizations", {}))).json(),
    );
    assert.equal(
      pollSchema.parse(
        await (
          await authorizations.poll(post("/poll", { deviceCode: throttled.deviceCode }))
        ).json(),
      ).status,
      "pending",
    );
    assert.equal(
      pollSchema.parse(
        await (
          await authorizations.poll(post("/poll", { deviceCode: throttled.deviceCode }))
        ).json(),
      ).status,
      "slow_down",
    );

    const expired = startSchema.parse(
      await (await authorizations.start(post("/api/v1/cli-authorizations", {}))).json(),
    );
    await sql(`update cli_authorizations set expires_at = now() - interval '1 minute'
               where status = 'pending'`);
    assert.equal(
      pollSchema.parse(
        await (await authorizations.poll(post("/poll", { deviceCode: expired.deviceCode }))).json(),
      ).status,
      "expired",
    );
  });

  async function sql(statement: string): Promise<void> {
    const client = await createPostgresQueryRuntime(databaseUrl);

    try {
      await client.query(statement);
    } finally {
      await client.close();
    }
  }

  async function rows<T extends QueryRow>(statement: string): Promise<T[]> {
    const client = await createPostgresQueryRuntime(databaseUrl);

    try {
      return (await client.query<T>(statement)).rows;
    } finally {
      await client.close();
    }
  }
});

function browserAccess() {
  return {
    resolveOrganizationAccess: () =>
      Promise.resolve({
        session: { id: "session-owner" },
        account: { id: "user-owner", name: "Owner", email: "owner@example.test" },
        organization: { id: "org-acme", name: "Acme", slug: "acme" },
        membership: { id: "member-owner", role: "owner" as const },
        capabilities: {
          view: true as const,
          manageResources: true,
          manageMembers: true,
          manageOwners: true,
        },
      }),
    resolveAccount: () => Promise.reject(new Error("unused")),
    rejectCookieMutation: () => undefined,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(new URL(path, "https://hub.test"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function decision(userCode: string, value: "approve" | "deny"): Request {
  return post("/decision", { userCode, decision: value, organizationId: "org-acme" });
}
