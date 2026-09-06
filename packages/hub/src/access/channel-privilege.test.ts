import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
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
    const access = new AccessStore(runtime);
    const input: ChannelPrivilegeRequest = {
      organizationId: "org",
      connectionId: "slack-connection",
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
        connectionId: "slack-connection",
        externalSubjectId: "UOWNER",
        verificationMethod: "channel_challenge",
        verifiedAt: new Date(),
      },
      {
        organizationId: "org",
        memberId: "member-membership",
        connectionId: "slack-connection",
        externalSubjectId: "UMEMBER",
        verificationMethod: "channel_challenge",
        verifiedAt: new Date(),
      },
    ]);
    assert.deepEqual(await access.authorizeChannelPrivilege(input), { allowed: true });
    assert.deepEqual(
      await access.authorizeChannelPrivilege({ ...input, connectionId: "another-workspace" }),
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
