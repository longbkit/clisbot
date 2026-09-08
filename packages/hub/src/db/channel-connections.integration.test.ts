import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createProviderApplicationStore } from "../provider-applications/index.js";
import { createDatabase } from "./pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "./runtime/index.js";

const PROBED_AT = "2026-09-07T00:00:00.000Z";

let bundle: DatabaseRuntimeBundle | undefined;
let root: string | undefined;

afterEach(async () => {
  await bundle?.runtime.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  bundle = undefined;
  root = undefined;
});

/** Booting PGlite and replaying all 77 migrations outgrows the 30s default
 * on a loaded box; the same reason `migrations.test.ts` sets its own. */
const PGLITE_TEST_TIMEOUT_MS = 120_000;

it(
  "stores Channel credentials only in encrypted canonical Connection envelopes",
  async () => {
    root = await mkdtemp(join(tmpdir(), "hub-channel-connections-"));
    bundle = await embeddedDatabaseRuntime(root);
    await bundle.runtime.migrate();
    await bundle.runtime.query(
      `insert into organization (id, name, slug) values ('org', 'Org', 'org')`,
    );
    await bundle.runtime.query(
      `insert into "user" (id, name, email, email_verified)
       values ('operator', 'Operator', 'operator@example.test', true)`,
    );
    const cipher = createTestCredentialCipher();
    const database = createDatabase(bundle.runtime, bundle.locks, cipher);

    const telegramToken = "telegram-secret-canary";
    const telegram = await database.configureChannelConnection({
      organizationId: "org",
      channel: "telegram",
      accountId: "support",
      credentials: { botToken: telegramToken },
    });
    const telegramRaw = await bundle.runtime.query<{ envelope: string }>(
      `select credential_envelope::text as envelope from telegram_connections where id = $1`,
      [telegram.connectionId],
    );
    assert.equal(telegramRaw.rows[0]?.envelope.includes(telegramToken), false);
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "telegram",
        connectionId: telegram.connectionId,
      }),
      { botToken: telegramToken },
    );

    // Discord: the Channel plane's own bot-token Connection owner, on the same
    // envelope service and resolved through the same `resolveChannelConnection`.
    const discordToken = "discord-secret-canary";
    const discord = await database.configureChannelConnection({
      organizationId: "org",
      channel: "discord",
      accountId: "guild",
      credentials: { botToken: discordToken },
      identity: { id: "1180000000000000009", username: "fusion-bot", probedAt: PROBED_AT },
    });
    const discordRaw = await bundle.runtime.query<{ envelope: string; identity: string }>(
      `select credential_envelope::text as envelope, external_identity::text as identity
       from discord_bot_connections where id = $1`,
      [discord.connectionId],
    );
    assert.equal(discordRaw.rows[0]?.envelope.includes(discordToken), false);
    assert.deepEqual(JSON.parse(discordRaw.rows[0]?.identity ?? "null"), {
      id: "1180000000000000009",
      username: "fusion-bot",
      probedAt: PROBED_AT,
    });
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "discord",
        connectionId: discord.connectionId,
      }),
      { botToken: discordToken },
    );
    // Each channel's Connection ids live in their own table: a Telegram id never
    // resolves as Discord, and another organization never resolves either.
    assert.equal(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "discord",
        connectionId: telegram.connectionId,
      }),
      undefined,
    );
    assert.equal(
      await database.resolveChannelConnection({
        organizationId: "other",
        channel: "discord",
        connectionId: discord.connectionId,
      }),
      undefined,
    );
    // Re-adding the same account rotates the credential in place.
    const rotated = await database.configureChannelConnection({
      organizationId: "org",
      channel: "discord",
      accountId: "guild",
      credentials: { botToken: "discord-rotated-canary" },
    });
    assert.equal(rotated.connectionId, discord.connectionId);
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "discord",
        connectionId: discord.connectionId,
      }),
      { botToken: "discord-rotated-canary" },
    );

    const store = createProviderApplicationStore(bundle.runtime, bundle.locks, cipher, database);
    const slackAppToken = "xapp-slack-secret-canary";
    const slackBotToken = "xoxb-slack-secret-canary";
    await store.completeSlackSocketApplication({
      configuration: {
        provider: "slack",
        transport: "socket",
        appId: "A1",
        appToken: slackAppToken,
      },
      identity: { provider: "slack", id: "A1", name: "A1" },
      expectedVersion: undefined,
      updatedByUserId: "operator",
      organizationId: "org",
      installation: {
        appId: "A1",
        teamId: "T1",
        teamName: "Team",
        botUserId: "U1",
        botAccessToken: slackBotToken,
        scopes: ["app_mentions:read", "chat:write"],
      },
    });
    const slackRaw = await bundle.runtime.query<{
      id: string;
      connection_envelope: string;
      application_envelope: string;
    }>(
      `select c.id::text, c.credential_envelope::text as connection_envelope,
            a.configuration_envelope::text as application_envelope
       from slack_connections c
       join runtime_provider_configuration a
         on a.provider = 'slack' and a.provider_application_id = c.provider_application_id
      where c.provider_application_id = 'A1' and c.team_id = 'T1'`,
    );
    const slackRow = slackRaw.rows[0];
    assert.ok(slackRow !== undefined);
    assert.equal(slackRow.connection_envelope.includes(slackBotToken), false);
    assert.equal(slackRow.application_envelope.includes(slackAppToken), false);
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "slack",
        connectionId: slackRow.id,
      }),
      {
        botToken: slackBotToken,
        appToken: slackAppToken,
        providerApplicationId: "A1",
      },
    );
  },
  PGLITE_TEST_TIMEOUT_MS,
);

/** Seal a value the way the Hub did before the connection envelope bound the
 * organization (`credential-cipher.ts` v1: AAD version 1, owner without the
 * organization). Reads must still accept it. */
function sealV1(owner: string, value: unknown): string {
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`paseo-hub:credential:1:${owner}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: "test-key",
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
  });
}

it(
  "reads a v1 connection envelope and refuses a v2 row moved to another organization",
  async () => {
    root = await mkdtemp(join(tmpdir(), "hub-channel-connection-aad-"));
    bundle = await embeddedDatabaseRuntime(root);
    await bundle.runtime.migrate();
    for (const id of ["org", "other"]) {
      await bundle.runtime.query(`insert into organization (id, name, slug) values ($1, $1, $1)`, [
        id,
      ]);
    }
    const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());

    // A pre-migration row: sealed under the v1 owner, no organization in the AAD.
    const legacyId = "11111111-1111-4111-8111-111111111111";
    await bundle.runtime.query(
      `insert into telegram_connections (id, organization_id, account_id, credential_envelope)
       values ($1, 'org', 'legacy', $2::jsonb)`,
      [legacyId, sealV1(`telegram-connection:${legacyId}`, { botToken: "legacy-canary" })],
    );
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "telegram",
        connectionId: legacyId,
      }),
      { botToken: "legacy-canary" },
    );

    // A v2 row: writing it re-seals under the organization-bound owner, so the
    // same ciphertext under another organization no longer authenticates.
    const fresh = await database.configureChannelConnection({
      organizationId: "org",
      channel: "telegram",
      accountId: "support",
      credentials: { botToken: "fresh-canary" },
    });
    const envelope = await bundle.runtime.query<{ envelope: string }>(
      `select credential_envelope::text as envelope from telegram_connections where id = $1`,
      [fresh.connectionId],
    );
    assert.equal(JSON.parse(envelope.rows[0]?.envelope ?? "{}").version, 2);
    const movedId = "22222222-2222-4222-8222-222222222222";
    await bundle.runtime.query(
      `insert into telegram_connections (id, organization_id, account_id, credential_envelope)
       values ($1, 'other', 'support', $2::jsonb)`,
      [movedId, envelope.rows[0]?.envelope],
    );
    await assert.rejects(
      database.resolveChannelConnection({
        organizationId: "other",
        channel: "telegram",
        connectionId: movedId,
      }),
      /authentication failed/u,
    );
  },
  PGLITE_TEST_TIMEOUT_MS,
);
