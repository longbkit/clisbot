import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { z } from "zod";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import type { Database, EnrollDaemonInput } from "../db/types.js";
import { OrganizationCliCredentials } from "../auth/cli-credentials.js";
import { CliAuthorizations } from "./index.js";

const enrollment = {
  serverId: "approved-host",
  daemonPublicKey: "approved-public-key",
  hostname: "laptop",
  permissions: ["hub.execute", "daemon.read"],
};
const startedSchema = z.object({ deviceCode: z.string(), userCode: z.string() });
const outcomeSchema = z.object({
  status: z.string(),
  token: z.string().optional(),
  credential: z.string().optional(),
});
const browser = {
  resolveOrganizationAccess: async () => ({
    session: { id: "session" },
    account: { id: "owner", name: "Owner", email: "owner@test.local" },
    organization: { id: "org", name: "Acme", slug: "acme" },
    membership: { id: "member", role: "owner" as const },
    capabilities: {
      view: true as const,
      manageResources: true,
      manageChannels: true,
      manageMembers: true,
      manageOwners: true,
    },
  }),
  resolveAccount: async () => {
    throw new Error("unused");
  },
  rejectCookieMutation: () => undefined,
};
const post = (body: unknown) =>
  new Request("https://hub.test/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Host approval on durable embedded Hub storage", () => {
  let root: string;
  let bundle: DatabaseRuntimeBundle;
  let database: Database;
  let auth: CliAuthorizations;
  const reopen = async () => {
    bundle = await embeddedDatabaseRuntime(join(root, "database"));
    await bundle.runtime.migrate();
    database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
    auth = new CliAuthorizations(database, browser);
  };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clisbot-host-approval-"));
    await reopen();
    for (const statement of `insert into organization (id, name, slug) values ('org', 'Acme', 'acme');
      insert into "user" (id, name, email) values ('owner', 'Owner', 'owner@test.local');
      insert into session (id, token, user_id, active_organization_id, expires_at) values ('session', 'browser-secret', 'owner', 'org', now() + interval '1 day');
      insert into member (id, organization_id, user_id, role) values ('member', 'org', 'owner', 'owner')`.split(
      ";",
    ))
      await bundle.runtime.query(statement);
  }, 120_000);
  afterAll(async () => {
    await bundle?.runtime.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("approves only the inspected purpose, survives restart, consumes a bound token once, and creates no CLI credential", async () => {
    const started = startedSchema.parse(await (await auth.start(post({ enrollment }))).json());
    assert.deepEqual(
      (
        (await (await auth.inspect(post({ userCode: started.userCode }))).json()) as {
          enrollment: unknown;
        }
      ).enrollment,
      enrollment,
    );
    const decision = {
      userCode: started.userCode,
      organizationId: "org",
      decision: "approve",
      purpose: "host_enrollment",
    };
    assert.equal((await auth.decide(post({ ...decision, purpose: "cli_login" }))).status, 403);
    assert.equal((await auth.decide(post({ ...decision, organizationId: "other" }))).status, 403);
    await bundle.runtime.query(`update member set role = 'member' where id = 'member'`);
    assert.equal((await auth.decide(post(decision))).status, 403);
    await bundle.runtime.query(`update member set role = 'owner' where id = 'member'`);
    assert.equal((await auth.decide(post(decision))).status, 200);
    await bundle.runtime.close();
    await reopen();
    // A poll using the CLI-login purpose cannot escalate the saved request.
    const wrongPoll = outcomeSchema.parse(
      await (await auth.poll(post({ deviceCode: started.deviceCode }))).json(),
    );
    assert.equal(wrongPoll.status, "denied");
    const polls = await Promise.all(
      [1, 2].map(async () =>
        outcomeSchema.parse(
          await (
            await auth.poll(post({ deviceCode: started.deviceCode, purpose: "host_enrollment" }))
          ).json(),
        ),
      ),
    );
    assert.deepEqual(polls.map((p) => p.status).sort(), ["disclosed", "enrollment_authorized"]);
    const outcome = polls.find((p) => p.token)!;
    assert.equal(outcome.credential, undefined);
    const token = outcome.token!;
    assert.equal(
      (
        await new OrganizationCliCredentials(bundle.runtime).authorize(
          new Request("https://hub.test/api/v1/projects", {
            headers: { authorization: `Bearer ${token}` },
          }),
          "projects:read",
        )
      ).status,
      "unauthorized",
    );
    const input: EnrollDaemonInput = {
      daemonId: randomUUID(),
      idempotencyKey: randomUUID(),
      tokenVerifier: createHash("sha256").update(token).digest("base64url"),
      serverId: enrollment.serverId,
      daemonPublicKey: enrollment.daemonPublicKey,
      credentialVerifier: "daemon-owned-secret-hash",
      permissions: enrollment.permissions,
      now: new Date(),
    };
    for (const change of [
      { serverId: "different" },
      { daemonPublicKey: "different" },
      { permissions: ["daemon.manage"] },
    ]) {
      assert.equal(await database.enrollDaemon({ ...input, ...change }), undefined);
    }
    const connected = await database.enrollDaemon(input);
    assert.ok(connected && "id" in connected);
    assert.deepEqual(await database.enrollDaemon(input), connected);
    assert.equal(
      await database.enrollDaemon({ ...input, credentialVerifier: "different" }),
      undefined,
    );
    assert.equal(
      await database.enrollDaemon({
        ...input,
        daemonId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
      undefined,
    );
    const counts = await bundle.runtime.query<{ count: number }>(
      `select count(*)::integer as count from organization_cli_credentials`,
    );
    assert.equal(counts.rows[0]?.count, 0);
  }, 120_000);

  it("keeps denied and expired requests terminal; rejects expired enrollment grants", async () => {
    for (const denied of [true, false]) {
      const started = startedSchema.parse(await (await auth.start(post({ enrollment }))).json());
      if (denied)
        await auth.decide(
          post({
            userCode: started.userCode,
            organizationId: "org",
            decision: "deny",
            purpose: "host_enrollment",
          }),
        );
      else
        await bundle.runtime.query(
          `update cli_authorizations set expires_at = now() - interval '1 second' where status = 'pending'`,
        );
      const result = outcomeSchema.parse(
        await (
          await auth.poll(post({ deviceCode: started.deviceCode, purpose: "host_enrollment" }))
        ).json(),
      );
      assert.equal(result.status, denied ? "denied" : "expired");
      assert.equal(result.token, undefined);
    }
    const started = startedSchema.parse(await (await auth.start(post({ enrollment }))).json());
    await auth.decide(
      post({
        userCode: started.userCode,
        organizationId: "org",
        decision: "approve",
        purpose: "host_enrollment",
      }),
    );
    const result = outcomeSchema.parse(
      await (
        await auth.poll(post({ deviceCode: started.deviceCode, purpose: "host_enrollment" }))
      ).json(),
    );
    assert.ok(result.token);
    await bundle.runtime.query(
      `update daemon_enrollment_tokens set expires_at = now() - interval '1 second'`,
    );
    assert.equal(
      await database.enrollDaemon({
        daemonId: randomUUID(),
        idempotencyKey: randomUUID(),
        tokenVerifier: createHash("sha256").update(result.token).digest("base64url"),
        serverId: enrollment.serverId,
        daemonPublicKey: enrollment.daemonPublicKey,
        permissions: enrollment.permissions,
        credentialVerifier: "unused",
        now: new Date(),
      }),
      undefined,
    );
  });
});
