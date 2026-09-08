import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "probe-0064-"));
const client = new PGlite(dir);
await client.waitReady;
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
console.log("count", migrations.length, "last", migrations.at(-1).folderMillis);
const CUT = 1788628357934; // 0064_tiny_lester
let applied = 0;
for (const m of migrations) {
  if (m.folderMillis > CUT) break;
  for (const s of m.sql) await client.exec(s);
  applied += 1;
}
console.log("applied", applied);
for (const t of [
  "thread_bindings",
  "delivery_ledger",
  "telegram_connections",
  "slack_connections",
  "channel_configuration_revisions",
  "provider_applications",
  "runtime_provider_configuration",
  "channel_identities",
  "organization",
]) {
  const r = await client.query(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
    [t],
  );
  console.log("#####", t, r.rows.length === 0 ? "(ABSENT)" : "");
  for (const c of r.rows)
    console.log("  ", c.column_name, c.data_type, c.is_nullable, c.column_default ?? "");
}
const cc = await client.query(
  `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid in ('thread_bindings'::regclass,'delivery_ledger'::regclass) order by conname`,
);
for (const c of cc.rows) console.log("CHK", c.conname, c.def);
await client.close();
await rm(dir, { recursive: true, force: true });
