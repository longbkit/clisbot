#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HUB_DIRECTORY_NAME = "hub";

// PostgreSQL/PGlite owns these entries. `channels/` and the lock are the other
// Hub-owned entries in a shared Clisbot home. Keep this allowlist explicit: a
// migration must never guess that an unfamiliar user/daemon file belongs to Hub.
export const LEGACY_HUB_ENTRIES = Object.freeze([
  ".paseo-hub.lock",
  "PG_VERSION",
  "backup_label",
  "backup_label.old",
  "backup_manifest",
  "base",
  "channels",
  "current_logfiles",
  "global",
  "log",
  "pg_commit_ts",
  "pg_dynshmem",
  "pg_hba.conf",
  "pg_ident.conf",
  "pg_filenode.map",
  "pg_logical",
  "pg_multixact",
  "pg_notify",
  "pg_replslot",
  "pg_serial",
  "pg_snapshots",
  "pg_stat",
  "pg_stat_tmp",
  "pg_subtrans",
  "pg_tblspc",
  "pg_twophase",
  "pg_wal",
  "pg_xact",
  "postgresql.auto.conf",
  "postgresql.conf",
  "postmaster.opts",
  "postmaster.pid",
  "recovery.signal",
  "standby.signal",
  "tablespace_map",
]);

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function assertHubStopped(home, isRunning) {
  const lockPath = join(home, ".paseo-hub.lock");
  if (!existsSync(lockPath)) return;
  let owner;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new Error(`Cannot read the legacy Hub lock: ${lockPath}`);
  }
  if (isRunning(owner?.pid)) {
    throw new Error(`Hub is still running with PID ${owner.pid}; stop it before migrating`);
  }
}

export async function migrateDevHubData(selectedHome, { isRunning = processIsRunning } = {}) {
  if (!isAbsolute(selectedHome)) throw new Error("--home must be an absolute path");
  const home = resolve(selectedHome);
  if (basename(home) === HUB_DIRECTORY_NAME) {
    throw new Error("--home must name the Clisbot home, not its hub child");
  }

  const legacyMarker = join(home, "PG_VERSION");
  const target = join(home, HUB_DIRECTORY_NAME);
  if (!existsSync(legacyMarker)) {
    if (existsSync(join(target, "PG_VERSION"))) {
      return { action: "already_migrated", home, target, moved: [] };
    }
    throw new Error(`No legacy PGlite database found at ${legacyMarker}`);
  }
  await assertHubStopped(home, isRunning);

  if (existsSync(target)) {
    const targetEntries = await readdir(target);
    if (targetEntries.length > 0) {
      throw new Error(`Migration target is not empty: ${target}`);
    }
    await rmdir(target);
  }

  const moved = LEGACY_HUB_ENTRIES.filter((entry) => existsSync(join(home, entry)));
  const staging = join(home, `.hub-migration-${process.pid}-${Date.now()}`);
  await mkdir(staging, { mode: 0o700 });
  const completed = [];
  try {
    for (const entry of moved) {
      await rename(join(home, entry), join(staging, entry));
      completed.push(entry);
    }
    await rename(staging, target);
  } catch (error) {
    for (const entry of completed.reverse()) {
      if (existsSync(join(staging, entry))) {
        await rename(join(staging, entry), join(home, entry));
      }
    }
    if (existsSync(staging)) await rmdir(staging).catch(() => undefined);
    throw new Error("Hub data migration failed and moved entries were rolled back", {
      cause: error,
    });
  }
  return { action: "migrated", home, target, moved };
}

function parseHome(argv) {
  const index = argv.indexOf("--home");
  const home = index >= 0 ? argv[index + 1] : undefined;
  if (!home || argv.length !== 2 || index !== 0) {
    throw new Error("usage: node scripts/migrate-dev-hub-data.mjs --home /absolute/clisbot-home");
  }
  return home;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await migrateDevHubData(parseHome(process.argv.slice(2)));
    if (result.action === "already_migrated") {
      console.log(`Hub data is already grouped under ${result.target}`);
    } else {
      console.log(`Moved ${result.moved.length} Hub-owned entries into ${result.target}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
