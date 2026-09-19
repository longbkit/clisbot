// The start-time migration on the memory database: old-shape routes and
// `channel.use` grants become audience rules in one new revision, the folded
// grant rows go, and a second run changes nothing.
import assert from "node:assert/strict";
import { load } from "js-yaml";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import type { ChannelUseGrant, ChannelUseGrantSource } from "./access-grants.js";
import { migrateChannelAudiences } from "./access-migration.js";
import { AccountFileSchema } from "./config/schema.js";

const ORG = "org";
const PATH = ".paseo/channels/slack/work.yml";
const OLD_FILE = `channel: slack
accountId: work
connectionId: connection
transport: { mode: socket }
routes:
  - match: { kind: channel, ids: [C0QC], contains: "#qc" }
    agent: worker
    environment: repo
  - match: { kind: dm }
    audience: { kind: conversationParticipants }
    agent: worker
    environment: repo
fallback:
  workflow: triage
`;

function grantSource(
  initial: ChannelUseGrant[],
): ChannelUseGrantSource & { rows: ChannelUseGrant[] } {
  const rows = [...initial];
  return {
    rows,
    listChannelUseGrants: async (organizationId) =>
      rows.filter((row) => row.organizationId === organizationId),
    deleteGrants: async (ids) => {
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
}

function grant(input: Partial<ChannelUseGrant> & { id: string }): ChannelUseGrant {
  return {
    organizationId: ORG,
    subjectKind: "member",
    subjectId: "m-1",
    channel: "slack",
    accountId: "work",
    conversation: { kind: "all" },
    ...input,
  };
}

const logger = { warn: () => undefined, info: () => undefined, debug: () => undefined };

describe("channel audience migration", () => {
  it("folds grants and old-shape routes into rules, deletes the grants, and is idempotent", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "u",
          organizationId: ORG,
          organizationName: "Org",
          organizationSlug: "org",
          membershipId: "m-1",
          role: "owner",
        },
      ],
    });
    const first = await database.saveChannelConfiguration({
      organizationId: ORG,
      files: [
        { path: PATH, content: OLD_FILE },
        { path: ".paseo/hub.yml", content: "agents: {}\n" },
      ],
      contentHash: "old",
      createdByUserId: null,
    });
    const grants = grantSource([
      grant({ id: "g-all" }),
      grant({
        id: "g-team",
        subjectKind: "team",
        subjectId: "qc",
        conversation: { kind: "specific", conversationIds: ["C0PRIVATE"] },
      }),
      grant({
        id: "g-public",
        subjectKind: "guest",
        subjectId: "guest",
        conversation: { kind: "public_channels" },
      }),
      grant({ id: "g-other-account", accountId: "other" }),
    ]);

    const results = await migrateChannelAudiences({ database, grants, logger });
    assert.deepEqual(results, [
      {
        organizationId: ORG,
        accounts: 1,
        routes: 3,
        grants: 3,
        revisionId: results[0]?.revisionId,
      },
    ]);
    const active = await database.findActiveChannelConfiguration(ORG);
    assert.notEqual(active?.id, first.id);
    const file = active?.files.find(({ path }) => path === PATH);
    assert.ok(file !== undefined && file.content.startsWith("# Rewritten by the Hub on start"));
    assert.ok(
      active?.files.some(({ path }) => path === ".paseo/hub.yml"),
      "other files survive",
    );
    const account = AccountFileSchema.parse(load(file.content));
    const folded = [
      { who: { members: ["m-1"] }, where: { dm: true, groups: "all" } },
      { who: { teams: ["qc"] }, where: { conversations: ["C0PRIVATE"] } },
      { who: { anyone: true }, where: { groups: "public" } },
    ];
    assert.deepEqual(account.routes?.[0], {
      audience: [{ who: { roles: ["member"] }, where: { conversations: ["C0QC"] } }, ...folded],
      contains: "#qc",
      agent: "worker",
      environment: "repo",
    });
    assert.deepEqual(account.routes?.[1]?.audience, [
      { who: { anyone: true }, where: { dm: true } },
      ...folded,
    ]);
    assert.deepEqual(account.fallback, {
      workflow: "triage",
      audience: [{ who: { roles: ["member"] }, where: { dm: true, groups: "all" } }, ...folded],
    });
    // The grant on an account this configuration does not know stays.
    assert.deepEqual(
      grants.rows.map(({ id }) => id),
      ["g-other-account"],
    );

    // Idempotent: nothing old-shaped and no foldable grant → no new revision.
    grants.rows.length = 0;
    assert.deepEqual(await migrateChannelAudiences({ database, grants, logger }), []);
    assert.equal((await database.findActiveChannelConfiguration(ORG))?.id, active?.id);
  });

  it("leaves grants alone when the organization has no channel configuration", async () => {
    const database = createMemoryDatabase({
      memberships: [
        {
          userId: "u",
          organizationId: ORG,
          organizationName: "Org",
          organizationSlug: "org",
          membershipId: "m-1",
          role: "owner",
        },
      ],
    });
    const grants = grantSource([grant({ id: "g-all" })]);
    const warnings: string[] = [];
    await migrateChannelAudiences({
      database,
      grants,
      logger: { ...logger, warn: (m) => warnings.push(m) },
    });
    assert.equal(grants.rows.length, 1);
    assert.deepEqual(warnings, ["channel audience migration left grants without a configuration"]);
  });
});
