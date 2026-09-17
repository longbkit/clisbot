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
import { AccessStore, type ChannelPrivilegeRequest } from "./store.js";

it("diagnoses unlinked senders separately from missing grants without bypassing Connection scope", async () => {
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
    const input: ChannelPrivilegeRequest = {
      organizationId: "org",
      connectionId: TEST_SLACK_CONNECTION_ID,
      channel: "slack",
      accountId: "support",
      senderIdentity: "slack:UOWNER",
      privilege: "channel.use",
      conversation: { kind: "channel", id: "C1", rootConversationId: "C1" },
    };
    const unlinked = {
      allowed: false,
      reason: "sender identity is not linked to a Hub Member on this Connection",
    };
    assert.deepEqual(await access.authorizeChannelPrivilege(input), unlinked);
    assert.equal(await access.allowsChannelPrivilege(input), false);
    await db.insert(schema.channelIdentities).values([
      {
        organizationId: "org",
        memberId: "owner-membership",
        identityRealm: "slack:T1",
        connectionId: TEST_SLACK_CONNECTION_ID,
        externalSubjectId: "UOWNER",
        verificationMethod: "channel_challenge",
        verifiedAt: new Date(),
      },
      {
        organizationId: "org",
        memberId: "member-membership",
        identityRealm: "slack:T1",
        connectionId: TEST_SLACK_CONNECTION_ID,
        externalSubjectId: "UMEMBER",
        verificationMethod: "channel_challenge",
        verifiedAt: new Date(),
      },
    ]);
    assert.deepEqual(await access.authorizeChannelPrivilege(input), { allowed: true });
    assert.deepEqual(
      await access.authorizeChannelPrivilege({ ...input, connectionId: sameWorkspace }),
      { allowed: true },
      "one link resolves on every bot in the workspace",
    );
    assert.deepEqual(
      await access.authorizeChannelPrivilege({ ...input, connectionId: otherWorkspace }),
      unlinked,
      "the same user id in another workspace is not the same person",
    );
    assert.deepEqual(
      await access.authorizeChannelPrivilege({ ...input, connectionId: "another-connection" }),
      unlinked,
    );
    assert.deepEqual(
      await access.authorizeChannelPrivilege({ ...input, organizationId: "another-org" }),
      unlinked,
    );
    const memberInput = { ...input, senderIdentity: "slack:UMEMBER" };
    const missingAccess = {
      allowed: false,
      reason: "linked Hub Member does not have access to this conversation",
    };
    assert.deepEqual(await access.authorizeChannelPrivilege(memberInput), missingAccess);
    await db.insert(schema.accessAssignments).values({
      organizationId: "org",
      subjectKind: "member",
      subjectId: "member-membership",
      resourceKind: "channel_account",
      resourceId: "slack/support",
      privileges: ["channel.use"],
      constraints: { conversation: { kind: "specific", conversationIds: ["C1"] } },
    });
    assert.deepEqual(await access.authorizeChannelPrivilege(memberInput), { allowed: true });
    assert.deepEqual(
      await access.authorizeChannelPrivilege({
        ...memberInput,
        conversation: { kind: "channel", id: "C2", rootConversationId: "C2" },
      }),
      missingAccess,
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
