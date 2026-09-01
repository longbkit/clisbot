import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { OrganizationTriggerStore } from "./store.js";

describe("organization trigger store", () => {
  it("creates and updates one hidden runtime without exposing a project", async () => {
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
    const first = await store.save({ yaml: triggerYaml(true), userId: null });
    const second = await store.save({
      triggerId: first.id,
      yaml: triggerYaml(false),
      userId: null,
    });

    assert.equal(second.id, first.id);
    assert.equal(second.runtimeProjectId, first.runtimeProjectId);
    assert.equal(second.enabled, false);
    assert.equal((await database.listProjectsForOrganization("org")).length, 0);
    assert.equal((await store.activeRevision(second)).version, 2);
  });

  it("fails validation before creating storage when the daemon is unknown", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const store = new OrganizationTriggerStore(database, "org");

    await assert.rejects(store.save({ yaml: triggerYaml(true), userId: null }), /daemon/u);
    assert.equal((await store.list()).length, 0);
    assert.equal((await database.listProjectsForOrganization("org")).length, 0);
  });

  it.each([
    ["a relative working directory", "cwd: workspace", /absolute path/iu],
    ["an omitted execution mode", "provider: test, mode: full-access", /mode.*required/iu],
  ])("rejects %s at the authoring boundary", async (_name, authored, expected) => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const store = new OrganizationTriggerStore(database, "org");
    const yaml = triggerYaml(true).replace(
      authored === "cwd: workspace" ? "cwd: /workspace" : authored,
      authored === "cwd: workspace" ? authored : "provider: test",
    );

    await assert.rejects(store.save({ yaml, userId: null }), expected);
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
