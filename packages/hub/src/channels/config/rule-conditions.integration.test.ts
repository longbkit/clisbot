// The upgrade that moves a Route's conditions onto its rules
// (docs/audits/2026-10-05-routes-and-rules.md#migration).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, describe, it } from "vitest";
import type { HubBundleFile } from "../../config/bundle-contract.js";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../../db/runtime/index.js";
import { canonicalChannelRevision } from "./revision-files.js";
import { moveRouteConditionsToRules, moveStoredRouteConditions } from "./rule-conditions.js";
import { AccountFileSchema } from "./schema.js";

const roots: string[] = [];
const runtimes: DatabaseRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const HEADER =
  "channel: slack\naccountId: work\nconnectionId: connection-id\ntransport: { mode: socket }\n";

/** The account file a migration leaves, parsed by the schema the Hub reads now. */
function migrated(routes: string) {
  const content = moveRouteConditionsToRules(`${HEADER}routes:\n${routes}`);
  assert.ok(content !== undefined, "the file changed");
  return AccountFileSchema.parse(load(content)).routes ?? [];
}

describe("moving Route conditions onto rules", () => {
  it("puts the Route's conditions on every rule and removes them from the Route", () => {
    const [route] = migrated(`  - audience:
      - { who: { roles: [member] }, where: { conversations: [C1] } }
      - { who: { anyone: true }, where: { groups: public } }
    contains: deploy
    interaction: { requireMention: true, followUp: { mode: auto, ttlMinutes: 30 }, whenBusy: queue }
    agent: worker
    environment: repo
`);
    assert.ok(route !== undefined);
    for (const rule of route.audience) {
      assert.deepEqual(rule.interaction, {
        requireMention: true,
        followUp: { mode: "auto", ttlMinutes: 30 },
      });
      assert.equal(rule.contains, "deploy");
    }
    // What happens once a message is in stays on the Route.
    assert.deepEqual(route.interaction, { whenBusy: "queue" });
  });

  it("keeps a leaf the rule already authored over the Route's", () => {
    const [route] = migrated(`  - audience:
      - who: { roles: [member] }
        where: { conversations: [C1] }
        interaction: { requireMention: false, followUp: { ttlMinutes: 5 } }
        contains: own
    contains: route
    interaction: { requireMention: true, followUp: { mode: auto, ttlMinutes: 30 } }
    agent: worker
    environment: repo
`);
    const rule = route?.audience[0];
    assert.deepEqual(rule?.interaction, {
      requireMention: false,
      followUp: { mode: "auto", ttlMinutes: 5 },
    });
    assert.equal(rule?.contains, "own");
    assert.equal(route?.interaction, undefined);
  });

  it("answers a DM-only rule without a mention, as the docs always said", () => {
    const [route] = migrated(`  - audience:
      - { who: { roles: [owner] }, where: { dm: true } }
      - { who: { roles: [member] }, where: { dmMembers: [m1] } }
      - { who: { roles: [member] }, where: { dm: true, groups: all } }
    interaction: { requireMention: true }
    agent: worker
    environment: repo
`);
    const [dm, named, mixed] = route?.audience ?? [];
    assert.equal(dm?.interaction?.requireMention, false);
    assert.equal(named?.interaction?.requireMention, false);
    // A rule over DMs and group chats keeps the Route's mention for both.
    assert.equal(mixed?.interaction?.requireMention, true);
  });

  it("leaves a Route that set no conditions alone, so a later save never changes on a reboot", () => {
    // The shape a rule saved after the upgrade has: it inherits the defaults.
    const content = `${HEADER}routes:
  - audience: [{ who: { roles: [owner] }, where: { dm: true } }]
    agent: worker
    environment: repo
`;
    assert.equal(moveRouteConditionsToRules(content), undefined);
  });

  it("decides DM-only rules only on a Route that set requireMention", () => {
    const [route] = migrated(`  - audience: [{ who: { roles: [owner] }, where: { dm: true } }]
    contains: deploy
    agent: worker
    environment: repo
`);
    // The Route set no mention, so the rule keeps inheriting it.
    assert.equal(route?.audience[0]?.interaction, undefined);
    assert.equal(route?.audience[0]?.contains, "deploy");
  });

  it("leaves a Route still in the shape before rules for the one-time conversion", () => {
    const content = `${HEADER}routes:
  - match: { kind: channel, ids: [C1] }
    audience: { kind: members }
    contains: deploy
    interaction: { requireMention: true }
    agent: worker
    environment: repo
`;
    assert.equal(moveRouteConditionsToRules(content), undefined);
  });

  it("leaves a file with nothing to move byte for byte", () => {
    const content = `${HEADER}routes:
  - audience: [{ who: { roles: [member] }, where: { groups: all }, interaction: { requireMention: true } }]
    agent: worker
    environment: repo
`;
    assert.equal(moveRouteConditionsToRules(content), undefined);
    assert.equal(moveRouteConditionsToRules(HEADER), undefined);
  });

  it("rewrites every stored revision once, with its hash", async () => {
    const runtime = await freshRuntime();
    const old: HubBundleFile[] = [
      { path: "channels/policy.yml", content: "enabled: true\n" },
      {
        path: "channels/slack/work.yml",
        content: `${HEADER}routes:
  - audience: [{ who: { roles: [member] }, where: { groups: all } }]
    contains: deploy
    agent: worker
    environment: repo
`,
      },
    ];
    await insertRevision(runtime, 1, old);
    await insertRevision(runtime, 2, [old[0]!]);
    // A broken historical revision is reported and left; it never stops the boot.
    await insertRevision(runtime, 3, [
      { path: "channels/slack/work.yml", content: "routes: [contains: {unclosed\n" },
    ]);

    const first = await moveStoredRouteConditions(runtime);
    assert.equal(first.moved, 1);
    assert.equal(first.unreadable.length, 1);
    const stored = await revision(runtime, 1);
    const account = AccountFileSchema.parse(
      load(stored.files.find(({ path }) => path === "channels/slack/work.yml")!.content),
    );
    assert.equal(account.routes?.[0]?.audience[0]?.contains, "deploy");
    assert.equal(stored.contentHash, canonicalChannelRevision(stored.files).contentHash);
    const second = await moveStoredRouteConditions(runtime);
    assert.equal(second.moved, 0, "a second run finds nothing");
  });
});

async function insertRevision(
  runtime: DatabaseRuntime,
  version: number,
  files: HubBundleFile[],
): Promise<void> {
  await runtime.query(
    `insert into channel_configuration_revisions (organization_id, version, files, content_hash)
     values ('org', $1, $2::jsonb, 'old-hash')`,
    [version, JSON.stringify(files)],
  );
}

async function revision(
  runtime: DatabaseRuntime,
  version: number,
): Promise<{ files: HubBundleFile[]; contentHash: string }> {
  const result = await runtime.query<{ files: HubBundleFile[]; content_hash: string }>(
    `select files, content_hash from channel_configuration_revisions where version = $1`,
    [version],
  );
  const row = result.rows[0];
  assert.ok(row !== undefined);
  return { files: row.files, contentHash: row.content_hash };
}

async function freshRuntime(): Promise<DatabaseRuntime> {
  const root = await mkdtemp(join(tmpdir(), "hub-rule-conditions-"));
  roots.push(root);
  const { runtime } = await embeddedDatabaseRuntime(root);
  runtimes.push(runtime);
  await runtime.migrate();
  await runtime.query(`insert into organization (id, name, slug) values ('org', 'Org', 'org')`);
  return runtime;
}
