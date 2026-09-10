import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import * as schema from "../db/schema.js";
import { AccessStore, type ChannelPrivilegeRequest } from "./store.js";

// Locks the shared resolve-access core against drift: identical grants for one
// Member on one Project must yield the same privilege decision whether the
// channel adapter (resolveChannelAgentAccess, reached via authorizeChannelPrivilege)
// or the app adapter (resolveDaemonAccess) asks.
it("channel and app adapters agree on the privilege decision for the same Member and Project", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-resolve-parity-"));
  const bundle = await embeddedDatabaseRuntime(root);
  try {
    await bundle.runtime.migrate();
    const db = bundle.runtime.drizzle();
    await db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org" });
    await db.insert(schema.users).values({ id: "member", name: "Member", email: "m@example.test" });
    await db
      .insert(schema.members)
      .values({ id: "membership", organizationId: "org", userId: "member", role: "member" });
    const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
    await enrollTestDaemon(database, "org");
    const [project] = await db
      .insert(schema.daemonProjects)
      .values({
        organizationId: "org",
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-a",
        name: "Project A",
      })
      .returning();
    await db.insert(schema.channelIdentities).values({
      organizationId: "org",
      memberId: "membership",
      connectionId: "slack-connection",
      externalSubjectId: "UMEMBER",
      verificationMethod: "administrator",
      verifiedAt: new Date(),
    });
    await db.insert(schema.accessAssignments).values([
      {
        organizationId: "org",
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "channel_account",
        resourceId: "slack/support",
        privileges: ["channel.use"],
        constraints: { conversation: { kind: "specific", conversationIds: ["C1"] } },
      },
      {
        organizationId: "org",
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "daemon",
        resourceId: TEST_DAEMON_ID,
        privileges: ["daemon.connect"],
        constraints: {},
      },
      {
        organizationId: "org",
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "project",
        resourceId: project!.id,
        privileges: ["project.use", "agent.interact"],
        constraints: {},
      },
    ]);

    const access = new AccessStore(bundle.runtime);
    const channelInput: ChannelPrivilegeRequest = {
      organizationId: "org",
      connectionId: "slack-connection",
      channel: "slack",
      accountId: "support",
      senderIdentity: "slack:UMEMBER",
      privilege: "channel.use",
      conversation: { kind: "channel", id: "C1", rootConversationId: "C1" },
      daemonReference: TEST_DAEMON_ID,
      projectId: "project-a",
    };

    const appAccess = await access.resolveDaemonAccess({
      organizationId: "org",
      daemonId: TEST_DAEMON_ID,
      userId: "member",
      membershipId: "membership",
    });
    assert.ok(appAccess !== undefined, "app adapter resolved access");
    assert.equal(appAccess.owner, false);
    const appProject = appAccess.projects.find((entry) => entry.projectId === "project-a");
    assert.ok(appProject !== undefined, "app adapter exposed the granted Project");

    // Same grants, both adapters: granted privilege allowed, ungranted refused.
    for (const privilege of ["agent.interact", "agent.create"] as const) {
      const channelAllowed = (
        await access.authorizeChannelPrivilege({ ...channelInput, privilege })
      ).allowed;
      const appAllowed = appProject.privileges.includes(privilege);
      assert.equal(
        channelAllowed,
        appAllowed,
        `adapters disagree on ${privilege}: channel=${channelAllowed} app=${appAllowed}`,
      );
    }
    // And the decision is the expected one (agent.interact granted, agent.create not).
    assert.equal(appProject.privileges.includes("agent.interact"), true);
    assert.equal(appProject.privileges.includes("agent.create"), false);
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
