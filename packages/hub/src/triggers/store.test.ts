import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { OrganizationTriggerStore } from "./store.js";

describe("organization trigger store", () => {
  it.each([
    [true, "devbox"],
    [false, "devbox"],
    [false, "daemon-00000000"],
  ] as const)(
    "creates and updates one hidden runtime (explicit mode: %s, Host: %s)",
    async (explicitMode, daemonReference) => {
      const database = createMemoryDatabase({ organizationIds: ["org"] });
      await database.issueEnrollmentToken({
        id: "token",
        verifier: "token-verifier",
        organizationId: "org",
        expiresAt: new Date("2026-08-29T22:00:00.000Z"),
        consumedAt: null,
      });
      await database.enrollDaemon({
        daemonId: "daemon-00000000",
        idempotencyKey: "daemon-key",
        suggestedSlug: "devbox",
        tokenVerifier: "token-verifier",
        serverId: "server",
        daemonPublicKey: "public-key",
        credentialVerifier: "credential-verifier",
        permissions: ["hub.execute"],
        now: new Date("2026-08-29T21:00:00.000Z"),
      });
      const store = new OrganizationTriggerStore(database, "org");
      const yaml = (enabled: boolean) =>
        explicitMode
          ? triggerYaml(enabled)
          : triggerYaml(enabled).replace("provider: test, mode: full-access", "provider: pi");
      const first = await store.save({
        yaml: yaml(true).replace("daemon: devbox", `daemon: ${daemonReference}`),
        userId: null,
      });
      const second = await store.save({
        triggerId: first.id,
        yaml: yaml(false).replace("daemon: devbox", `daemon: ${daemonReference}`),
        userId: null,
      });

      assert.equal(second.id, first.id);
      assert.equal(second.enabled, false);
      assert.equal((await database.listProjectsForOrganization("org")).length, 0);
      assert.equal((await store.activeRevision(second)).version, 2);
    },
  );

  it("fails validation before creating storage when the daemon is unknown", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const store = new OrganizationTriggerStore(database, "org");

    await assert.rejects(store.save({ yaml: triggerYaml(true), userId: null }), /daemon/u);
    assert.equal((await store.list()).length, 0);
    assert.equal((await database.listProjectsForOrganization("org")).length, 0);
  });

  it("rejects a relative working directory at the authoring boundary", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const store = new OrganizationTriggerStore(database, "org");
    const yaml = triggerYaml(true).replace("cwd: /workspace", "cwd: workspace");
    await assert.rejects(store.save({ yaml, userId: null }), /absolute path/iu);
  });
});

function triggerYaml(enabled: boolean): string {
  return `name: manual-task
enabled: ${String(enabled)}
on:
  manual.run: {}
run:
  target: { daemon: devbox, cwd: /workspace }
  agent: { provider: test, mode: full-access }
  prompt: Handle it
  max_runtime: 1h
  idle_timeout: 5m
`;
}
