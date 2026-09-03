import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { composeEntitlements } from "../auth/entitlements.js";
import { createAuthServer } from "../auth/server.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createDatabase } from "../db/pg.js";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";

const ORIGIN = "http://embedded.test";

const accountStateSchema = z
  .object({
    status: z.string(),
    account: z.object({ email: z.string() }).optional(),
    isInstanceOperator: z.boolean().optional(),
  })
  .passthrough();

it("claims and completes a pristine instance through the shared Paseo HTTP contract on PGlite", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-browser-claim-"));
  const { runtime, locks } = await embeddedDatabaseRuntime(join(root, "database"));
  await runtime.migrate();
  const database = createDatabase(runtime, locks, createTestCredentialCipher());
  const entitlements = composeEntitlements(database, runtime);
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    secret: "embedded-claim-secret".padEnd(32, "-"),
    baseURL: ORIGIN,
    policy: {
      registrationMode: "invite_only",
      organizationCreation: "disabled",
      bootstrap: undefined,
    },
  });

  try {
    await auth.initialize?.();
    const claim = await auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/claim-instance`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          email: "browser.operator@example.test",
          password: "browser-operator-password",
        }),
      }),
    );
    assert.equal(claim.status, 200);
    assert.deepEqual(await claim.json(), { state: "claimed" });
    const cookie = claim.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie !== undefined);

    const beforeCompletion = await readAccountState(auth, cookie);
    assert.equal(beforeCompletion.status, "appSetupRequired");
    assert.equal(beforeCompletion.account?.email, "browser.operator@example.test");
    assert.equal(beforeCompletion.isInstanceOperator, true);

    const completed = await auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/complete-app-setup`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(completed.status, 200);
    assert.deepEqual(await completed.json(), { state: "complete" });
    assert.equal((await readAccountState(auth, cookie)).status, "active");

    const createdKey = await auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/api-keys`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ name: "Embedded integration", scopes: ["projects:read"] }),
      }),
    );
    assert.equal(createdKey.status, 201);
    const createdKeyBody = z
      .object({
        key: z.object({ id: z.string(), prefix: z.string(), scopes: z.array(z.string()) }),
        secret: z.string().startsWith("paseo_pk_"),
      })
      .parse(await createdKey.json());
    const listedKeys = await auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/api-keys`, { headers: { cookie } }),
    );
    assert.equal(listedKeys.status, 200);
    const listedBody = await listedKeys.json();
    assert.equal(JSON.stringify(listedBody).includes(createdKeyBody.secret), false);
    assert.deepEqual(
      z
        .object({ keys: z.array(z.object({ id: z.string(), scopes: z.array(z.string()) })) })
        .parse(listedBody).keys,
      [{ id: createdKeyBody.key.id, scopes: ["projects:read"] }],
    );

    const second = await auth.handle(
      new Request(`${ORIGIN}/api/auth/paseo/claim-instance`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          email: "second@example.test",
          password: "second-operator-password",
        }),
      }),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { state: "unavailable" });
  } finally {
    await auth.close();
    await entitlements.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function readAccountState(auth: ReturnType<typeof createAuthServer>, cookie: string) {
  const response = await auth.handle(
    new Request(`${ORIGIN}/api/auth/paseo/state`, { headers: { cookie } }),
  );
  assert.equal(response.status, 200);
  return accountStateSchema.parse(await response.json());
}
