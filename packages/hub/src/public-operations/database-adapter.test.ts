import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { enrollTestDaemon } from "../test-utils/project-configuration.js";
import { OrganizationTriggerStore } from "../triggers/store.js";
import { createDatabasePublicOperationRepository } from "./database-adapter.js";

describe("public manual-run workflow resolution", () => {
  it("resolves an enabled organization workflow", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await enrollTestDaemon(database, "org");
    const workflow = await new OrganizationTriggerStore(database, "org").save({
      yaml: triggerYaml(true),
      userId: null,
    });
    const repository = createDatabasePublicOperationRepository(database);

    assert.deepEqual(
      await repository.resolveManualRunWorkflow("org", "deploy"),
      {
        status: "resolved",
        id: workflow.id,
        revisionId: workflow.activeRevisionId,
      },
    );
    assert.equal(
      await repository.resolveManualRunWorkflow("org", "missing"),
      undefined,
    );
  });

  it("does not resolve a disabled organization workflow", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await enrollTestDaemon(database, "org");
    await new OrganizationTriggerStore(database, "org").save({
      yaml: triggerYaml(false),
      userId: null,
    });

    assert.deepEqual(
      await createDatabasePublicOperationRepository(
        database,
      ).resolveManualRunWorkflow("org", "deploy"),
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
