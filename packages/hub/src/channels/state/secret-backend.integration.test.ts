// The encrypted keyed-store namespace, end to end on the production path: a
// real migrated database, the real credential cipher, the real
// `createHostKeyedStoreRoot` — the same three pieces the supervisor wires for a
// QR-auth account.
//
// What it has to prove is the HUB-WIRING §6 guarantee list: the value survives
// a restart, it is not readable in the row, and one organization cannot read
// another's namespace even at the identical channel/account/namespace key.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createTestCredentialCipher } from "../../credentials/test-utils.js";
import { createDatabase } from "../../db/pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type { Database } from "../../db/types.js";
import { createHostKeyedStoreRoot } from "./keyed-store.js";
import { openChannelSecretStateBackend } from "./secret-backend.js";

const NAMESPACE = "credentials";
/** A stand-in for the zca-js session record: what leaking it would cost is the
 * whole point, so the test asserts it never appears in the row. */
const SESSION = { imei: "imei-canary", cookie: "cookie-canary", userAgent: "ua" };

let bundle: DatabaseRuntimeBundle | undefined;
let root: string | undefined;

afterEach(async () => {
  await bundle?.runtime.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  bundle = undefined;
  root = undefined;
});

/** A keyed-store root whose `credentials` namespace is database-backed, exactly
 * as `supervisor/index.ts` builds it. */
async function encryptedRoot(database: Database, organizationId: string, dir: string) {
  return createHostKeyedStoreRoot({
    dir,
    secret: {
      namespaces: [NAMESPACE],
      backend: await openChannelSecretStateBackend({
        database,
        scope: { organizationId, channel: "zalouser", accountId: "personal" },
      }),
    },
  });
}

it("round-trips an encrypted namespace and isolates it per organization", async () => {
  root = await mkdtemp(join(tmpdir(), "hub-channel-secret-state-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug)
       values ('org-a', 'A', 'a'), ('org-b', 'B', 'b')`,
  );
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());

  const first = await encryptedRoot(database, "org-a", join(root, "state-a"));
  await first
    .openKeyedStore({ namespace: NAMESPACE, maxEntries: 256, overflowPolicy: "reject-new" })
    .register("profile:default", SESSION);

  // At rest: one row, and the session is not readable in it.
  const rows = await bundle.runtime.query<{ envelope: string; organizationId: string }>(
    `select state_envelope::text as envelope, organization_id as "organizationId"
       from channel_state_secrets`,
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]?.organizationId, "org-a");
  assert.equal(rows.rows[0]?.envelope.includes("imei-canary"), false);
  assert.equal(rows.rows[0]?.envelope.includes("cookie-canary"), false);

  // Durable: a fresh root (the Hub restarting) hydrates the same value.
  const reopened = await encryptedRoot(database, "org-a", join(root, "state-a2"));
  assert.deepEqual(
    await reopened
      .openKeyedStore({ namespace: NAMESPACE, maxEntries: 256, overflowPolicy: "reject-new" })
      .lookup("profile:default"),
    SESSION,
  );

  // Isolated: the same channel, account and namespace in another organization
  // is a different namespace, not a shared one.
  const other = await encryptedRoot(database, "org-b", join(root, "state-b"));
  assert.equal(
    await other
      .openKeyedStore({ namespace: NAMESPACE, maxEntries: 256, overflowPolicy: "reject-new" })
      .lookup("profile:default"),
    undefined,
  );

  // Deleting the account's namespaces removes the row, and a re-opened root
  // starts empty — an unlinked account, not a resurrected session.
  await database.deleteChannelStateSecrets({
    organizationId: "org-a",
    channel: "zalouser",
    accountId: "personal",
  });
  const afterDelete = await bundle.runtime.query(`select 1 from channel_state_secrets`);
  assert.equal(afterDelete.rows.length, 0);
});

it("keeps ordinary namespaces on the plain file backing", async () => {
  root = await mkdtemp(join(tmpdir(), "hub-channel-secret-state-"));
  bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  await bundle.runtime.query(`insert into organization (id, name, slug) values ('org', 'O', 'o')`);
  const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());

  const store = await encryptedRoot(database, "org", join(root, "state"));
  await store
    .openKeyedStore({ namespace: "telegram.update-offsets", maxEntries: 8 })
    .register("chat", { offset: 42 });

  // The offset is protocol state: it stays a file and never reaches the table.
  const rows = await bundle.runtime.query(`select 1 from channel_state_secrets`);
  assert.equal(rows.rows.length, 0);
});
