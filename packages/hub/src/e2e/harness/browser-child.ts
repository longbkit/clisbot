import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createApplicationRuntime } from "../../application-runtime.js";
import { createAuthServer, type AuthServer } from "../../auth/server.js";
import { composeBilling, type BillingConfig, type BillingRuntime } from "../../billing/index.js";
import { composeEntitlements } from "../../auth/entitlements.js";
import { readInstanceAuthPolicy } from "../../auth/instance-policy.js";
import { embeddedDatabaseRuntime, type DatabaseRuntime } from "../../db/runtime/index.js";
import { createDatabase } from "../../db/pg.js";
import type { Database } from "../../db/types.js";
import { createFetchServer } from "../../http/node-server.js";
import { loadBuiltStartServer } from "../../server/build.js";
import { createGitHubRegistration } from "../../providers/github/index.js";
import type { ProviderRegistration } from "../../providers/registration.js";
import { createDiscordRegistration } from "../../providers/discord/index.js";
import { createSlackRegistration } from "../../providers/slack/index.js";
import { createLinearRegistration } from "../../providers/linear/index.js";
import {
  BrowserDiscordBot,
  BrowserDiscordConnections,
  BrowserGitHubAuth,
  BrowserGitHubConnections,
  BrowserGitHubConfiguration,
  BrowserGitHubReactions,
  BrowserSlackBot,
  type BrowserDiscordEvent,
  isBrowserProviderScenario,
  type BrowserProviderScenario,
} from "./browser-providers.js";
import {
  FixtureStripeBillingClient,
  FixtureStripeCatalogSource,
  type FixtureBillingProduct,
} from "./browser-billing.js";
import { BrowserAccountSetupFaults } from "./browser-account-setup.js";
import {
  BrowserProviderApplicationVerifier,
  BrowserSlackSocketFixture,
  browserRegistrationFactory,
} from "./browser-provider-applications.js";
import {
  activateProviderApplicationsAtStartup,
  DynamicProviderRuntime,
  createProviderApplicationInventory,
  createProviderApplicationStore,
  createProviderApplications,
  readProviderApplicationEnvironment,
  resolveCallbackOrigin,
  type ProviderApplications,
  type ProviderApplicationIdentity,
} from "../../provider-applications/index.js";
import { TRUSTED_REQUEST_ORIGIN_HEADER } from "../../http/request-origin.js";
import { compileHubConfig, compiledConfigurationHash } from "../../config/compiler.js";
import { ProjectConfigurationStore } from "../../configuration/store.js";
import type { HubBundleFile } from "../../config/bundle.js";

interface DiscordCommand {
  id: string;
  type: "discord";
  event: BrowserDiscordEvent;
}

interface SlackSocketCommand {
  id: string;
  type: "slack-socket-prepare" | "slack-socket-deliver" | "slack-socket-inspect";
  eventId?: string;
}

interface GitHubConfigurationCommand {
  id: string;
  type: "github-configuration";
  repositoryId: number;
  commitSha: string;
  files?: readonly { path: string; content: string }[];
}

interface BillingProductCommand {
  id: string;
  type: "billing-product";
  product: FixtureBillingProduct;
}

interface BillingCancelSubscriptionCommand {
  id: string;
  type: "billing-cancel-subscription";
  organizationId: string;
}

interface BillingInspectCommand {
  id: string;
  type: "billing-inspect";
  organizationId: string;
}

interface AccountSetupFailureCommand {
  id: string;
  type: "fail-next-account-setup";
}

interface ProjectReadFailureCommand {
  id: string;
  type: "fail-next-project-read";
}

/**
 * What `paseo hub connect` redeems. The child issues it because it is the process that owns the
 * database, so a journey can enroll a daemon on an embedded instance with no PostgreSQL at all.
 */
interface DaemonEnrollmentCommand {
  id: string;
  type: "daemon-enrollment-token";
  verifier: string;
}

interface DatabaseQueryCommand {
  id: string;
  type: "database-query";
  sql: string;
  params: readonly unknown[];
}

interface InstallUnroutedSlackFixtureCommand {
  id: string;
  type: "install-unrouted-slack-fixture";
  projectId: string;
  userId: string;
  files: readonly HubBundleFile[];
}

interface InstallProviderDispatchFixtureCommand {
  id: string;
  type: "install-provider-dispatch-fixture";
  organizationId: string;
  repositoryId: number;
  repository: string;
  guildId: string;
  files: readonly HubBundleFile[];
}

// Fixture-only: signature verification is local HMAC, so any well-formed secret works
// identically to a real one. STRIPE_WEBHOOK_SECRET must match what e2e/helpers/hub.ts signs
// webhook payloads with — see WEBHOOK_SECRET there and GITHUB_WEBHOOK_SECRET for precedent.
const FIXTURE_STRIPE_SECRET_KEY = "sk_test_e2e_fixture_0000000000000000000000";

async function main(): Promise<void> {
  const publicBaseUrl =
    process.env["PASEO_HUB_APP_URL"] ?? `http://127.0.0.1:${requiredEnvironment("PORT")}`;
  const scenario = readScenario();
  const databaseProfile = requiredEnvironment("PASEO_E2E_DATABASE_PROFILE");
  const { database, runtime: databaseRuntime, locks } = await createBrowserDatabase();
  if (databaseProfile === "legacy") await seedLegacyMachineAuthTarget(databaseRuntime);
  const entitlements = composeEntitlements(database, databaseRuntime);
  // Compose (and sync) billing before auth: a billing-configured harness provisions new
  // organizations onto the Free plan, so the resolver must exist before createAuthServer, and the
  // catalog must be synced before auth.initialize runs any bootstrap.
  const {
    billing,
    billingCatalog,
    billingClient: billingFixtureClient,
  } = await composeFixtureBilling(database, entitlements.seatUsage);
  const authSecret = requiredEnvironment("PASEO_HUB_AUTH_SECRET");
  const accountSetupFaults = new BrowserAccountSetupFaults();
  const auth = browserAuthEnabled()
    ? accountSetupFaults.install(
        createAuthServer({
          database: databaseRuntime,
          locks,
          entitlements: entitlements.service,
          baseURL: publicBaseUrl,
          secret: authSecret,
          policy: readInstanceAuthPolicy(process.env),
          ...billingAuthOptions(billing),
        }),
      )
    : null;
  await auth?.initialize?.();
  const machineAuth = machineAuthEnabled();
  await seedMachineAuthTargetIfRequired(auth, machineAuth, databaseProfile, databaseRuntime);
  const machineKey =
    auth === null || !machineAuth
      ? undefined
      : await auth.apiKeys?.create("phase-zero", "phase-zero-user", "browser e2e automation", [
          "configuration:install",
          "runs:dispatch",
          "daemons:enroll",
        ]);
  await writeFile(
    requiredEnvironment("PASEO_E2E_MACHINE_KEY_FILE"),
    machineKey?.secret ?? "",
    "utf8",
  );
  const bot = new BrowserDiscordBot(scenario);
  const slackBot = new BrowserSlackBot();
  const slackSocket = new BrowserSlackSocketFixture(scenario);
  await slackSocket.start();
  const githubConfiguration = new BrowserGitHubConfiguration();
  const githubConfigured = hasBrowserGitHub(scenario);
  const slackConfigured = scenario === "slack-only";
  const registrations =
    auth === null
      ? []
      : [
          createGitHubRegistration({
            database,
            auth,
            applicationBaseUrl: publicBaseUrl,
            publicBaseUrl,
            configuration: githubConfigured
              ? {
                  appId: "42",
                  appSlug: "paseo",
                  clientId: "client",
                  clientSecret: "secret",
                  webhookSecret: requiredEnvironment("GITHUB_WEBHOOK_SECRET"),
                  privateKey: "fixture-private-key",
                }
              : null,
            ...(githubConfigured
              ? {
                  appAuth: new BrowserGitHubAuth(),
                  connectionClient: new BrowserGitHubConnections(publicBaseUrl, scenario),
                  configurationProvider: githubConfiguration,
                  reactionClient: new BrowserGitHubReactions(),
                }
              : {}),
          }),
          createDiscordRegistration({
            database,
            auth,
            applicationBaseUrl: publicBaseUrl,
            publicBaseUrl,
            configuration:
              scenario === "not-configured" || scenario === "slack-only"
                ? null
                : {
                    botToken: "token",
                    clientId: "900",
                    clientSecret: "secret",
                  },
            bot,
            ...(scenario === "not-configured"
              ? {}
              : { connectionClient: new BrowserDiscordConnections(publicBaseUrl, scenario) }),
          }),
          createSlackRegistration({
            database,
            auth,
            applicationBaseUrl: publicBaseUrl,
            publicBaseUrl,
            configuration: slackConfigured
              ? {
                  transport: "webhook",
                  appId: "browser-slack-app",
                  clientId: "browser-slack-client",
                  clientSecret: "browser-slack-client-secret",
                  signingSecret: requiredEnvironment("PASEO_E2E_SLACK_SIGNING_SECRET"),
                }
              : null,
            ...(slackConfigured ? { botClient: slackBot } : {}),
          }),
          createLinearRegistration({
            database,
            auth,
            applicationBaseUrl: publicBaseUrl,
            publicBaseUrl,
            configuration: null,
          }),
        ];
  const providers = await providerRuntimeOptions(auth, registrations, {
    database,
    databaseRuntime,
    locks,
    publicBaseUrl,
    scenario,
    bot,
    slackBot,
    slackSocket,
    githubConfiguration,
  });
  const runtime = await createApplicationRuntime({
    database,
    auth,
    entitlements: entitlements.service,
    billing,
    ...providers,
    publicBaseUrl,
    completionTokenSecret: requiredEnvironment("PASEO_HUB_AUTH_SECRET"),
    async close() {
      await auth?.close();
      await entitlements.close();
      await slackSocket.close();
      await database.close();
    },
  });
  let failNextProjectRead = false;
  const projectDashboard = runtime.projectDashboard;
  if (projectDashboard !== null) {
    const readProjectSnapshot = projectDashboard.projectSnapshot.bind(projectDashboard);
    projectDashboard.projectSnapshot = async (...args) => {
      if (failNextProjectRead) {
        failNextProjectRead = false;
        throw new Error("project read failed with formatless-project-secret-8ac72f");
      }
      return readProjectSnapshot(...args);
    };
  }
  const start = await loadBuiltStartServer();
  await start.startApplication(() => runtime);
  const server = createFetchServer(
    (request) => browserProviderPage(request, publicBaseUrl) ?? start.default.fetch(request),
    await testServerOptions(),
  );
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void runtime.hub.handleUpgrade?.(request, socket, head);
  });
  await requestPortHandoff();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(requiredEnvironment("PORT")), "127.0.0.1", resolve);
  });

  process.on("message", (message: unknown) => {
    void acceptCommand(message, {
      bot,
      slackSocket,
      database,
      databaseRuntime,
      githubConfiguration,
      billingCatalog,
      billingClient: billingFixtureClient,
      accountSetupFaults,
      failNextProjectRead: () => {
        failNextProjectRead = true;
      },
    });
  });
  const stop = () => void shutdown(server, () => runtime.stop());
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

async function requestPortHandoff(): Promise<void> {
  if (process.send === undefined) throw new Error("browser child requires an IPC channel");
  await new Promise<void>((resolve, reject) => {
    const receive = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        Reflect.get(message, "type") !== "port-handoff-ready"
      ) {
        return;
      }
      process.off("message", receive);
      resolve();
    };
    process.on("message", receive);
    process.send?.({ type: "port-handoff-request" }, (error) => {
      if (error === null) return;
      process.off("message", receive);
      reject(error);
    });
  });
}

async function createBrowserDatabase() {
  const bundle = await embeddedDatabaseRuntime(requiredEnvironment("PASEO_HUB_DATA_DIR"));
  try {
    await bundle.runtime.migrate();
    process.stdout.write("database runtime ready: embedded\n");
    return { ...bundle, database: createDatabase(bundle.runtime, bundle.locks) };
  } catch (error) {
    await bundle.runtime.close().catch(() => undefined);
    throw error;
  }
}

async function seedLegacyMachineAuthTarget(database: DatabaseRuntime): Promise<void> {
  await database.query(`
    insert into organization (id, name, slug)
    values ('phase-zero', 'Phase Zero', 'phase-zero')
  `);
  // The granted document intentionally predates meters so normalization proves the legacy shape.
  await database.query(`
    insert into organization_entitlements
      (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
    values ('phase-zero', '{"seats":{"max":null},"canInviteMembers":true}'::jsonb,
            '{}'::jsonb, null, null, now(), now())
  `);
  await database.query(`
    insert into "user" (id, name, email, email_verified)
    values ('phase-zero-user', 'Phase Zero', 'phase-zero@example.test', true)
  `);
  await database.query(`
    insert into member (id, organization_id, user_id, role)
    values ('phase-zero-owner', 'phase-zero', 'phase-zero-user', 'owner')
  `);
  await database.query(`
    insert into projects (organization_id, name, slug)
    select id, 'Default', 'default' from organization
    on conflict (organization_id, slug) do nothing
  `);
  await database.query(`
    insert into project_configuration_sources (organization_id, project_id, kind)
    select organization_id, id, 'manual' from projects
    on conflict (project_id) do nothing
  `);
}

async function testServerOptions(): Promise<{
  tls?: { key: string; cert: string };
  trustedClientIpHeader?: string;
}> {
  const keyPath = process.env["PASEO_E2E_TLS_KEY"];
  const certPath = process.env["PASEO_E2E_TLS_CERT"];
  const trustedClientIpHeader = process.env["PASEO_HUB_TRUSTED_CLIENT_IP_HEADER"];
  const trusted = trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader };
  if (keyPath === undefined && certPath === undefined) return trusted;
  if (keyPath === undefined || certPath === undefined) throw new Error("incomplete test TLS");
  return {
    ...trusted,
    tls: { key: await readFile(keyPath, "utf8"), cert: await readFile(certPath, "utf8") },
  };
}

function browserProviderPage(request: Request, publicBaseUrl: string): Response | undefined {
  const url = new URL(request.url);
  let provider: { name: string; callback: string } | undefined;
  if (url.pathname === "/e2e/providers/slack/authorize") {
    provider = { name: "Slack", callback: "/api/integrations/slack/callback" };
  } else if (url.pathname === "/e2e/providers/linear/authorize") {
    provider = { name: "Linear", callback: "/api/integrations/linear/callback" };
  }
  if (provider === undefined) return undefined;
  const state = url.searchParams.get("state");
  if (state === null) return new Response("Missing state", { status: 400 });
  const callback = new URL(
    provider.callback,
    request.headers.get(TRUSTED_REQUEST_ORIGIN_HEADER) ?? publicBaseUrl,
  );
  callback.searchParams.set("state", state);
  callback.searchParams.set("code", "accepted");
  return new Response(
    `<!doctype html><html><body><main><h1>Install Paseo in Acme</h1><p>${provider.name} is asking you to accept this app.</p><a href="${callback.toString()}">Accept installation</a></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Hosted harness: new organizations start on the Free plan and membership changes re-report
 * seats to Stripe; self-hosted keeps the unlimited default and no reporting. Kept out of `main` so
 * its branch does not push that function past the complexity cap. */
function billingAuthOptions(billing: BillingRuntime | null) {
  if (billing === null) return {};
  return {
    provisioningEntitlements: () => billing.provisioningEntitlement(),
    onMembershipChanged: (organizationId: string) => billing.reportSeatUsage(organizationId),
  };
}

/**
 * One statement per call. A semicolon-separated batch only works on PostgreSQL's simple query
 * protocol; PGlite prepares every statement and refuses a batch, so a single query here made
 * the harness silently PostgreSQL-only.
 */
async function seedMachineAuthTarget(database: DatabaseRuntime): Promise<void> {
  await database.query(`
      insert into organization (id, name, slug)
      values ('phase-zero', 'E2E machine organization', 'phase-zero')
      on conflict (id) do nothing
  `);
  await database.query(`
      insert into organization_entitlements
        (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
      values ('phase-zero',
              '{"seats":{"max":null},"canInviteMembers":true,"meters":{"executions.monthly":{"limit":null}}}'::jsonb,
              '{}'::jsonb, null, null, now(), now())
      on conflict (organization_id) do nothing
  `);
  await database.query(`
      insert into "user" (id, name, email, email_verified)
      values ('phase-zero-user', 'E2E machine user', 'phase-zero@example.test', true)
      on conflict (id) do nothing
  `);
  await database.query(`
      insert into member (id, organization_id, user_id, role)
      values ('phase-zero-owner', 'phase-zero', 'phase-zero-user', 'owner')
      on conflict (id) do nothing
  `);
}

async function seedMachineAuthTargetIfRequired(
  auth: AuthServer | null,
  machineAuth: boolean,
  databaseProfile: string,
  database: DatabaseRuntime,
): Promise<void> {
  if (auth !== null && machineAuth && databaseProfile === "fresh") {
    await seedMachineAuthTarget(database);
  }
}

interface CommandFixtures {
  bot: BrowserDiscordBot;
  slackSocket: BrowserSlackSocketFixture;
  database: Database;
  databaseRuntime: DatabaseRuntime;
  githubConfiguration: BrowserGitHubConfiguration;
  billingCatalog: FixtureStripeCatalogSource | null;
  billingClient: FixtureStripeBillingClient | null;
  accountSetupFaults: BrowserAccountSetupFaults;
  failNextProjectRead(): void;
}

async function acceptCommand(message: unknown, fixtures: CommandFixtures): Promise<void> {
  const { bot, githubConfiguration, billingCatalog, billingClient } = fixtures;
  if (isGitHubConfigurationCommand(message)) {
    githubConfiguration.setRevision(message);
    process.send?.({ id: message.id, ok: true });
    return;
  }
  if (isAccountSetupFailureCommand(message)) {
    fixtures.accountSetupFaults.failNext();
    process.send?.({ id: message.id, ok: true });
    return;
  }
  if (isProjectReadFailureCommand(message)) {
    fixtures.failNextProjectRead();
    process.send?.({ id: message.id, ok: true });
    return;
  }
  if (isDaemonEnrollmentCommand(message)) {
    await acceptDaemonEnrollmentCommand(message, fixtures);
    return;
  }
  if (isSlackSocketCommand(message)) {
    await acceptSlackSocketCommand(message, fixtures);
    return;
  }
  if (isDatabaseQueryCommand(message)) {
    await acceptDatabaseQueryCommand(message, fixtures.databaseRuntime);
    return;
  }
  if (isInstallUnroutedSlackFixtureCommand(message)) {
    await acceptInstallUnroutedSlackFixture(message, fixtures.database);
    return;
  }
  if (isInstallProviderDispatchFixtureCommand(message)) {
    await acceptInstallProviderDispatchFixture(
      message,
      fixtures.database,
      fixtures.databaseRuntime,
    );
    return;
  }
  if (acceptBillingCommand(message, billingCatalog, billingClient)) return;
  if (!isDiscordCommand(message)) return;
  try {
    await bot.deliver(message.event);
    process.send?.({ id: message.id, ok: true });
  } catch (error) {
    process.send?.({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function acceptInstallUnroutedSlackFixture(
  message: InstallUnroutedSlackFixtureCommand,
  database: Database,
): Promise<void> {
  try {
    const store = new ProjectConfigurationStore(database, message.projectId);
    const revision = await store.insertManualBundleRevision({
      files: message.files,
      userId: message.userId,
      sourceEvidence: { kind: "browser-drop-reason" },
    });
    await store.activate(revision.id);
    process.send?.({ id: message.id, ok: true });
  } catch (error) {
    sendCommandError(message.id, error);
  }
}

async function acceptInstallProviderDispatchFixture(
  message: InstallProviderDispatchFixtureCommand,
  database: Database,
  runtime: DatabaseRuntime,
): Promise<void> {
  try {
    const project = await database.findProjectBySlugForOrganization(
      message.organizationId,
      "default",
    );
    if (project === undefined) throw new Error("default project unavailable");
    const daemon = await database.findDaemonBySlugForOrganization(
      message.organizationId,
      "shared-dispatch",
    );
    if (daemon === undefined) throw new Error("dispatch daemon unavailable");
    const [owner] = (
      await runtime.query<{ user_id: string }>(
        `select user_id from member
       where organization_id = $1 and role = 'owner'
       order by id limit 1`,
        [message.organizationId],
      )
    ).rows;
    if (owner === undefined) throw new Error("organization owner unavailable");
    const github = await database.findGitHubConnection(message.repositoryId);
    if (github === undefined || github.organizationId !== message.organizationId) {
      throw new Error("GitHub connection unavailable");
    }
    await database.upsertGitHubRepositories(message.organizationId, github.id, [
      {
        repositoryId: message.repositoryId,
        fullName: message.repository,
        defaultBranch: "main",
      },
    ]);
    await database.setProjectGitHubConfigurationSource({
      projectId: project.id,
      githubConnectionId: github.id,
      githubRepositoryId: message.repositoryId,
      githubRepositoryFullName: message.repository,
      githubDefaultBranch: "main",
      automaticDeploymentEnabled: true,
      userId: owner.user_id,
    });
    const discord = await database.findDiscordConnection(message.guildId);
    if (discord === undefined || discord.organizationId !== message.organizationId) {
      throw new Error("Discord connection unavailable");
    }
    const store = new ProjectConfigurationStore(database, project.id);
    const revision = await store.insertManualBundleRevision({
      files: message.files,
      userId: owner.user_id,
      sourceEvidence: { kind: "browser-fixture", userId: owner.user_id },
    });
    await store.activate(revision.id);
    process.send?.({ id: message.id, ok: true });
  } catch (error) {
    sendCommandError(message.id, error);
  }
}

function sendCommandError(id: string, error: unknown): void {
  process.send?.({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function acceptDatabaseQueryCommand(
  message: DatabaseQueryCommand,
  database: DatabaseRuntime,
): Promise<void> {
  try {
    const result = await database.query(message.sql, message.params);
    process.send?.({ id: message.id, ok: true, data: result.rows });
  } catch (error) {
    process.send?.({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function acceptDaemonEnrollmentCommand(
  message: DaemonEnrollmentCommand,
  fixtures: CommandFixtures,
): Promise<void> {
  try {
    await fixtures.databaseRuntime.query(
      `insert into daemon_enrollment_tokens (id, verifier, organization_id, expires_at)
       select gen_random_uuid(), $1, id, now() + interval '10 minutes' from organization`,
      [message.verifier],
    );
    process.send?.({ id: message.id, ok: true });
  } catch (error) {
    process.send?.({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function acceptSlackSocketCommand(
  message: SlackSocketCommand,
  fixtures: CommandFixtures,
): Promise<void> {
  try {
    if (message.type === "slack-socket-prepare") {
      await prepareSlackSocketWorkflow(fixtures.database, fixtures.databaseRuntime);
      process.send?.({ id: message.id, ok: true });
      return;
    }
    if (message.eventId === undefined) throw new Error("Slack event ID is required");
    if (message.type === "slack-socket-deliver") {
      await fixtures.slackSocket.deliverMention(message.eventId);
      process.send?.({ id: message.id, ok: true });
      return;
    }
    const result = await fixtures.databaseRuntime.query<{ receipts: number; runs: number }>(
      `select count(distinct receipt.id)::integer receipts, count(run.id)::integer runs
       from provider_event_receipts receipt left join trigger_runs run
       on run.provider_event_receipt_id = receipt.id where receipt.delivery_id = $1`,
      [`slack-${message.eventId}`],
    );
    process.send?.({ id: message.id, ok: true, data: result.rows[0] });
  } catch (error) {
    process.send?.({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function prepareSlackSocketWorkflow(
  database: Database,
  runtime: DatabaseRuntime,
): Promise<void> {
  const target = await runtime.query<{
    project_id: string;
    user_id: string;
    connection_id: string;
  }>(
    `select project.id project_id, member.user_id, connection.id connection_id
     from projects project join member on member.organization_id = project.organization_id
     join slack_connections connection on connection.organization_id = project.organization_id
     where connection.team_id = 'T-ACME' order by project.id, member.id limit 1`,
  );
  const row = target.rows[0];
  if (row === undefined) throw new Error("Slack browser workflow target is unavailable");
  const compiled = compileHubConfig({
    environments: [{ name: "runner", kind: "daemon", daemon: "browser-runner", cwd: "/workspace" }],
    triggers: [
      {
        name: "socket-mention",
        on: "slack.mention",
        max_runtime: "5m",
        filters: { workspace: "T-ACME", channels: ["C1"], from_users: ["U1"] },
        steps: [
          {
            id: "handle",
            environment: "runner",
            max_runtime: "2m",
            idle_timeout: "30s",
            agent: { provider: "test" },
            prompt: [{ text: "Handle the Socket Mode mention." }],
          },
        ],
      },
    ],
  });
  const configuration = {
    ...compiled,
    environments: compiled.environments.map((environment) =>
      environment.kind === "daemon"
        ? { ...environment, daemonId: "00000000-0000-4000-8000-000000000099" }
        : environment,
    ),
    triggers: compiled.triggers.map((trigger) =>
      Object.assign({}, trigger, {
        filters: { ...trigger.filters, connectionId: row.connection_id },
      }),
    ),
  };
  const revision = await database.insertProjectConfigurationRevision({
    projectId: row.project_id,
    sourceKind: "manual",
    sourceEvidence: { kind: "browser-socket-fixture" },
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    createdByUserId: row.user_id,
  });
  await database.activateProjectConfigurationRevision(row.project_id, revision.id, [
    {
      provider: "slack",
      connectionId: row.connection_id,
      resourceId: null,
      triggerName: "socket-mention",
    },
  ]);
}

/** Handle the fixture billing IPC commands (product edit, cancel, seat inspection). Returns true
 * when it recognized and replied to a billing command, keeping `acceptCommand` under the
 * complexity cap. */
function acceptBillingCommand(
  message: unknown,
  billingCatalog: FixtureStripeCatalogSource | null,
  billingClient: FixtureStripeBillingClient | null,
): boolean {
  if (isBillingProductCommand(message)) {
    if (billingCatalog === null) {
      process.send?.({ id: message.id, ok: false, error: "billing is not configured" });
      return true;
    }
    billingCatalog.setProduct(message.product);
    process.send?.({ id: message.id, ok: true });
    return true;
  }
  if (isBillingCancelSubscriptionCommand(message)) {
    if (billingClient === null) {
      process.send?.({ id: message.id, ok: false, error: "billing is not configured" });
      return true;
    }
    // Stand in for the customer canceling in the Stripe portal: the subscription now reads
    // canceled, and the caller then delivers the signed customer.subscription.deleted webhook.
    const canceled = billingClient.cancelSubscription(message.organizationId);
    process.send?.({
      id: message.id,
      ok: canceled,
      error: canceled ? undefined : "no subscription",
    });
    return true;
  }
  if (isBillingInspectCommand(message)) {
    if (billingClient === null) {
      process.send?.({ id: message.id, ok: false, error: "billing is not configured" });
      return true;
    }
    // The seat quantity Stripe was last told to bill — what the seat-quantity E2E asserts.
    process.send?.({
      id: message.id,
      ok: true,
      data: { reportedSeatQuantity: billingClient.reportedSeatQuantity(message.organizationId) },
    });
    return true;
  }
  return false;
}

function isGitHubConfigurationCommand(value: unknown): value is GitHubConfigurationCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "github-configuration" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "repositoryId") === "number" &&
    typeof Reflect.get(value, "commitSha") === "string" &&
    (Reflect.get(value, "files") === undefined || isBundleFileList(Reflect.get(value, "files")))
  );
}

function isBundleFileList(value: unknown): value is readonly { path: string; content: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        typeof Reflect.get(file, "path") === "string" &&
        typeof Reflect.get(file, "content") === "string",
    )
  );
}

function isAccountSetupFailureCommand(value: unknown): value is AccountSetupFailureCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "fail-next-account-setup" &&
    typeof Reflect.get(value, "id") === "string"
  );
}

function isDaemonEnrollmentCommand(value: unknown): value is DaemonEnrollmentCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "daemon-enrollment-token" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "verifier") === "string"
  );
}

function isDatabaseQueryCommand(value: unknown): value is DatabaseQueryCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "database-query" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "sql") === "string" &&
    Array.isArray(Reflect.get(value, "params"))
  );
}

function isInstallUnroutedSlackFixtureCommand(
  value: unknown,
): value is InstallUnroutedSlackFixtureCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "install-unrouted-slack-fixture" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "projectId") === "string" &&
    typeof Reflect.get(value, "userId") === "string" &&
    isBundleFileList(Reflect.get(value, "files"))
  );
}

function isInstallProviderDispatchFixtureCommand(
  value: unknown,
): value is InstallProviderDispatchFixtureCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "install-provider-dispatch-fixture" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "organizationId") === "string" &&
    typeof Reflect.get(value, "repositoryId") === "number" &&
    typeof Reflect.get(value, "repository") === "string" &&
    typeof Reflect.get(value, "guildId") === "string" &&
    isBundleFileList(Reflect.get(value, "files"))
  );
}

function isProjectReadFailureCommand(value: unknown): value is ProjectReadFailureCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "fail-next-project-read" &&
    typeof Reflect.get(value, "id") === "string"
  );
}

function isBillingProductCommand(value: unknown): value is BillingProductCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "billing-product" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "product") === "object"
  );
}

function isBillingCancelSubscriptionCommand(
  value: unknown,
): value is BillingCancelSubscriptionCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "billing-cancel-subscription" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "organizationId") === "string"
  );
}

function isBillingInspectCommand(value: unknown): value is BillingInspectCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "billing-inspect" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "organizationId") === "string"
  );
}

function isDiscordCommand(value: unknown): value is DiscordCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "discord" &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "event") === "object"
  );
}

function isSlackSocketCommand(value: unknown): value is SlackSocketCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    ["slack-socket-prepare", "slack-socket-deliver", "slack-socket-inspect"].includes(
      String(Reflect.get(value, "type")),
    ) &&
    typeof Reflect.get(value, "id") === "string" &&
    (Reflect.get(value, "eventId") === undefined ||
      typeof Reflect.get(value, "eventId") === "string")
  );
}

async function shutdown(
  server: ReturnType<typeof createFetchServer>,
  stopRuntime: () => Promise<void>,
): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
  await stopRuntime();
  server.closeIdleConnections();
  server.closeAllConnections();
  await closed;
  process.exit(0);
}

function readScenario(): BrowserProviderScenario {
  const value = process.env["PASEO_BROWSER_PROVIDER_SCENARIO"] ?? "connected";
  if (isBrowserProviderScenario(value)) return value;
  throw new Error(`invalid browser provider scenario: ${value}`);
}

function hasBrowserGitHub(scenario: BrowserProviderScenario): boolean {
  return scenario !== "not-configured" && scenario !== "discord-only" && scenario !== "slack-only";
}

function browserAuthEnabled(): boolean {
  const value = requiredEnvironment("PASEO_BROWSER_AUTH_ENABLED");
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`invalid browser auth setting: ${value}`);
}

function machineAuthEnabled(): boolean {
  const value = requiredEnvironment("PASEO_MACHINE_AUTH_ENABLED");
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`invalid machine auth setting: ${value}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function billingEnabled(): boolean {
  return process.env["PASEO_BROWSER_BILLING_SCENARIO"] === "configured";
}

function readFixtureBillingConfig(): BillingConfig {
  return {
    stripeSecretKey: FIXTURE_STRIPE_SECRET_KEY,
    stripeWebhookSecret: requiredEnvironment("STRIPE_WEBHOOK_SECRET"),
  };
}

/**
 * Composes the fixture billing runtime and syncs it on boot, mirroring what `src/index.ts`
 * does in production with the real Stripe SDK. `billingCatalog` is returned separately so the
 * IPC handler can mutate it later — see the `billing-product` command below.
 */
async function composeFixtureBilling(
  database: Database,
  seatUsage: (organizationId: string) => Promise<number>,
): Promise<{
  billing: BillingRuntime | null;
  billingCatalog: FixtureStripeCatalogSource | null;
  billingClient: FixtureStripeBillingClient | null;
}> {
  if (!billingEnabled()) return { billing: null, billingCatalog: null, billingClient: null };
  const billingCatalog = new FixtureStripeCatalogSource();
  const billingClient = new FixtureStripeBillingClient();
  const billing = composeBilling({
    config: readFixtureBillingConfig(),
    database,
    catalogSource: billingCatalog,
    billingClient,
    seatUsage,
  });
  await billing.syncCatalog();
  return { billing, billingCatalog, billingClient };
}

/**
 * The registration set the application runs on. Dynamic mode hands over to the operator-managed
 * runtime entirely; every other scenario keeps the statically configured providers it has always
 * had, so existing journeys are untouched.
 */
async function providerRuntimeOptions(
  auth: Parameters<typeof createApplicationRuntime>[0]["auth"],
  registrations: readonly ProviderRegistration[],
  fixtures: Omit<Parameters<typeof composeProviderApplications>[0], "auth">,
): Promise<
  Pick<Parameters<typeof createApplicationRuntime>[0], "registrations"> & {
    providerApplications?: ProviderApplications;
  }
> {
  const apps = auth === null ? null : await composeProviderApplications({ ...fixtures, auth });
  if (apps !== null) {
    return { registrations: apps.registrations, providerApplications: apps.capability };
  }
  if (auth !== null) {
    await activateStaticProviderApplications(fixtures);
  }
  return { registrations };
}

async function activateStaticProviderApplications(
  input: Omit<Parameters<typeof composeProviderApplications>[0], "auth">,
): Promise<void> {
  const identities: ProviderApplicationIdentity[] = [];
  if (hasBrowserGitHub(input.scenario)) {
    identities.push({ provider: "github", id: "42", name: "paseo", ownerLogin: "acme-inc" });
  }
  if (input.scenario !== "not-configured" && input.scenario !== "slack-only") {
    identities.push({ provider: "discord", id: "900", name: "Paseo" });
  }
  if (input.scenario === "slack-only") {
    identities.push({ provider: "slack", id: "browser-slack-app", name: "Paseo" });
  }
  const store = createProviderApplicationStore(input.databaseRuntime, input.locks, input.database);
  for (const identity of identities) {
    await store.activate({ provider: identity.provider, identity, configurationVersion: 0 });
  }
}

/**
 * The operator-managed provider applications, backed by the fixture provider clients. Dynamic mode
 * replaces the statically configured registrations entirely, so the app setup journey starts on an
 * instance with nothing configured and activates providers exactly the way production does.
 */
async function composeProviderApplications(input: {
  database: Database;
  databaseRuntime: DatabaseRuntime;
  locks: Parameters<typeof createProviderApplicationStore>[1];
  auth: NonNullable<Parameters<typeof createApplicationRuntime>[0]["auth"]>;
  publicBaseUrl: string;
  scenario: BrowserProviderScenario;
  bot: BrowserDiscordBot;
  slackBot: BrowserSlackBot;
  slackSocket: BrowserSlackSocketFixture;
  githubConfiguration: BrowserGitHubConfiguration;
}): Promise<{
  capability: ProviderApplications;
  registrations: readonly ProviderRegistration[];
} | null> {
  if (process.env["PASEO_BROWSER_PROVIDER_APPS"] !== "dynamic") return null;
  const environment = await readProviderApplicationEnvironment(process.env);
  const store = createProviderApplicationStore(input.databaseRuntime, input.locks, input.database);
  const verifier = new BrowserProviderApplicationVerifier(input.scenario);
  const inventory = createProviderApplicationInventory(input.databaseRuntime);
  const providerRuntime = new DynamicProviderRuntime({
    database: input.database,
    auth: input.auth,
    applicationBaseUrl: input.publicBaseUrl,
    registrationFactory: browserRegistrationFactory({
      database: input.database,
      auth: input.auth,
      applicationBaseUrl: input.publicBaseUrl,
      scenario: input.scenario,
      bot: input.bot,
      slackBot: input.slackBot,
      slackSocket: input.slackSocket,
      githubConfiguration: input.githubConfiguration,
    }),
  });
  const failures = await activateProviderApplicationsAtStartup({
    store,
    environment,
    runtime: providerRuntime,
    verifier,
    inventory,
    callbackOrigin: input.publicBaseUrl,
  });
  if (failures[0] !== undefined) {
    throw failures[0].error;
  }
  const capability = createProviderApplications({
    auth: input.auth,
    store,
    environment,
    runtime: providerRuntime,
    verifier,
    slackSocketVerifier: input.slackSocket.verifier(),
    slackDelivery: {
      status: () => providerRuntime.slackDelivery()?.status() ?? { state: "stopped" },
      retry: () => providerRuntime.slackDelivery()?.retry() ?? Promise.resolve(),
    },
    inventory,
    callbackOrigin: (request) => resolveCallbackOrigin(request, process.env["PASEO_HUB_APP_URL"]),
    beginCandidateConnection: async (request, organizationId, returnRoute, begin) => {
      const organizationSlug = await inventory.organizationSlug(organizationId);
      if (organizationSlug === undefined) throw new Error("organization unavailable");
      const url = new URL(request.url);
      url.searchParams.set("organizationSlug", organizationSlug);
      url.searchParams.set("returnRoute", returnRoute);
      return begin(new Request(url, { method: "POST", headers: request.headers }));
    },
  });
  return { capability, registrations: providerRuntime.registrations() };
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
