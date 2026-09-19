import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import {
  insertTestSlackConnection,
  TEST_SLACK_CONNECTION_ID,
  TEST_SLACK_TEAM_ID,
} from "../test-utils/channel-identity.js";
import { formatChannelAccountResourceId } from "./contract.js";
import { AccessPolicyError, AccessStore } from "./store.js";

const ACCOUNT = {
  organizationId: "org",
  connectionId: TEST_SLACK_CONNECTION_ID,
  channel: "slack",
  accountId: "support",
};

it("lets channel-managing roles and account managers change a Channel Route, and nobody else", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-account-management-"));
  const { runtime } = await embeddedDatabaseRuntime(root);
  try {
    await runtime.migrate();
    const db = runtime.drizzle();
    await db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org" });
    const people = ["owner", "admin", "member", "manager"] as const;
    await db
      .insert(schema.users)
      .values(people.map((id) => ({ id, name: id, email: `${id}@example.test` })));
    await db.insert(schema.members).values(
      people.map((id) => ({
        id: `${id}-membership`,
        organizationId: "org",
        userId: id,
        role: id === "owner" || id === "admin" ? id : "member",
      })),
    );
    await insertTestSlackConnection(db, { organizationId: "org" });
    await db.insert(schema.channelIdentities).values(
      people.map((id) => ({
        organizationId: "org",
        memberId: `${id}-membership`,
        identityRealm: `slack:${TEST_SLACK_TEAM_ID}`,
        connectionId: TEST_SLACK_CONNECTION_ID,
        externalSubjectId: `U${id.toUpperCase()}`,
        verificationMethod: "channel_challenge" as const,
        verifiedAt: new Date(),
      })),
    );
    await db.insert(schema.accessAssignments).values({
      organizationId: "org",
      subjectKind: "member",
      subjectId: "manager-membership",
      resourceKind: "channel_account",
      resourceId: formatChannelAccountResourceId("slack", "support"),
      privileges: ["channel.use", "channel.manage"],
      constraints: { conversation: { kind: "all" } },
    });
    const access = new AccessStore(runtime);
    const manages = (sender: string) =>
      access.authorizeChannelAccountManagement({ ...ACCOUNT, senderIdentity: `slack:${sender}` });

    assert.deepEqual(await manages("UOWNER"), {
      membershipId: "owner-membership",
      userId: "owner",
    });
    assert.deepEqual(await manages("UADMIN"), {
      membershipId: "admin-membership",
      userId: "admin",
    });
    assert.deepEqual(await manages("UMANAGER"), {
      membershipId: "manager-membership",
      userId: "manager",
    });
    assert.equal(await manages("UMEMBER"), undefined);
    assert.equal(await manages("UGUEST"), undefined);
    assert.equal(
      await access.authorizeChannelAccountManagement({
        ...ACCOUNT,
        accountId: "other",
        senderIdentity: "slack:UMANAGER",
      }),
      undefined,
    );

    await assert.rejects(
      access.saveAssignments(
        "org",
        [
          {
            subjectKind: "member",
            subjectId: "member-membership",
            resourceKind: "channel_account",
            resourceId: formatChannelAccountResourceId("slack", "support"),
            privileges: ["channel.manage"],
            constraints: { conversation: { kind: "specific", conversationIds: ["C1"] } },
          },
        ],
        "owner",
      ),
      (error: unknown) =>
        error instanceof AccessPolicyError && /All conversations/u.test(error.message),
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
