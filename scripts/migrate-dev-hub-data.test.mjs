import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDevHubData } from "./migrate-dev-hub-data.mjs";

async function missing(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

test("moves only Hub-owned legacy entries under hub", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clisbot-hub-layout-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "base"));
  await mkdir(join(home, "channels"));
  await mkdir(join(home, "agents"));
  await writeFile(join(home, "PG_VERSION"), "17\n");
  await writeFile(join(home, "config.json"), "{}\n");

  const result = await migrateDevHubData(home);

  assert.equal(result.action, "migrated");
  await access(join(home, "hub", "PG_VERSION"));
  await access(join(home, "hub", "base"));
  await access(join(home, "hub", "channels"));
  await access(join(home, "agents"));
  await access(join(home, "config.json"));
  await missing(join(home, "PG_VERSION"));
});

test("refuses to move a database whose Hub lock owner is running", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clisbot-hub-running-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "PG_VERSION"), "17\n");
  await writeFile(join(home, ".paseo-hub.lock"), JSON.stringify({ pid: 42 }));

  await assert.rejects(
    migrateDevHubData(home, { isRunning: (pid) => pid === 42 }),
    /Hub is still running with PID 42/,
  );
  await access(join(home, "PG_VERSION"));
  await missing(join(home, "hub", "PG_VERSION"));
});

test("is idempotent after a completed migration", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clisbot-hub-migrated-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "hub"));
  await writeFile(join(home, "hub", "PG_VERSION"), "17\n");

  const result = await migrateDevHubData(home);
  assert.equal(result.action, "already_migrated");
  assert.deepEqual(result.moved, []);
});
