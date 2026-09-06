import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import { createDatabase } from "../db/pg.js";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../test-utils/project-configuration.js";
import * as schema from "../db/schema.js";
import { AccessStore } from "./store.js";
import { RESOURCE_ACCESS_LEVELS } from "./contract.js";

it("compiles explicit Project creation authority without widening existing grants or workspace.manage", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-workspace-create-"));
  const bundle = await embeddedDatabaseRuntime(root);
  try {
    await bundle.runtime.migrate();
    const db = bundle.runtime.drizzle();
    await db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org" });
    await db.insert(schema.users).values([
      { id: "owner", name: "Owner", email: "owner@example.test" },
      { id: "member", name: "Member", email: "member@example.test" },
    ]);
    await db.insert(schema.members).values([
      { id: "owner-membership", organizationId: "org", userId: "owner", role: "owner" },
      { id: "membership", organizationId: "org", userId: "member", role: "member" },
    ]);
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
    const access = new AccessStore(bundle.runtime);
    await access.saveAssignment(
      "org",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "daemon",
        resourceId: TEST_DAEMON_ID,
        privileges: ["daemon.connect"],
        constraints: {},
      },
      "owner",
    );
    const grant = {
      subjectKind: "member" as const,
      subjectId: "membership",
      resourceKind: "project" as const,
      resourceId: project!.id,
      constraints: {},
    };
    await access.saveAssignment(
      "org",
      { ...grant, privileges: ["project.use", "terminal.use"] },
      "owner",
    );
    const input = {
      organizationId: "org",
      daemonId: TEST_DAEMON_ID,
      membershipId: "membership",
      userId: "member",
    };
    const old = await access.resolveDaemonAccess(input);
    expect(old?.projects[0]?.privileges).not.toContain("workspace.create");
    expect(RESOURCE_ACCESS_LEVELS.project.office_worker).not.toContain("workspace.create");
    expect(RESOURCE_ACCESS_LEVELS.project.developer).toContain("workspace.create");
    expect(RESOURCE_ACCESS_LEVELS.project.full_access).toContain("workspace.create");
    await access.saveAssignment(
      "org",
      { ...grant, privileges: ["project.use", "workspace.create"] },
      "owner",
    );
    const updated = await access.resolveDaemonAccess(input);
    expect(updated?.resourceMode).toBe("projects");
    expect(updated?.projects).toEqual([
      expect.objectContaining({
        projectId: "project-a",
        privileges: expect.arrayContaining(["project.use", "workspace.create"]),
      }),
    ]);
    expect(updated?.permissions).not.toContain("workspace.manage");
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
