import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import * as schema from "../db/schema.js";
import {
  insertTestSlackConnection,
  TEST_SLACK_CONNECTION_ID,
  TEST_SLACK_TEAM_ID,
} from "../test-utils/channel-identity.js";
import { AccessStore, type ChannelPrivilegeRequest } from "./store.js";

it("Guest grants are explicit and separate from linked Member grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-guest-access-"));
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
    await insertTestSlackConnection(db, { organizationId: "org" });
    const access = new AccessStore(bundle.runtime);
    const input: ChannelPrivilegeRequest = {
      organizationId: "org",
      connectionId: TEST_SLACK_CONNECTION_ID,
      channel: "slack",
      accountId: "support",
      senderIdentity: "slack:UGUEST",
      privilege: "channel.use",
      conversation: { kind: "thread", id: "T1", rootConversationId: "C1", visibility: "public" },
      daemonReference: TEST_DAEMON_ID,
      projectId: "project-a",
    };
    // `channel.use` is not a grant: audience rules decide who reaches a Route.
    expect((await access.authorizeChannelPrivilege(input)).allowed).toBe(false);

    const guestDaemon = {
      subjectKind: "guest" as const,
      subjectId: "guest",
      resourceKind: "daemon" as const,
      resourceId: TEST_DAEMON_ID,
      privileges: ["daemon.connect" as const],
      constraints: {},
    };
    await expect(
      access.saveAssignment("org", { ...guestDaemon, subjectId: "somebody" }, "member"),
    ).rejects.toMatchObject({ code: "subject_unavailable" });
    const daemonGrant = await access.saveAssignment("org", guestDaemon, "member");
    const configurations = [
      { providerId: "codex", modelIds: ["model-a"], thinkingOptionIds: ["high"] },
    ];
    await access.saveAssignment(
      "org",
      {
        subjectKind: "guest",
        subjectId: "guest",
        resourceKind: "project",
        resourceId: project!.id,
        privileges: ["project.use", "agent.interact", "agent.create", "approval.file"],
        constraints: { agentConfigurations: configurations },
      },
      "member",
    );
    expect(
      (await access.authorizeChannelPrivilege({ ...input, privilege: "agent.interact" })).allowed,
    ).toBe(true);
    expect(
      (await access.authorizeChannelPrivilege({ ...input, privilege: "approval.config" })).allowed,
    ).toBe(false);
    expect(
      (
        await access.authorizeChannelPrivilege({
          ...input,
          privilege: "agent.interact",
          projectId: "other",
        })
      ).allowed,
    ).toBe(false);
    expect(await access.resolveChannelAgentConfigurations(input)).toEqual({
      unrestricted: false,
      agentConfigurations: configurations,
    });
    // Reaching a conversation is the Route's audience rules, not a grant: the
    // Project grant alone decides agent control once the sender is admitted.
    const otherConversation = {
      ...input,
      privilege: "agent.interact" as const,
      conversation: { kind: "channel" as const, id: "C2", rootConversationId: "C2" },
    };
    expect((await access.authorizeChannelPrivilege(otherConversation)).allowed).toBe(true);
    expect(await access.resolveChannelAgentConfigurations(otherConversation)).toEqual({
      unrestricted: false,
      agentConfigurations: configurations,
    });
    expect(
      await access.allowsChannelApproval({
        ...input,
        daemonReference: TEST_DAEMON_ID,
        projectId: "project-a",
        privilege: "approval.file",
      }),
    ).toBe(true);

    await db.insert(schema.channelIdentities).values({
      organizationId: "org",
      memberId: "membership",
      identityRealm: `slack:${TEST_SLACK_TEAM_ID}`,
      connectionId: TEST_SLACK_CONNECTION_ID,
      externalSubjectId: "ULINKED",
      verificationMethod: "administrator",
      verifiedAt: new Date(),
    });
    expect(
      (await access.authorizeChannelPrivilege({ ...input, senderIdentity: "slack:ULINKED" }))
        .allowed,
    ).toBe(false);
    expect(
      (
        await access.authorizeChannelPrivilege({
          ...input,
          senderIdentity: "slack:ULINKED",
          privilege: "agent.interact",
        })
      ).allowed,
    ).toBe(false);
    await db
      .delete(schema.accessAssignments)
      .where(eq(schema.accessAssignments.id, daemonGrant.id));
    expect(
      (await access.authorizeChannelPrivilege({ ...input, privilege: "agent.interact" })).allowed,
    ).toBe(false);
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
