import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createTestCredentialCipher } from "../credentials/test-utils.js";
import { createProviderApplicationStore } from "../provider-applications/index.js";
import { createDatabase } from "./pg.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "./runtime/index.js";

let bundle: DatabaseRuntimeBundle | undefined;
let root: string | undefined;

afterEach(async () => {
  await bundle?.runtime.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  bundle = undefined;
  root = undefined;
});

it("stores Channel credentials only in encrypted canonical Connection envelopes", async () => {
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
  const telegram = await database.configureTelegramConnection({
    organizationId: "org",
    accountId: "support",
    botToken: telegramToken,
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
});
