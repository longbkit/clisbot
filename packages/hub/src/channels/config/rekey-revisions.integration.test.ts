import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { HubBundleFile } from "../../config/bundle-contract.js";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../../db/runtime/index.js";
import { rekeyLegacyChannelRevisions } from "./rekey-revisions.js";
import { canonicalChannelRevision, validateChannelRevisionPaths } from "./revision-files.js";

const roots: string[] = [];
const runtimes: DatabaseRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("channel revision keys", () => {
  it("moves .paseo/ and .clisbot/ keys to the database-only layout once", async () => {
    const runtime = await freshRuntime();
    await insertRevision(runtime, 1, [
      { path: ".paseo/hub.yml", content: "agents: {}\n" },
      { path: ".paseo/channels/policy.yml", content: "enabled: true\n" },
      { path: ".paseo/channels/telegram/default.yml", content: "channel: telegram\n" },
    ]);
    await insertRevision(runtime, 2, [
      { path: ".clisbot/channels/slack/work.yml", content: "channel: slack\n" },
    ]);
    await insertRevision(runtime, 3, [{ path: "channels/policy.yml", content: "enabled: true\n" }]);

    assert.equal(await rekeyLegacyChannelRevisions(runtime), 2);

    const first = await revision(runtime, 1);
    assert.deepEqual(
      first.files.map(({ path }) => path),
      ["channels/policy.yml", "channels/telegram/default.yml", "hub.yml"],
    );
    assert.doesNotThrow(() => validateChannelRevisionPaths(first.files));
    assert.equal(first.contentHash, canonicalChannelRevision(first.files).contentHash);
    assert.deepEqual(
      (await revision(runtime, 2)).files.map(({ path }) => path),
      ["channels/slack/work.yml"],
    );
    assert.equal(await rekeyLegacyChannelRevisions(runtime), 0);
  });
});

async function insertRevision(
  runtime: DatabaseRuntime,
  version: number,
  files: HubBundleFile[],
): Promise<void> {
  await runtime.query(
    `insert into channel_configuration_revisions (organization_id, version, files, content_hash)
     values ('org', $1, $2::jsonb, 'legacy-hash')`,
    [version, JSON.stringify(files)],
  );
}

async function revision(
  runtime: DatabaseRuntime,
  version: number,
): Promise<{ files: HubBundleFile[]; contentHash: string }> {
  const result = await runtime.query<{ files: HubBundleFile[]; content_hash: string }>(
    `select files, content_hash from channel_configuration_revisions where version = $1`,
    [version],
  );
  const row = result.rows[0];
  assert.ok(row !== undefined);
  return { files: row.files, contentHash: row.content_hash };
}

async function freshRuntime(): Promise<DatabaseRuntime> {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-revision-keys-"));
  roots.push(root);
  const { runtime } = await embeddedDatabaseRuntime(root);
  runtimes.push(runtime);
  await runtime.migrate();
  await runtime.query(`insert into organization (id, name, slug) values ('org', 'Org', 'org')`);
  return runtime;
}
