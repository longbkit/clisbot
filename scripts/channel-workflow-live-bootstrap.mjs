#!/usr/bin/env node
// Provision the isolated live Channel -> Workflow E2E database.
//
// The daemon/home remains the normal dev fixture. Only the Hub database is
// fresh, so this exercises the current no-Project schema without mutating or
// trying to migrate the historical dev database.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { dump } from "js-yaml";
import { configureRuntimeRoot } from "../packages/hub/dist/runtime-files.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
configureRuntimeRoot(resolve(repoRoot, "packages/hub"));

const [{ createEmbeddedRuntime }, { createDatabase }, credentials, providerApplications, compiler] =
  await Promise.all([
    import("../packages/hub/dist/db/runtime/internal/embedded.js"),
    import("../packages/hub/dist/db/pg.js"),
    import("../packages/hub/dist/credentials/credential-cipher.js"),
    import("../packages/hub/dist/provider-applications/index.js"),
    import("../packages/hub/dist/config/compiler.js"),
  ]);

const devHome = process.env.CLISBOT_HOME ?? `${homedir()}/.clisbot-dev`;
const hubDataDir = process.env.PASEO_HUB_DATA_DIR;
const masterKeyFile = process.env.PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE;
if (!hubDataDir || !masterKeyFile) {
  throw new Error(
    "set PASEO_HUB_DATA_DIR and PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE for the isolated Hub DB",
  );
}

function fixture(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function envFileValue(name) {
  const direct = process.env[name];
  if (direct?.trim()) return direct.trim();
  const line = readFileSync(resolve(repoRoot, ".env"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function telegram(method, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  const body = await response.json();
  if (!body.ok)
    throw new Error(`Telegram ${method} failed: ${body.description ?? response.status}`);
  return body.result;
}

async function slackAuth(token) {
  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`Slack auth.test failed: ${body.error ?? response.status}`);
  return body;
}

const source = await createEmbeddedRuntime(devHome);
let organization;
let machine;
let daemon;
let slackApplicationId;
let entitlement;
try {
  organization = (await source.runtime.query("select * from organization limit 1")).rows[0];
  machine = (
    await source.runtime.query("select * from machines where source ->> 'kind' = 'daemon' limit 1")
  ).rows[0];
  daemon = (await source.runtime.query("select * from daemons where status = 'active' limit 1"))
    .rows[0];
  slackApplicationId = (
    await source.runtime.query(
      "select verified_external_identity ->> 'id' as id from runtime_provider_configuration where provider = 'slack' limit 1",
    )
  ).rows[0]?.id;
  entitlement = (await source.runtime.query("select * from organization_entitlements limit 1"))
    .rows[0];
} finally {
  await source.runtime.close();
}
if (!organization || !machine || !daemon || !slackApplicationId || !entitlement) {
  throw new Error(
    "the dev fixture is missing organization, daemon, entitlement, or Slack Application identity",
  );
}

const slackCredential = fixture(resolve(devHome, "secrets/slack--work"));
const telegramCredential = fixture(resolve(devHome, "secrets/telegram--work"));
const slackBotToken = slackCredential.botToken ?? slackCredential.token;
const slackAppToken = slackCredential.appToken;
const telegramBotToken = telegramCredential.botToken ?? telegramCredential.token;
if (!slackBotToken || !slackAppToken || !telegramBotToken) {
  throw new Error("the live Channel credential fixtures are incomplete");
}

const [slackBot, slackSender, telegramMaster] = await Promise.all([
  slackAuth(slackBotToken),
  slackAuth(envFileValue("SLACK_MCP_XOXP_TOKEN")),
  telegram("getMe", envFileValue("TELEGRAM_MASTER_BOT_TOKEN")),
]);

const target = await createEmbeddedRuntime(hubDataDir);
try {
  await target.runtime.migrate();
  const cipher = await credentials.readCredentialCipherEnvironment(
    { PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: masterKeyFile },
    { hubDataDirectory: hubDataDir },
  );
  const database = createDatabase(target.runtime, target.locks, cipher);
  const organizationId = organization.id;
  const operatorId = "channel-workflow-e2e-operator";

  await target.runtime.query(
    `insert into organization (id, name, slug, logo, created_at, metadata)
     values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
    [
      organization.id,
      organization.name,
      organization.slug,
      organization.logo,
      organization.created_at,
      organization.metadata,
    ],
  );

  const relationship = fixture(resolve(devHome, "hub-relationship.json"));
  const activeDaemonId =
    relationship.state === "active" ? relationship.relationship?.daemonId : undefined;
  const activeDaemon =
    activeDaemonId === undefined
      ? undefined
      : (await target.runtime.query("select id, slug from daemons where id = $1", [activeDaemonId]))
          .rows[0];
  const workflowDaemon = activeDaemon ?? { id: daemon.id, slug: daemon.slug };
  await target.runtime.query(
    `insert into "user" (id, name, email, email_verified, is_instance_operator)
     values ($1, 'Channel Workflow E2E', 'channel-workflow-e2e@example.test', true, true)
     on conflict (id) do nothing`,
    [operatorId],
  );
  await target.runtime.query(
    `insert into organization_entitlements
       (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (organization_id) do update set
       granted = excluded.granted, overrides = excluded.overrides,
       plan_id = excluded.plan_id, plan_version = excluded.plan_version,
       stamped_at = excluded.stamped_at, updated_at = excluded.updated_at`,
    [
      organizationId,
      entitlement.granted,
      entitlement.overrides,
      entitlement.plan_id,
      entitlement.plan_version,
      entitlement.stamped_at,
      entitlement.updated_at,
    ],
  );
  await target.runtime.query(
    `insert into machines
       (id, org_id, source, status, started_at, terminated_at, shutdown_reason,
        trigger_name, trigger_context, specs)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
    [
      machine.id,
      organizationId,
      machine.source,
      "alive",
      machine.started_at,
      null,
      null,
      machine.trigger_name,
      machine.trigger_context,
      machine.specs,
    ],
  );
  await target.runtime.query(
    `insert into daemons
       (id, idempotency_key, enrollment_verifier, slug, machine_id, organization_id,
        server_id, daemon_public_key, credential_verifier, scopes, status, presence,
        connected_at, disconnected_at, last_seen_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','offline',null,now(),now(),$11)
     on conflict (id) do nothing`,
    [
      daemon.id,
      daemon.idempotency_key,
      daemon.enrollment_verifier,
      daemon.slug,
      machine.id,
      organizationId,
      daemon.server_id,
      daemon.daemon_public_key,
      daemon.credential_verifier,
      daemon.scopes,
      daemon.created_at,
    ],
  );

  const appStore = providerApplications.createProviderApplicationStore(
    target.runtime,
    target.locks,
    cipher,
    database,
  );
  const existingSlackApplication = await appStore.read("slack", slackApplicationId);
  await appStore.completeSlackSocketApplication({
    configuration: {
      provider: "slack",
      transport: "socket",
      appId: slackApplicationId,
      appToken: slackAppToken,
    },
    identity: { provider: "slack", id: slackApplicationId, name: slackApplicationId },
    expectedVersion: existingSlackApplication?.version,
    updatedByUserId: operatorId,
    organizationId,
    installation: {
      appId: slackApplicationId,
      teamId: slackBot.team_id,
      teamName: slackBot.team,
      botUserId: slackBot.user_id,
      botAccessToken: slackBotToken,
      scopes: ["app_mentions:read", "chat:write"],
    },
  });
  const slackConnection = await database.findSlackConnectionForOrganization(
    organizationId,
    slackApplicationId,
    slackBot.team_id,
  );
  if (!slackConnection) throw new Error("Slack Connection was not persisted");
  const telegramConnection = await database.configureTelegramConnection({
    organizationId,
    accountId: "work",
    botToken: telegramBotToken,
  });

  const rawConfiguration = {
    environments: [
      {
        name: "work",
        kind: "daemon",
        daemon: workflowDaemon.slug,
        cwd: resolve(devHome, "workspace"),
      },
    ],
    triggers: [
      {
        name: "channel-live-e2e",
        on: "channel.message",
        max_runtime: "10m",
        filters: {
          from_users: [`slack:${slackSender.user_id}`, `telegram:${telegramMaster.id}`],
        },
        steps: [
          {
            id: "prepare",
            environment: "work",
            max_runtime: "5m",
            idle_timeout: "2m",
            agent: { provider: "codex", model: "gpt-5.6-luna" },
            prompt: [
              {
                text: "This is workflow step prepare. Read and remember the inbound request, answer briefly, then call the finish_execution MCP tool exactly once: ${{ paseo.prompt }}",
              },
            ],
            reuse: "binding",
            auto_archive: true,
          },
          {
            id: "reply",
            environment: "work",
            max_runtime: "5m",
            idle_timeout: "2m",
            agent: { provider: "codex", model: "gpt-5.6-luna" },
            prompt: [
              {
                text: "This is workflow step reply. Write exactly PONG-CHANNEL-WORKFLOW-E2E as assistant text, then call the finish_execution MCP tool exactly once. Write no other assistant text.",
              },
            ],
            allow_outputs: [
              { type: "slack.reply", max: 1 },
              { type: "telegram.reply", max: 1 },
            ],
            reuse: "steps.prepare",
            auto_archive: false,
          },
        ],
      },
    ],
  };
  const compiled = compiler.compileHubConfig(rawConfiguration);
  const normalizedConfiguration = {
    ...compiled,
    environments: compiled.environments.map((environment) =>
      environment.kind === "daemon" ? { ...environment, daemonId: workflowDaemon.id } : environment,
    ),
  };
  const existingWorkflow = (await database.listOrganizationTriggers(organizationId)).find(
    (candidate) => candidate.name === "channel-live-e2e",
  );
  const workflow = await database.saveOrganizationTrigger({
    organizationId,
    ...(existingWorkflow === undefined ? {} : { triggerId: existingWorkflow.id }),
    name: "channel-live-e2e",
    enabled: true,
    format: "legacy_multistep",
    yaml: dump(rawConfiguration.triggers[0], { noRefs: true, lineWidth: -1 }),
    normalizedConfiguration,
    contentHash: compiler.compiledConfigurationHash(normalizedConfiguration),
    sourceKind: "manual",
    sourceEvidence: { kind: "live_e2e", at: new Date().toISOString() },
    createdByUserId: operatorId,
    routes: [],
  });

  const hubYaml = dump(
    {
      environments: {
        work: {
          kind: "daemon",
          daemon: workflowDaemon.slug,
          cwd: resolve(devHome, "workspace"),
        },
      },
      agents: { "codex-e2e": { provider: "codex", model: "gpt-5.6-luna" } },
    },
    { noRefs: true, lineWidth: -1 },
  );
  const policyYaml = dump(
    {
      enabled: true,
      channels: { slack: { enabled: true }, telegram: { enabled: true } },
      roles: { operator: { grants: ["bot.interact"] } },
      assignments: [
        {
          identities: [`slack:${slackSender.user_id}`, `telegram:${telegramMaster.id}`],
          roles: ["operator"],
        },
      ],
      defaults: {
        interaction: { requireMention: true, followUp: { mode: "auto", ttlMinutes: 60 } },
        binding: { key: "thread" },
        reply: { anchor: "thread" },
        outbound: { path: "relay" },
        sync: { finalAnswers: true },
      },
    },
    { noRefs: true, lineWidth: -1 },
  );
  const slackYaml = dump(
    {
      channel: "slack",
      accountId: "work",
      connectionId: slackConnection.id,
      transport: { mode: "socket" },
      routes: [
        { match: { kind: "dm" }, agent: "codex-e2e", environment: "work" },
        { match: { kind: "thread" }, workflow: "channel-live-e2e" },
        { match: { kind: "channel" }, workflow: "channel-live-e2e" },
      ],
      fallback: { deny: true },
    },
    { noRefs: true, lineWidth: -1 },
  );
  const telegramYaml = dump(
    {
      channel: "telegram",
      accountId: "work",
      connectionId: telegramConnection.connectionId,
      transport: { mode: "polling" },
      routes: [
        { match: { kind: "dm" }, agent: "codex-e2e", environment: "work" },
        { match: { kind: "topic" }, workflow: "channel-live-e2e" },
        { match: { kind: "group" }, workflow: "channel-live-e2e" },
      ],
      fallback: { deny: true },
    },
    { noRefs: true, lineWidth: -1 },
  );
  const files = [
    { path: ".paseo/hub.yml", content: hubYaml },
    { path: ".paseo/channels/policy.yml", content: policyYaml },
    { path: ".paseo/channels/slack/work.yml", content: slackYaml },
    { path: ".paseo/channels/telegram/work.yml", content: telegramYaml },
  ].sort((left, right) => left.path.localeCompare(right.path));
  await database.saveChannelConfiguration({
    organizationId,
    files,
    contentHash: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    createdByUserId: operatorId,
  });

  console.log(
    JSON.stringify(
      {
        organizationId,
        daemon: workflowDaemon.slug,
        workflowId: workflow.id,
        slackConnectionId: slackConnection.id,
        telegramConnectionId: telegramConnection.connectionId,
      },
      null,
      2,
    ),
  );
} finally {
  await target.runtime.close();
}
