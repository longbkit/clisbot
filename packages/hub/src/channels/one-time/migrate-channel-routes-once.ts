// ONE-TIME: delete this folder once this has run on every Hub that holds data
// (dev, ai-cowork). docs/audits/2026-09-19-route-audience-rules.md#migration-one-time-then-deleted
//
// Stop the Hub first (an embedded database has one owner). Then:
//   node --import tsx src/channels/one-time/migrate-channel-routes-once.ts --data-dir <hub dir>
//   DATABASE_URL=postgres://… node --import tsx src/channels/one-time/migrate-channel-routes-once.ts
// It is a dry run unless `--apply` is passed. `--apply` writes a JSON dump of
// every row it may touch first, runs each organization in one transaction, then
// verifies that no stored row still carries an old shape and exits 1 if one does.

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";
import { z } from "zod";
import { CHANNELS_DIRECTORY, CHANNEL_POLICY_PATH } from "../../config/bundle-contract.js";
import { AccessConstraintsSchema } from "../../access/contract.js";
import {
  embeddedDatabaseRuntime,
  postgresDatabaseRuntime,
  type DatabaseRuntime,
  type QueryHandle,
} from "../../db/runtime/index.js";
import { AccountFileSchema } from "../config/schema.js";
import { convertAccountFile, type ChannelUseGrant } from "./route-shape.js";

const AccountKeySchema = z.looseObject({ channel: z.string(), accountId: z.string() });

interface StoredFile {
  path: string;
  content: string;
}

/** `<channel>/<accountId>` → the catch-all's new position; null = it was off. */
type FallbackPositions = Map<string, number | null>;

interface OrganizationPlan {
  organizationId: string;
  activeRevisionId: string;
  files: StoredFile[];
  fallbackPositions: FallbackPositions;
  foldedGrantIds: string[];
  deletedRevisions: number;
}

const DUMP_TABLES = [
  "channel_configuration_revisions",
  "organization_channel_configurations",
  "thread_bindings",
  "channel_reply_capabilities",
  "access_assignments",
  "agent_executions",
  "trigger_runs",
] as const;

async function planOrganization(
  db: QueryHandle,
  organizationId: string,
  activeRevisionId: string,
): Promise<OrganizationPlan> {
  const active = await db.query<{ files: StoredFile[] }>(
    `select files from channel_configuration_revisions where id = $1`,
    [activeRevisionId],
  );
  const grants = await channelUseGrants(db, organizationId);
  const fallbackPositions: FallbackPositions = new Map();
  const foldedGrantIds: string[] = [];
  const files = (active.rows[0]?.files ?? []).map((file) => {
    if (!file.path.startsWith(`${CHANNELS_DIRECTORY}/`) || file.path === CHANNEL_POLICY_PATH) {
      return file;
    }
    const raw: unknown = load(file.content);
    const { channel, accountId } = AccountKeySchema.parse(raw);
    const own = grants.filter((g) => g.channel === channel && g.accountId === accountId);
    const converted = convertAccountFile(raw, own);
    fallbackPositions.set(`${channel}/${accountId}`, converted.fallbackPosition ?? null);
    foldedGrantIds.push(...converted.foldedGrantIds);
    return { path: file.path, content: dump(converted.account, { lineWidth: -1 }) };
  });
  const others = await db.query<{ count: string }>(
    `select count(*)::text as count from channel_configuration_revisions
     where organization_id = $1 and id <> $2`,
    [organizationId, activeRevisionId],
  );
  return {
    organizationId,
    activeRevisionId,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    fallbackPositions,
    foldedGrantIds,
    deletedRevisions: Number(others.rows[0]?.count ?? 0),
  };
}

async function channelUseGrants(db: QueryHandle, organizationId: string) {
  const rows = await db.query<{
    id: string;
    subject_kind: ChannelUseGrant["subjectKind"];
    subject_id: string;
    resource_id: string;
    constraints: unknown;
  }>(
    `select id, subject_kind, subject_id, resource_id, constraints from access_assignments
     where organization_id = $1 and resource_kind = 'channel_account'
       and privileges ? 'channel.use'`,
    [organizationId],
  );
  return rows.rows.map((row): ChannelUseGrant => {
    const [channel = "", accountId = ""] = row.resource_id.split("/").map(decodeURIComponent);
    const constraints = AccessConstraintsSchema.safeParse(row.constraints);
    return {
      id: row.id,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      channel,
      accountId,
      conversation: constraints.success ? constraints.data.conversation : undefined,
    };
  });
}

async function applyPlan(db: QueryHandle, plan: OrganizationPlan): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify(plan.files)).digest("hex");
  await db.query(
    `update channel_configuration_revisions set files = $2, content_hash = $3 where id = $1`,
    [plan.activeRevisionId, JSON.stringify(plan.files), hash],
  );
  await db.query(
    `delete from channel_configuration_revisions where organization_id = $1 and id <> $2`,
    [plan.organizationId, plan.activeRevisionId],
  );
  await db.query(
    `update thread_bindings set route = jsonb_set(route, '{selection,revisionId}', to_jsonb($2::text))
     where organization_id = $1 and route ? 'selection'`,
    [plan.organizationId, plan.activeRevisionId],
  );
  for (const [key, position] of plan.fallbackPositions) {
    await remapFallback(db, plan.organizationId, key, position);
  }
  // Accounts gone from the configuration keep no Route to point at.
  await remapFallback(db, plan.organizationId, undefined, null);
  await retireChannelUse(db, plan.foldedGrantIds);
}

/** Every stored `"fallback"` position of one account (every account when
 * `key` is undefined) → the catch-all's new index, or dropped where there is
 * no catch-all to point at. */
async function remapFallback(
  db: QueryHandle,
  organizationId: string,
  key: string | undefined,
  position: number | null,
): Promise<void> {
  const [channel = null, accountId = null] = key?.split("/") ?? [];
  const args = [organizationId, channel, accountId, position];
  await db.query(
    `update thread_bindings set route = case when $4::int is null
       then route - 'selection'
       else jsonb_set(route, '{selection,position}', to_jsonb($4::int)) end
     where organization_id = $1 and ($2::text is null or channel = $2) and ($3::text is null or account_id = $3)
       and route->'selection'->>'position' = 'fallback'`,
    args,
  );
  for (const table of ["agent_executions", "trigger_runs"]) {
    await db.query(
      `update ${table} set output_context = case when $4::int is null
         then output_context #- '{channel,route_position}' #- '{channel,route_fingerprint}'
         else jsonb_set(output_context, '{channel,route_position}', to_jsonb($4::int)) end
       where organization_id = $1 and ($2::text is null or output_context->'channel'->>'name' = $2)
         and ($3::text is null or output_context->'channel'->>'account_id' = $3)
         and output_context->'channel'->>'route_position' = 'fallback'`,
      args,
    );
  }
  await db.query(
    `update audit_events set evidence = case when $4::int is null
       then evidence - 'routePosition'
       else jsonb_set(evidence, '{routePosition}', to_jsonb($4::int)) end
     where organization_id = $1 and ($2::text is null or evidence->>'channel' = $2)
       and ($3::text is null or evidence->>'accountId' = $3) and evidence->>'routePosition' = 'fallback'`,
    args,
  );
  await db.query(
    `delete from channel_reply_capabilities
     where organization_id = $1 and ($2::text is null or channel = $2) and ($3::text is null or account_id = $3)
       and route_position = 'fallback' and $4::int is null`,
    args,
  );
  await db.query(
    `update channel_reply_capabilities set route_position = $4::int::text
     where organization_id = $1 and ($2::text is null or channel = $2) and ($3::text is null or account_id = $3)
       and route_position = 'fallback' and $4::int is not null`,
    args,
  );
}

/** A Use-only row is deleted; an Admin row keeps `channel.manage`. */
async function retireChannelUse(db: QueryHandle, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `update access_assignments set privileges = privileges - 'channel.use' where id = any($1)`,
    [ids],
  );
  await db.query(
    `delete from access_assignments where id = any($1) and jsonb_array_length(privileges) = 0`,
    [ids],
  );
}

/** Every leftover of the old shapes, as named counts; all must be zero. */
async function leftovers(db: QueryHandle): Promise<Record<string, number>> {
  const count = async (sql: string) =>
    Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`)).rows[0]?.n);
  const revisions = await db.query<{ files: StoredFile[] }>(
    `select files from channel_configuration_revisions`,
  );
  const oldShapeFiles = revisions.rows
    .flatMap((row) => row.files)
    .filter(
      (file) => file.path.startsWith(`${CHANNELS_DIRECTORY}/`) && file.path !== CHANNEL_POLICY_PATH,
    )
    .filter((file) => !AccountFileSchema.safeParse(load(file.content)).success).length;
  return {
    oldShapeFiles,
    extraRevisions: await count(
      `channel_configuration_revisions r where not exists (select 1 from organization_channel_configurations c where c.active_revision_id = r.id)`,
    ),
    fallbackBindings: await count(
      `thread_bindings where route->'selection'->>'position' = 'fallback'`,
    ),
    fallbackExecutions: await count(
      `agent_executions where output_context->'channel'->>'route_position' = 'fallback'`,
    ),
    fallbackTriggerRuns: await count(
      `trigger_runs where output_context->'channel'->>'route_position' = 'fallback'`,
    ),
    fallbackCapabilities: await count(
      `channel_reply_capabilities where route_position = 'fallback'`,
    ),
    fallbackAuditEvents: await count(`audit_events where evidence->>'routePosition' = 'fallback'`),
    channelUseGrants: await count(`access_assignments where privileges ? 'channel.use'`),
  };
}

async function dumpTables(db: QueryHandle, path: string): Promise<void> {
  const tables: Record<string, unknown[]> = {};
  for (const table of DUMP_TABLES) tables[table] = (await db.query(`select * from ${table}`)).rows;
  tables["audit_events"] = (
    await db.query(`select * from audit_events where evidence ? 'routePosition'`)
  ).rows;
  await writeFile(path, JSON.stringify(tables));
}

export interface OnceResult {
  organizations: ReturnType<typeof summary>[];
  leftovers: Record<string, number>;
  dumpPath?: string;
}

/** Plan every organization; with `apply`, dump, rewrite, and re-count leftovers. */
export async function migrateChannelRoutesOnce(
  db: DatabaseRuntime,
  options: { apply: boolean; dumpPath: string },
): Promise<OnceResult> {
  const active = await db.query<{ organization_id: string; active_revision_id: string }>(
    `select organization_id, active_revision_id from organization_channel_configurations`,
  );
  const plans: OrganizationPlan[] = [];
  for (const row of active.rows) {
    plans.push(await planOrganization(db, row.organization_id, row.active_revision_id));
  }
  const organizations = plans.map(summary);
  if (!options.apply) return { organizations, leftovers: await leftovers(db) };
  await dumpTables(db, options.dumpPath);
  for (const plan of plans) await db.transaction((tx) => applyPlan(tx, plan));
  return { organizations, leftovers: await leftovers(db), dumpPath: options.dumpPath };
}

function summary(plan: OrganizationPlan) {
  return {
    organizationId: plan.organizationId,
    accounts: plan.fallbackPositions.size,
    catchAllsBecomingRoutes: [...plan.fallbackPositions.values()].filter((p) => p !== null).length,
    grantsFolded: plan.foldedGrantIds.length,
    revisionsDeleted: plan.deletedRevisions,
  };
}

async function openDatabase(argv: readonly string[]) {
  const url = process.env["DATABASE_URL"];
  if (url !== undefined && url.length > 0) return postgresDatabaseRuntime(url);
  const dataDir = argv.includes("--data-dir") ? argv[argv.indexOf("--data-dir") + 1] : undefined;
  return dataDir === undefined ? undefined : embeddedDatabaseRuntime(dataDir);
}

async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const bundle = await openDatabase(argv);
  if (bundle === undefined) {
    process.stderr.write("Set DATABASE_URL or pass --data-dir <hub data directory>.\n");
    return 2;
  }
  try {
    const result = await migrateChannelRoutesOnce(bundle.runtime, {
      apply,
      dumpPath: `/tmp/channel-routes-once-${String(Date.now())}.json`,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!apply) process.stdout.write("Dry run: nothing was written. Pass --apply to write.\n");
    return !apply || Object.values(result.leftovers).every((n) => n === 0) ? 0 : 1;
  } finally {
    await bundle.runtime.close();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
