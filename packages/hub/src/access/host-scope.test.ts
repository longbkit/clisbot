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

it("fans a Host grant out to every Project and lets a Project grant only add to it", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-host-scope-"));
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
    const projects = await db
      .insert(schema.daemonProjects)
      .values([
        {
          organizationId: "org",
          daemonId: TEST_DAEMON_ID,
          externalProjectId: "project-a",
          name: "Project A",
        },
        {
          organizationId: "org",
          daemonId: TEST_DAEMON_ID,
          externalProjectId: "project-b",
          name: "Project B",
        },
        // A Project the daemon stopped reporting. Availability is inventory, not
        // authority, so a grant that names it still resolves.
        {
          organizationId: "org",
          daemonId: TEST_DAEMON_ID,
          externalProjectId: "project-gone",
          name: "Project Gone",
          available: false,
        },
      ])
      .returning();
    const access = new AccessStore(bundle.runtime);
    await access.saveAssignment(
      "org",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "daemon",
        resourceId: TEST_DAEMON_ID,
        privileges: [...RESOURCE_ACCESS_LEVELS.daemon.developer],
        constraints: {
          agentConfigurations: [
            { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" },
          ],
        },
      },
      "owner",
    );
    const input = {
      organizationId: "org",
      daemonId: TEST_DAEMON_ID,
      membershipId: "membership",
      userId: "member",
    };
    const hostOnly = await access.resolveDaemonAccess(input);
    // Not `daemon.manage`: the Agent constraint still has a place to be checked.
    expect(hostOnly?.resourceMode).toBe("projects");
    expect(hostOnly?.projects.map(({ projectId }) => projectId).sort()).toEqual([
      "project-a",
      "project-b",
      "project-gone",
    ]);
    for (const project of hostOnly?.projects ?? []) {
      expect(project.privileges).toEqual(
        expect.arrayContaining(["project.use", "workspace.create"]),
      );
      expect(project.agentConfigurations).toEqual([
        { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" },
      ]);
    }

    await access.saveAssignment(
      "org",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "project",
        resourceId: projects[0]!.id,
        privileges: ["project.use", "agent.create"],
        constraints: {
          agentConfigurations: [{ providerId: "claude", modelIds: "*", thinkingOptionIds: "*" }],
        },
      },
      "owner",
    );
    const combined = await access.resolveDaemonAccess(input);
    const projectA = combined?.projects.find(({ projectId }) => projectId === "project-a");
    const projectB = combined?.projects.find(({ projectId }) => projectId === "project-b");
    // Grants combine by union: the Project grant widens Project A and leaves
    // Project B on the Host grant alone. It cannot narrow either.
    expect(projectA?.agentConfigurations).toEqual([
      { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" },
      { providerId: "claude", modelIds: "*", thinkingOptionIds: "*" },
    ]);
    expect(projectB?.agentConfigurations).toEqual([
      { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" },
    ]);
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("requires Agent choices wherever agent.create is granted", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-host-scope-validation-"));
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
    const access = new AccessStore(bundle.runtime);
    await expect(
      access.saveAssignment(
        "org",
        {
          subjectKind: "member",
          subjectId: "membership",
          resourceKind: "daemon",
          resourceId: TEST_DAEMON_ID,
          privileges: ["daemon.connect", "project.use", "agent.create"],
          constraints: {},
        },
        "owner",
      ),
    ).rejects.toThrow("agent.create requires at least one Agent configuration");
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("offers the Host the catalog of a Project the daemon still reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-host-catalog-"));
  const bundle = await embeddedDatabaseRuntime(root);
  try {
    await bundle.runtime.migrate();
    const db = bundle.runtime.drizzle();
    await db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org" });
    await db.insert(schema.users).values({ id: "owner", name: "Owner", email: "o@example.test" });
    await db
      .insert(schema.members)
      .values({ id: "owner-membership", organizationId: "org", userId: "owner", role: "owner" });
    const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
    await enrollTestDaemon(database, "org");
    const catalogOf = (providerId: string) => ({
      agentConfigurationCatalog: {
        providers: [{ id: providerId, label: providerId, models: [] }],
      },
    });
    await db.insert(schema.daemonProjects).values([
      // Listed first on purpose: a stale row must not win just by being first.
      {
        organizationId: "org",
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-gone",
        name: "Project Gone",
        available: false,
        metadata: catalogOf("retired-provider"),
      },
      {
        organizationId: "org",
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-live",
        name: "Project Live",
        metadata: catalogOf("codex"),
      },
    ]);
    const access = new AccessStore(bundle.runtime);
    const host = (await access.listResources("org")).find(({ kind }) => kind === "daemon");
    expect(host?.agentConfigurationCatalog?.providers.map(({ id }) => id)).toEqual(["codex"]);
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("does not let a Project the daemon stopped reporting vouch for an attended Mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-host-stale-mode-"));
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
    // The last catalog this Project published called the Mode attended.
    const catalog = {
      agentConfigurationCatalog: {
        providers: [
          {
            id: "codex",
            label: "Codex",
            modes: [{ id: "auto", label: "Auto", isUnattended: false }],
            models: [],
          },
        ],
      },
    };
    await db.insert(schema.daemonProjects).values([
      {
        organizationId: "org",
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-live",
        name: "Live",
        metadata: catalog,
      },
      {
        organizationId: "org",
        daemonId: TEST_DAEMON_ID,
        externalProjectId: "project-gone",
        name: "Gone",
        available: false,
        metadata: catalog,
      },
    ]);
    const access = new AccessStore(bundle.runtime);
    // Without every approval leaf, delegation needs the catalog to call the Mode attended.
    await access.saveAssignment(
      "org",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "daemon",
        resourceId: TEST_DAEMON_ID,
        privileges: ["daemon.connect", ...RESOURCE_ACCESS_LEVELS.project.office_worker],
        constraints: {
          agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
        },
      },
      "owner",
    );
    const delegate = (projectId: string) =>
      access.assertCanDelegateAgentExecutions({
        organizationId: "org",
        userId: "member",
        membershipId: "membership",
        executions: [
          {
            daemonReference: TEST_DAEMON_ID,
            projectId,
            cwd: "/work",
            providerId: "codex",
            modeId: "auto",
            fastMode: false,
            requiredPrivileges: [],
          },
        ],
      });
    await expect(delegate("project-live")).resolves.toBeUndefined();
    await expect(delegate("project-gone")).rejects.toThrow("Access denied");
  } finally {
    await bundle.runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
