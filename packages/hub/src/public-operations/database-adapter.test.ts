import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon } from "../test-utils/project-configuration.js";
import { OrganizationTriggerStore } from "../triggers/store.js";
import { createDatabasePublicOperationRepository } from "./database-adapter.js";

describe("public manual-run project resolution", () => {
  it("prefers an organization trigger runtime and retains the legacy project fallback", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await enrollTestDaemon(database, "org");
    const legacy = await database.createProject({
      organizationId: "org",
      name: "Default",
      slug: "default",
      createdByUserId: null,
    });
    const trigger = await new OrganizationTriggerStore(database, "org").save({
      yaml: triggerYaml(true),
      userId: null,
    });
    const repository = createDatabasePublicOperationRepository(database);

    assert.deepEqual(await repository.resolveManualRunProject("org", "deploy", "default"), {
      status: "resolved",
      id: trigger.runtimeProjectId,
    });
    assert.deepEqual(await repository.resolveManualRunProject("org", "legacy", "default"), {
      status: "resolved",
      id: legacy.id,
    });
  });

  it("does not fall through to a legacy project when the organization trigger is disabled", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await enrollTestDaemon(database, "org");
    await database.createProject({
      organizationId: "org",
      name: "Default",
      slug: "default",
      createdByUserId: null,
    });
    await new OrganizationTriggerStore(database, "org").save({
      yaml: triggerYaml(false),
      userId: null,
    });

    assert.deepEqual(
      await createDatabasePublicOperationRepository(database).resolveManualRunProject(
        "org",
        "deploy",
        "default",
      ),
      { status: "disabled" },
    );
  });
});

function triggerYaml(enabled: boolean): string {
  return `name: deploy
enabled: ${String(enabled)}
on:
  manual.run: {}
run:
  target: { daemon: daemon-10000000, cwd: /workspace }
  agent: { provider: test, mode: full-access }
  prompt: Handle it
`;
}
