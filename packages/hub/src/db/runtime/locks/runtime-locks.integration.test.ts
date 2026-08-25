import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, it } from "vitest";
import { embeddedDatabaseRuntime, postgresDatabaseRuntime } from "../index.js";
import type { DatabaseRuntimeBundle } from "../index.js";

describe("database runtime locks", () => {
  it("serializes concurrent embedded callers holding the same key", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-embedded-locks-"));
    const bundle = await embeddedDatabaseRuntime(join(root, "database"));
    try {
      await assertSameKeySerializes(bundle);
    } finally {
      await bundle.runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent Postgres callers holding the same key", async () => {
    const postgres = await new PostgreSqlContainer("postgres:17-alpine").start();
    const bundle = await postgresDatabaseRuntime(postgres.getConnectionUri());
    try {
      await assertSameKeySerializes(bundle);
    } finally {
      await bundle.runtime.close();
      await postgres.stop();
    }
  }, 120_000);
});

async function assertSameKeySerializes(bundle: DatabaseRuntimeBundle): Promise<void> {
  const events: string[] = [];
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = bundle.locks.withLock("shared", async () => {
    events.push("first:start");
    firstEntered();
    await release;
    events.push("first:end");
  });
  await entered;
  const second = bundle.locks.withLock("shared", async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
}
