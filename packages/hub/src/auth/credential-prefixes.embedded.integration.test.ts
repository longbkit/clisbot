import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import { OrganizationApiKeys } from "./api-keys.js";
import { hasCliCredential, OrganizationCliCredentials } from "./cli-credentials.js";

const roots: string[] = [];
const bundles: DatabaseRuntimeBundle[] = [];

afterEach(async () => {
  await Promise.all(bundles.splice(0).map(({ runtime }) => runtime.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Credentials issued before the 2026-09-29 rebrand carry the `paseo_` prefixes
// and live in client files and CI secrets the Hub cannot rewrite.
describe("pre-rebrand credential prefixes", () => {
  it("keeps a paseo_pk_ API key authenticating", async () => {
    const { runtime, locks } = await freshBundle();
    const token = "paseo_pk_AbCdEf123456_legacy-secret";
    await runtime.query(
      `insert into organization_api_keys (id, organization_id, name, prefix, verifier, scopes)
       values ($1, 'org', 'legacy', 'paseo_pk_AbCdEf123456', $2, $3)`,
      [randomUUID(), verifier(token), ["runs:dispatch"]],
    );
    const apiKeys = new OrganizationApiKeys(runtime, locks);

    assert.equal((await apiKeys.authorize(bearer(token), "runs:dispatch")).status, "authorized");
    assert.equal(
      (await apiKeys.authorize(bearer(`${token}-wrong`), "runs:dispatch")).status,
      "unauthorized",
    );
  });

  it("keeps a paseo_cli_ credential authenticating and routed as a CLI credential", async () => {
    const { runtime } = await freshBundle();
    const token = "paseo_cli_JTq93WY-3anL_legacy-secret";
    await runtime.query(
      `insert into organization_cli_credentials (id, organization_id, prefix, verifier)
       values ($1, 'org', 'paseo_cli_JTq93WY-3anL', $2)`,
      [randomUUID(), verifier(token)],
    );
    const cliCredentials = new OrganizationCliCredentials(runtime);

    assert.equal(hasCliCredential(`Bearer ${token}`), true);
    assert.equal(hasCliCredential("Bearer paseo_pk_AbCdEf123456_x"), false);
    assert.equal(
      (await cliCredentials.authorize(bearer(token), "runs:dispatch")).status,
      "authorized",
    );
  });
});

async function freshBundle(): Promise<DatabaseRuntimeBundle> {
  const root = await mkdtemp(join(tmpdir(), "hub-credential-prefixes-"));
  roots.push(root);
  const bundle = await embeddedDatabaseRuntime(root);
  bundles.push(bundle);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ('org', 'Org', 'org')`,
  );
  return bundle;
}

function verifier(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function bearer(token: string): Request {
  return new Request("http://hub.test/api", { headers: { authorization: `Bearer ${token}` } });
}
