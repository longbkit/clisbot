import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { embeddedDatabaseRuntime, postgresDatabaseRuntime } from "../db/runtime/index.js";
import { createRuntimeConfiguration } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime configuration", () => {
  it("atomically persists one high-entropy secret for concurrent first resolution", async () => {
    const { runtime } = await freshRuntime();
    const configuration = createConfiguration(runtime);

    const secrets = await Promise.all(Array.from({ length: 20 }, () => configuration.authSecret()));

    assert.equal(new Set(secrets).size, 1);
    assert.match(secrets[0]!, /^[a-f0-9]{64}$/u);
    const persisted = await runtime.query<{ count: number; auth_secret: string }>(
      `select count(*)::integer as count, min(auth_secret) as auth_secret
       from runtime_configuration`,
    );
    assert.deepEqual(persisted.rows[0], { count: 1, auth_secret: secrets[0] });
    await runtime.close();
  });

  it("atomically persists one secret across independent PostgreSQL runtime owners", async () => {
    const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = postgres.getConnectionUri();
    const migrationOwner = await postgresDatabaseRuntime(databaseUrl);
    await migrationOwner.runtime.migrate();
    await migrationOwner.runtime.close();

    const owners = await Promise.all(
      Array.from({ length: 20 }, () => postgresDatabaseRuntime(databaseUrl)),
    );
    try {
      const secrets = await Promise.all(
        owners.map(({ runtime }) => createConfiguration(runtime).authSecret()),
      );

      assert.equal(new Set(secrets).size, 1);
      assert.match(secrets[0]!, /^[a-f0-9]{64}$/u);
      const persisted = await owners[0]!.runtime.query<{ count: number; auth_secret: string }>(
        `select count(*)::integer as count, min(auth_secret) as auth_secret
         from runtime_configuration`,
      );
      assert.deepEqual(persisted.rows[0], { count: 1, auth_secret: secrets[0] });
    } finally {
      await Promise.all(owners.map(({ runtime }) => runtime.close()));
      await postgres.stop();
    }
  });

  it("reuses a secret after restart and isolates fresh data directories", async () => {
    const first = await freshRuntime();
    const firstSecret = await createConfiguration(first.runtime).authSecret();
    await first.runtime.close();

    const reopenedBundle = await embeddedDatabaseRuntime(first.root);
    await reopenedBundle.runtime.migrate();
    const reopenedSecret = await createConfiguration(reopenedBundle.runtime).authSecret();
    await reopenedBundle.runtime.close();

    const second = await freshRuntime();
    const secondSecret = await createConfiguration(second.runtime).authSecret();
    await second.runtime.close();

    assert.equal(reopenedSecret, firstSecret);
    assert.notEqual(secondSecret, firstSecret);
  });

  it("uses an environment override without replacing the stored generated secret", async () => {
    const { runtime } = await freshRuntime();
    const stored = await createConfiguration(runtime).authSecret();
    const override = "advanced-deployment-secret";

    assert.equal(
      await createConfiguration(runtime, { authSecret: override }).authSecret(),
      override,
    );
    assert.equal(await createConfiguration(runtime).authSecret(), stored);
    const persisted = await runtime.query<{ auth_secret: string }>(
      `select auth_secret from runtime_configuration`,
    );
    assert.equal(persisted.rows[0]?.auth_secret, stored);
    await runtime.close();
  });

  it("resolves the public URL from the effective port unless explicitly overridden", async () => {
    const { runtime } = await freshRuntime();

    assert.equal(
      await createConfiguration(runtime, {}, 4317).publicUrl(),
      "http://localhost:4317/",
    );
    assert.equal(
      await createConfiguration(
        runtime,
        { appUrl: "https://hub.example.test/base" },
        4317,
      ).publicUrl(),
      "https://hub.example.test/base",
    );
    await assert.rejects(
      async () => createConfiguration(runtime, { appUrl: "" }, 4317).publicUrl(),
      TypeError,
    );
    await runtime.close();
  });
});

async function freshRuntime() {
  const root = await mkdtemp(join(tmpdir(), "hub-runtime-configuration-"));
  roots.push(root);
  const bundle = await embeddedDatabaseRuntime(root);
  await bundle.runtime.migrate();
  return { runtime: bundle.runtime, root };
}

function createConfiguration(
  database: Awaited<ReturnType<typeof freshRuntime>>["runtime"],
  environment: { authSecret?: string; appUrl?: string } = {},
  effectivePort = 3000,
) {
  return createRuntimeConfiguration({ database, environment, effectivePort, randomBytes });
}
