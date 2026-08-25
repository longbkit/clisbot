import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { createActiveProjectConfiguration } from "../test-utils/project-configuration.js";
import { ProjectConfigurationStore } from "../configuration/store.js";
import { dump } from "js-yaml";
import { configurationBundleFixture } from "../test-utils/configuration-bundle.js";
import { enrollTestDaemon, TEST_DAEMON_SLUG } from "../test-utils/project-configuration.js";

const validConfig = {
  environments: [{ name: "production", kind: "daemon", daemon: TEST_DAEMON_SLUG, cwd: "/repo" }],
  triggers: [
    {
      name: "run",
      on: "manual.run",
      max_runtime: "1h",
      steps: [
        {
          id: "work",
          environment: "production",
          max_runtime: "10m",
          idle_timeout: "1m",
          agent: { provider: "test" },
          prompt: [{ text: "Run" }],
        },
      ],
    },
  ],
};

describe("project configuration lifecycle", () => {
  it("activates immutable revisions and rolls back within one project", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database, "organization-a");
    const {
      project,
      revision: first,
      store,
    } = await createActiveProjectConfiguration(database, validConfig, {
      organizationId: "organization-a",
    });
    const second = await store.insertManualBundleRevision({
      files: configurationBundleFixture(dump(validConfig)),
      userId: "operator",
    });

    await store.activate(second.id);
    const rolledBack = await store.rollback();

    assert.equal((await database.findActiveProjectConfiguration(project.id))?.id, first.id);
    assert.equal(rolledBack.revision.id, first.id);
  });

  it("rejects invalid and cross-project activation", async () => {
    const database = createMemoryDatabase();
    await enrollTestDaemon(database, "organization-a");
    const projectA = await createActiveProjectConfiguration(database, validConfig, {
      organizationId: "organization-a",
    });
    const projectB = await createActiveProjectConfiguration(database, validConfig, {
      organizationId: "organization-a",
    });
    assert.throws(
      () => configurationBundleFixture(dump({ environments: [], triggers: "invalid" })),
      /environments and triggers/u,
    );
    await assert.rejects(
      new ProjectConfigurationStore(database, projectA.project.id).activate(projectB.revision.id),
      /configuration revision not found/u,
    );
  });
});
