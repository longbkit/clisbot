import { appendFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createHubApplication } from "../../app.js";
import { createPostgresTestRuntime } from "../../db/test-utils/runtime.js";
import { dump } from "js-yaml";
import {
  OutputExecutorRegistry,
  outputContextProvider,
  replyOutputTool,
} from "../../execution-capabilities/outputs.js";
import { createFetchServer } from "../../http/node-server.js";
import { loadBuiltStartServer } from "../../server/build.js";
import { createAuthServer } from "../../auth/server.js";
import { composeEntitlements } from "../../auth/entitlements.js";
import { readInstanceAuthPolicy } from "../../auth/instance-policy.js";
import { OrganizationResources } from "../../organizations/resources.js";
import { parseProjectConfiguration, ProjectConfigurationStore } from "../../configuration/store.js";
import { hashTemplate, UNLIMITED_TEMPLATE } from "../../entitlements/catalog.js";
import { configurationBundleFixture } from "../../test-utils/configuration-bundle.js";

const E2E_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const port = Number(requiredEnvironment("PORT"));
  const outputFile = requiredEnvironment("HUB_E2E_OUTPUT_FILE");
  const { database, runtime, locks } = await createPostgresTestRuntime(databaseUrl);
  const organizationId = "hub-e2e";
  await runtime.query(
    `insert into organization (id, name, slug) values ($1, $2, $3) on conflict (id) do nothing`,
    [organizationId, "Hub E2E", organizationId],
  );
  await runtime.query(
    `insert into organization_entitlements
       (organization_id, granted, overrides, plan_id, plan_version, stamped_at, updated_at)
     values ($1, $2::jsonb, '{}'::jsonb, null, $3, now(), now())
     on conflict (organization_id) do nothing`,
    [organizationId, JSON.stringify(UNLIMITED_TEMPLATE), hashTemplate(UNLIMITED_TEMPLATE)],
  );
  await runtime.query(
    `insert into "user" (id, name, email, email_verified)
     values ('hub-e2e', 'Hub E2E', 'hub-e2e@paseo.test', true)
     on conflict (id) do nothing`,
  );
  await runtime.query(
    `insert into member (id, organization_id, user_id, role)
     values ('hub-e2e-owner', $1, 'hub-e2e', 'owner')
     on conflict (id) do nothing`,
    [organizationId],
  );
  await runtime.query(
    `insert into projects (id, organization_id, name, slug, created_by_user_id)
     values ($1, $2, $3, $4, 'hub-e2e') on conflict (id) do nothing`,
    [E2E_PROJECT_ID, organizationId, "Default", "default"],
  );
  const configuration = new ProjectConfigurationStore(database, E2E_PROJECT_ID);
  const outputs = new OutputExecutorRegistry();
  outputs.register({
    type: "discord.reply",
    tool: replyOutputTool,
    available: outputContextProvider("discord"),
    execute: async (output) => {
      await appendFile(outputFile, `${JSON.stringify(output)}\n`);
    },
  });
  const entitlements = composeEntitlements(database, runtime);
  const auth = createAuthServer({
    database: runtime,
    locks,
    entitlements: entitlements.service,
    baseURL: requiredEnvironment("PASEO_HUB_APP_URL"),
    secret: requiredEnvironment("PASEO_HUB_AUTH_SECRET"),
    policy: readInstanceAuthPolicy(process.env),
  });
  await auth.initialize?.();
  const createdApiKey = await auth.apiKeys?.create(
    organizationId,
    "hub-e2e",
    "hub e2e automation",
    [
      "projects:read",
      "configuration:validate",
      "configuration:install",
      "runs:dispatch",
      "daemons:enroll",
    ],
  );
  if (createdApiKey === undefined) throw new Error("API key service unavailable");
  await writeFile(requiredEnvironment("HUB_E2E_MACHINE_KEY_FILE"), createdApiKey.secret, "utf8");
  const seededDaemonId = "00000000-0000-4000-8000-0000000000dd";
  let daemon = await database.findDaemonById(seededDaemonId);
  if (daemon === undefined) {
    await database.issueEnrollmentToken({
      id: "00000000-0000-4000-8000-0000000000ee",
      verifier: "hub-e2e-seed-daemon-token",
      organizationId,
      issuedByApiKeyId: createdApiKey.summary.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      consumedAt: null,
    });
    const enrollment = await database.enrollDaemon({
      tokenVerifier: "hub-e2e-seed-daemon-token",
      daemonId: seededDaemonId,
      idempotencyKey: "hub-e2e-seed-daemon-idempotency",
      serverId: "hub-e2e-seed-server",
      daemonPublicKey: "hub-e2e-seed-public-key",
      credentialVerifier: "hub-e2e-seed-credential-verifier",
      permissions: ["hub.execute"],
      now: new Date(),
    });
    daemon = enrollment?.status === "slug_conflict" ? undefined : enrollment;
  }
  if (daemon === undefined) throw new Error("Hub E2E seed daemon enrollment failed");
  const config = await configuration.insertManualBundleRevision({
    files: configurationBundleFixture(
      dump({
        environments: [
          { name: "hub-e2e", kind: "daemon", daemon: daemon.slug, cwd: process.cwd() },
        ],
        triggers: [
          {
            name: "e2e-discord",
            on: "e2e.discord",
            max_runtime: "2h",
            filters: { from_users: ["phase-five-operator"] },
            steps: [
              {
                id: "e2e-step",
                environment: "hub-e2e",
                max_runtime: "1h",
                idle_timeout: "5m",
                agent: { provider: "hub-e2e" },
                prompt: [{ text: "Deploy mcp-capability for phase-five-operator" }],
              },
            ],
          },
        ],
      }),
    ),
    userId: "hub-e2e",
    sourceEvidence: { kind: "harness-seed", userId: "hub-e2e" },
  });
  await configuration.activate(config.id);
  const resources = new OrganizationResources(database);
  const application = createHubApplication({
    database,
    entitlements: entitlements.service,
    publicApi:
      auth.publicCredentials === undefined
        ? { status: "unavailable" }
        : { status: "enabled", authenticator: auth.publicCredentials },
    outputRegistry: outputs,
    providers: [
      {
        name: "discord",
        eventNames: ["e2e.discord"],
        async match(trigger) {
          const activeConfiguration = await database.findActiveProjectConfiguration(E2E_PROJECT_ID);
          const compiledConfiguration =
            activeConfiguration === undefined
              ? undefined
              : parseProjectConfiguration(activeConfiguration);
          const dispatchDaemon = (
            await database.listDaemonsForOrganization(trigger.organizationId)
          )[0];
          if (
            dispatchDaemon === undefined ||
            activeConfiguration === undefined ||
            compiledConfiguration === undefined
          )
            return [];
          return [
            {
              triggerName: "e2e-discord",
              triggerContext: { provider: "discord", deliveryId: trigger.deliveryId },
              outputContext: {
                provider: "discord",
                guildId: "guild-original",
                channelId: "channel-original",
                threadId: "thread-original",
                messageId: "message-original",
              },
              configurationRevisionId: activeConfiguration.id,
              projectId: E2E_PROJECT_ID,
              hubConfig: compiledConfiguration,
              invocation: {
                status: "accepted",
                prompt: "Deploy mcp-capability for phase-five-operator",
                inputs: {},
              },
            },
          ];
        },
      },
    ],
    publicBaseUrl: requiredEnvironment("PASEO_HUB_APP_URL"),
    completionTokenSecret: requiredEnvironment("PASEO_HUB_AUTH_SECRET"),
    browserOrganizationAccess: auth,
  });
  const hub = application.hub;
  await hub.start();
  const start = await loadBuiltStartServer();
  await start.startApplication(() => ({
    hub,
    operations: application.operations,
    publicApi: application.publicApi,
    resources,
    billing: null,
    projectDashboard: null,
    usageDashboard: null,
    operatorConsole: null,
    providerApplications: null,
    testTriggerRoutes: true,
    auth: (request) => auth.handle(request),
    browserAccount: (request) => auth.browserAccount!(request),
    signInEmail: (data, headers) => auth.signInEmail!(data, headers),
    signUpEmail: (data, headers) => auth.signUpEmail!(data, headers),
    signOut: (headers) => auth.signOut!(headers),
    organizationResources: (request) => auth.resources(request, resources),
    connectionStatus: () =>
      Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 })),
    connectionAction: () =>
      Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 })),
    webhook: () => Promise.resolve(new Response("Not Found", { status: 404 })),
    billingWebhook: () => Promise.resolve(new Response("Not Found", { status: 404 })),
    billingPlans: () => Promise.resolve(null),
    billingConfigured: () => false,
    billingOverview: () => Promise.reject(new Error("billing is not configured")),
    billingCheckout: () => Promise.reject(new Error("billing is not configured")),
    billingPortal: () => Promise.reject(new Error("billing is not configured")),
    providerRequest: () => Promise.resolve(new Response("Not Found", { status: 404 })),
    async stop() {
      await hub?.stop();
      await auth.close();
      await entitlements.close();
    },
  }));
  const server = createFetchServer((request) => start.default.fetch(request));
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void hub?.handleUpgrade?.(request, socket, head);
  });
  server.listen(port, "127.0.0.1");

  async function shutdown(): Promise<void> {
    const failures: unknown[] = [];
    const listenerClosed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await attempt(() => hub?.stop(), failures);
    await attempt(() => auth.close(), failures);
    await attempt(() => entitlements.close(), failures);
    if ("closeIdleConnections" in server) server.closeIdleConnections();
    if ("closeAllConnections" in server) server.closeAllConnections();
    await attempt(() => listenerClosed, failures);
    await attempt(() => database.close(), failures);
    if (failures.length > 0) throw new AggregateError(failures, "Hub child shutdown failed");
  }

  const stop = () =>
    void shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exit(1);
      },
    );
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

async function attempt(operation: () => Promise<unknown> | undefined, failures: unknown[]) {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
