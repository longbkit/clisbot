import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../db/runtime/index.js";
import type { CredentialEnvelope } from "./credential-cipher.js";
import { channelCredentialOwner, RUNTIME_AUTH_SECRET_OWNER } from "./credential-owners.js";
import { resealLegacyCredentialEnvelopes } from "./credential-reseal.js";
import { createTestCredentialCipher, sealTestEnvelope } from "./test-utils.js";

const roots: string[] = [];
const runtimes: DatabaseRuntime[] = [];
const CONNECTION_ID = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("credential re-seal", () => {
  it("re-seals legacy envelopes to the current version once", async () => {
    const runtime = await freshRuntime();
    const cipher = createTestCredentialCipher();
    await insertAuthSecret(runtime, RUNTIME_AUTH_SECRET_OWNER);
    await runtime.query(`insert into organization (id, name, slug) values ('org-1', 'Org', 'org')`);
    await runtime.query(
      `insert into telegram_connections (id, organization_id, account_id, credential_envelope)
       values ($1, 'org-1', 'default', $2)`,
      [
        CONNECTION_ID,
        JSON.stringify(
          sealTestEnvelope({
            prefix: "paseo-hub",
            version: 1,
            owner: channelCredentialOwner("telegram", CONNECTION_ID, "org-1", 1),
            value: { botToken: "123:abc" },
          }),
        ),
      ],
    );

    assert.deepEqual(await resealLegacyCredentialEnvelopes(runtime, cipher), {
      resealed: 2,
      skipped: 0,
      failures: [],
    });
    const secret = await runtime.query<{ envelope: CredentialEnvelope }>(
      `select auth_secret_envelope as envelope from runtime_configuration`,
    );
    assert.equal(secret.rows[0]?.envelope.version, 3);
    assert.equal(
      cipher.decrypt(RUNTIME_AUTH_SECRET_OWNER, secret.rows[0]?.envelope),
      "auth-secret",
    );
    const connection = await runtime.query<{ envelope: CredentialEnvelope }>(
      `select credential_envelope as envelope from telegram_connections`,
    );
    assert.deepEqual(
      cipher.decrypt(
        channelCredentialOwner("telegram", CONNECTION_ID, "org-1", 3),
        connection.rows[0]?.envelope,
      ),
      { botToken: "123:abc" },
    );
    assert.deepEqual(await resealLegacyCredentialEnvelopes(runtime, cipher), {
      resealed: 0,
      skipped: 0,
      failures: [],
    });
  });

  it("reports a row that does not open instead of failing", async () => {
    const runtime = await freshRuntime();
    await insertAuthSecret(runtime, "some-other-owner");

    const result = await resealLegacyCredentialEnvelopes(runtime, createTestCredentialCipher());

    assert.equal(result.resealed, 0);
    assert.deepEqual(
      result.failures.map(({ table, row }) => ({ table, row })),
      [{ table: "runtime_configuration", row: "true" }],
    );
  });

  it("leaves a row its writer re-sealed meanwhile", async () => {
    const runtime = await freshRuntime();
    const cipher = createTestCredentialCipher();
    await insertAuthSecret(runtime, RUNTIME_AUTH_SECRET_OWNER);
    const written = cipher.encrypt(RUNTIME_AUTH_SECRET_OWNER, "written-meanwhile");
    const racing: DatabaseRuntime = Object.create(runtime, {
      query: {
        value: async (sql: string, params?: readonly unknown[]) => {
          if (sql.trimStart().startsWith("update runtime_configuration")) {
            await runtime.query(`update runtime_configuration set auth_secret_envelope = $1`, [
              JSON.stringify(written),
            ]);
          }
          return runtime.query(sql, params);
        },
      },
    });

    assert.deepEqual(await resealLegacyCredentialEnvelopes(racing, cipher), {
      resealed: 0,
      skipped: 1,
      failures: [],
    });
    const secret = await runtime.query<{ envelope: CredentialEnvelope }>(
      `select auth_secret_envelope as envelope from runtime_configuration`,
    );
    assert.equal(
      cipher.decrypt(RUNTIME_AUTH_SECRET_OWNER, secret.rows[0]?.envelope),
      "written-meanwhile",
    );
  });
});

async function insertAuthSecret(runtime: DatabaseRuntime, owner: string): Promise<void> {
  await runtime.query(
    `insert into runtime_configuration (singleton, auth_secret_envelope) values (true, $1)`,
    [
      JSON.stringify(
        sealTestEnvelope({ prefix: "paseo-hub", version: 2, owner, value: "auth-secret" }),
      ),
    ],
  );
}

async function freshRuntime(): Promise<DatabaseRuntime> {
  const root = await mkdtemp(join(tmpdir(), "hub-credential-reseal-"));
  roots.push(root);
  const { runtime } = await embeddedDatabaseRuntime(root);
  runtimes.push(runtime);
  await runtime.migrate();
  return runtime;
}
