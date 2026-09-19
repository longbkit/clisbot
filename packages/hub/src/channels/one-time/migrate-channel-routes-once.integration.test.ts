import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountFileSchema } from "../config/schema.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import { migrateChannelRoutesOnce } from "./migrate-channel-routes-once.js";

const ORG = "org-once";
const ORG_WITHOUT_CHANNELS = "org-no-channels";
const ACCOUNT_FILE = ".paseo/channels/slack/work.yml";

// The old shape on every axis: `match` + one-value `audience`, and an enabled catch-all.
const LEGACY_ACCOUNT = `channel: slack
accountId: work
connectionId: c1
transport: { mode: socket }
routes:
  - agent: eng
    match: { kind: channel, ids: [C_ENG] }
  - agent: support
    match: { kind: channel, ids: [C_SUPPORT] }
fallback:
  agent: cheap
  audience: { kind: members }
`;

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;

async function seed(): Promise<void> {
  const db = bundle.runtime;
  for (const id of [ORG, ORG_WITHOUT_CHANNELS]) {
    await db.query(`insert into organization (id, name, slug) values ($1, $1, $1)`, [id]);
  }
  const revisions: string[] = [];
  for (const version of [1, 2]) {
    const inserted = await db.query<{ id: string }>(
      `insert into channel_configuration_revisions (organization_id, version, files, content_hash)
       values ($1, $2, $3, 'old') returning id`,
      [ORG, version, JSON.stringify([{ path: ACCOUNT_FILE, content: LEGACY_ACCOUNT }])],
    );
    revisions.push(inserted.rows[0]!.id);
  }
  await db.query(
    `insert into organization_channel_configurations (organization_id, active_revision_id)
     values ($1, $2)`,
    [ORG, revisions[1]],
  );
  await db.query(
    `insert into access_assignments
       (organization_id, subject_kind, subject_id, resource_kind, resource_id, privileges, constraints)
     values ($1, 'member', 'm1', 'channel_account', 'slack/work', '["channel.use"]', '{"conversation":{"kind":"all"}}'),
            ($1, 'member', 'm2', 'channel_account', 'slack/work', '["channel.use","channel.manage"]', '{"conversation":{"kind":"all"}}'),
            ($1, 'member', 'm3', 'channel_account', 'slack/work', '["channel.use"]', '{}'),
            ($2, 'member', 'm4', 'channel_account', 'slack/other', '["channel.use"]', '{}')`,
    [ORG, ORG_WITHOUT_CHANNELS],
  );
  await db.query(
    `insert into thread_bindings
       (organization_id, channel, account_id, external_conversation_id, external_thread_id,
        status, agent_id, resolved_at, initiator, route)
     values ($1, 'slack', 'work', 'D1', null, 'bound', 'agent-1', now(), 'slack:U1', $2)`,
    [
      ORG,
      JSON.stringify({
        selection: { revisionId: revisions[0], position: "fallback", fingerprint: "f" },
      }),
    ],
  );
}

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-routes-once-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await seed();
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("migrateChannelRoutesOnce", () => {
  it("writes nothing on a dry run", async () => {
    const result = await migrateChannelRoutesOnce(bundle.runtime, {
      apply: false,
      dumpPath: join(dataDirectory, "unused.json"),
    });

    expect(result.organizations).toEqual([
      {
        organizationId: ORG,
        accounts: 1,
        catchAllsBecomingRoutes: 1,
        grantsFolded: 2,
        revisionsDeleted: 1,
        review: ["1 channel.use grant(s) grant nothing today and are retired unfolded"],
      },
    ]);
    expect(result.leftovers["fallbackBindings"]).toBe(1);
  });

  it("leaves no old shape anywhere after --apply", async () => {
    const dumpPath = join(dataDirectory, "dump.json");
    const result = await migrateChannelRoutesOnce(bundle.runtime, { apply: true, dumpPath });

    expect(Object.values(result.leftovers).every((n) => n === 0)).toBe(true);
    expect(JSON.parse(await readFile(dumpPath, "utf8"))).toHaveProperty("thread_bindings");

    const db = bundle.runtime;
    const revision = await db.query<{ id: string; files: { content: string }[] }>(
      `select id, files from channel_configuration_revisions where organization_id = $1`,
      [ORG],
    );
    expect(revision.rows).toHaveLength(1);
    const account = AccountFileSchema.parse(load(revision.rows[0]!.files[0]!.content));
    const routes = account.routes ?? [];
    expect(account).not.toHaveProperty("fallback");
    expect(routes.map((route) => route.agent)).toEqual(["eng", "support", "cheap"]);
    // The grants widen Who only: Route 1 keeps #eng, Route 2 keeps #support.
    expect(routes[0]!.audience).toContainEqual({
      who: { members: ["m1"] },
      where: { conversations: ["C_ENG"] },
    });
    expect(routes[1]!.audience).not.toContainEqual({
      who: { members: ["m1"] },
      where: { conversations: ["C_ENG"] },
    });

    const binding = await db.query<{
      route: { selection: { position: number; revisionId: string } };
    }>(`select route from thread_bindings where organization_id = $1`, [ORG]);
    expect(binding.rows[0]!.route.selection).toMatchObject({
      position: 2,
      revisionId: revision.rows[0]!.id,
    });

    // Folded or not, every channel.use is gone; the Admin row keeps Admin.
    const grants = await db.query<{ subject_id: string; privileges: string[] }>(
      `select subject_id, privileges from access_assignments`,
    );
    expect(grants.rows).toEqual([{ subject_id: "m2", privileges: ["channel.manage"] }]);
  });
});
