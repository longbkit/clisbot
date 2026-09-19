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
} from "../test-utils/channel-identity.js";
import { AccessStore } from "./store.js";

// Who a channel sender is: one link resolves on every bot of its identity realm
// and nowhere else. Whether they may talk is the Route's audience rules.
it("resolves a linked sender within its identity realm only", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-admission-"));
  const { runtime } = await embeddedDatabaseRuntime(root);
  try {
    await runtime.migrate();
    const db = runtime.drizzle();
    await db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org" });
    await db.insert(schema.users).values([
      { id: "owner", name: "Owner", email: "owner@example.test" },
      { id: "member", name: "Member", email: "member@example.test" },
    ]);
    await db.insert(schema.members).values([
      { id: "owner-membership", organizationId: "org", userId: "owner", role: "owner" },
      { id: "member-membership", organizationId: "org", userId: "member", role: "member" },
    ]);
    await insertTestSlackConnection(db, { organizationId: "org", teamId: "T1" });
    // A second bot in the same workspace, and a bot in an unrelated workspace.
    const sameWorkspace = await insertTestSlackConnection(db, {
      organizationId: "org",
      id: "00000000-0000-4000-8000-000000005101",
      teamId: "T1",
    });
    const otherWorkspace = await insertTestSlackConnection(db, {
      organizationId: "org",
      id: "00000000-0000-4000-8000-000000005102",
      teamId: "T2",
    });
    const access = new AccessStore(runtime);
    const input = {
      organizationId: "org",
      connectionId: TEST_SLACK_CONNECTION_ID,
      channel: "slack",
      senderIdentity: "slack:UOWNER",
    };
    assert.equal(await access.resolveChannelMember(input), undefined);
    await db.insert(schema.channelIdentities).values({
      organizationId: "org",
      memberId: "owner-membership",
      identityRealm: "slack:T1",
      connectionId: TEST_SLACK_CONNECTION_ID,
      externalSubjectId: "UOWNER",
      verificationMethod: "channel_challenge",
      verifiedAt: new Date(),
    });
    assert.equal((await access.resolveChannelMember(input))?.membershipId, "owner-membership");
    assert.equal(
      (await access.resolveChannelMember({ ...input, connectionId: sameWorkspace }))?.membershipId,
      "owner-membership",
      "one link resolves on every bot in the workspace",
    );
    for (const changed of [
      { connectionId: otherWorkspace },
      { connectionId: "another-connection" },
      { organizationId: "another-org" },
    ]) {
      assert.equal(
        await access.resolveChannelMember({ ...input, ...changed }),
        undefined,
        "the same user id elsewhere is not the same person",
      );
    }
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
