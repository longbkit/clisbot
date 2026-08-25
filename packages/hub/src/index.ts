import { randomBytes } from "node:crypto";
import { validateHeaderName, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import type { Duplex } from "node:stream";
import type { Logger } from "pino";
import type { RuntimeConfig } from "./config/index.js";
import { createDatabase } from "./db/pg.js";
import type { Database } from "./db/types.js";
import {
  embeddedDatabaseRuntime,
  postgresDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseRuntimeBundle,
} from "./db/runtime/index.js";
import type { Locks } from "./db/runtime/locks/index.js";
import { logger } from "./logger.js";
import { reportFailure } from "./failures/index.js";
import { installProcessFailureHandlers } from "./failures/process.js";
import { createFetchServer } from "./http/node-server.js";
import { loadBuiltStartServer } from "./server/build.js";
import { createAuthServer } from "./auth/server.js";
import { startApplication, stopApplication, type ApplicationRuntime } from "./server/runtime.js";
import { createApplicationRuntime } from "./application-runtime.js";
import {
  composeBilling,
  createStripeBillingClient,
  createStripeCatalogSource,
  readBillingConfig,
  type BillingRuntime,
} from "./billing/index.js";
import { composeEntitlements, type ComposedEntitlements } from "./auth/entitlements.js";
import { readInstanceAuthPolicy } from "./auth/instance-policy.js";
import { createRuntimeConfiguration } from "./runtime-configuration/index.js";
import { CompositionResources } from "./composition-resources.js";
import {
  DynamicProviderRuntime,
  activateProviderApplicationsAtStartup,
  createProviderApplicationInventory,
  createProviderApplicationStore,
  createProviderApplications,
  createProviderApplicationVerifier,
  readProviderApplicationEnvironment,
  resolveCallbackOrigin,
} from "./provider-applications/index.js";
import { createSlackSocketInstallationVerifier } from "./providers/slack/installation.js";
import { resolveHubDataDirectory } from "./data-directory.js";

export function startProductionRuntime(): Promise<ApplicationRuntime> {
  return startApplication(createProductionRuntime);
}

export async function stopProductionRuntime(): Promise<void> {
  await stopApplication();
}

export async function handleDaemonUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const runtime = await startProductionRuntime();
  if (runtime.hub.handleUpgrade === null) {
    socket.destroy();
    return;
  }
  await runtime.hub.handleUpgrade(request, socket, head);
}

async function createProductionRuntime(): Promise<ApplicationRuntime> {
  const resources = new CompositionResources();
  try {
    const config = loadRuntimeConfig();
    const { database, runtime, locks } = await createDatabaseHandle();
    resources.own(() => database.close());
    const identity = await resolveHubIdentity(runtime, readPort());
    const entitlements = composeEntitlements(database, runtime);
    resources.own(() => entitlements.close());
    const billingConfig = readBillingConfig();
    const billing =
      billingConfig === undefined
        ? null
        : composeBilling({
            config: billingConfig,
            database,
            catalogSource: createStripeCatalogSource(billingConfig.stripeSecretKey),
            billingClient: createStripeBillingClient(billingConfig.stripeSecretKey),
            seatUsage: entitlements.seatUsage,
          });
    // Sync on boot, per the plan. A Stripe outage here must not block the whole instance from
    // starting — only the marketing catalog goes stale until the next webhook or restart.
    await billing?.syncCatalog().catch((error: unknown) => {
      reportFailure(error, {
        operation: "billing.catalog.sync.startup",
        component: "billing",
        provider: "stripe",
      });
    });
    const auth = createProductionAuthServer(
      entitlements,
      runtime,
      locks,
      config.authPolicy,
      identity,
      config.trustedClientIpHeader,
      billing,
    );
    resources.own(() => auth.close());
    await auth.initialize?.();
    const providerEnvironment = await readProviderApplicationEnvironment(process.env);
    const providerStore = createProviderApplicationStore(runtime, locks, database);
    const providerVerifier = createProviderApplicationVerifier();
    const providerInventory = createProviderApplicationInventory(runtime);
    const providerRuntime = new DynamicProviderRuntime({
      database,
      auth,
      applicationBaseUrl: identity.appUrl,
    });
    const providerApplications = createProviderApplications({
      auth,
      store: providerStore,
      environment: providerEnvironment,
      runtime: providerRuntime,
      verifier: providerVerifier,
      slackSocketVerifier: createSlackSocketInstallationVerifier(),
      slackDelivery: {
        status: () => providerRuntime.slackDelivery()?.status() ?? { state: "stopped" },
        retry: () => providerRuntime.slackDelivery()?.retry() ?? Promise.resolve(),
      },
      inventory: providerInventory,
      callbackOrigin: (request) => resolveCallbackOrigin(request, identity.explicitAppUrl),
      beginCandidateConnection: async (request, organizationId, returnRoute, begin) => {
        const organizationSlug = await providerInventory.organizationSlug(organizationId);
        if (organizationSlug === undefined) throw new Error("organization unavailable");
        const url = new URL(request.url);
        url.searchParams.set("organizationSlug", organizationSlug);
        url.searchParams.set("returnRoute", returnRoute);
        return begin(new Request(url, { method: "POST", headers: request.headers }));
      },
    });
    const application = await createApplicationRuntime({
      database,
      auth,
      entitlements: entitlements.service,
      billing,
      registrations: providerRuntime.registrations(),
      providerApplications,
      publicBaseUrl: identity.appUrl,
      completionTokenSecret: identity.authSecret,
      close: () => resources.close(),
    });
    const activationFailures = await activateProviderApplicationsAtStartup({
      store: providerStore,
      environment: providerEnvironment,
      runtime: providerRuntime,
      verifier: providerVerifier,
      inventory: providerInventory,
      callbackOrigin: identity.appUrl,
    });
    for (const { provider, error } of activationFailures) {
      reportFailure(error, {
        operation: "provider_application.activate_at_startup",
        component: "provider_applications",
        provider,
      });
    }
    return application;
  } catch (error) {
    await resources.close();
    throw error;
  }
}

function createProductionAuthServer(
  entitlements: ComposedEntitlements,
  database: DatabaseRuntime,
  locks: Locks,
  authPolicy: RuntimeConfig["authPolicy"],
  identity: HubIdentity,
  trustedClientIpHeader: string | undefined,
  billing: BillingRuntime | null,
) {
  return createAuthServer({
    database,
    locks,
    entitlements: entitlements.service,
    secret: identity.authSecret,
    baseURL: identity.appUrl,
    policy: authPolicy,
    ...(trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader }),
    // Hosted: new organizations start on the Free plan from the catalog mirror. Self-hosted
    // (billing null) keeps the createAuthServer default, which stamps unlimited.
    ...(billing === null
      ? {}
      : {
          provisioningEntitlements: () => billing.provisioningEntitlement(),
          onMembershipChanged: (organizationId: string) => billing.reportSeatUsage(organizationId),
        }),
  });
}

async function createDatabaseHandle(): Promise<DatabaseRuntimeBundle & { database: Database }> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl !== undefined && databaseUrl.length > 0) {
    return initializeDatabaseRuntime(
      () => postgresDatabaseRuntime(databaseUrl),
      "database runtime ready: postgres",
    );
  }

  const dataDirectory = resolveHubDataDirectory();
  return initializeDatabaseRuntime(
    () => embeddedDatabaseRuntime(dataDirectory),
    `database runtime ready: embedded (${dataDirectory})`,
  );
}

async function initializeDatabaseRuntime(
  createRuntime: () => Promise<DatabaseRuntimeBundle>,
  readyMessage: string,
): Promise<DatabaseRuntimeBundle & { database: Database }> {
  let bundle: DatabaseRuntimeBundle | undefined;
  try {
    bundle = await createRuntime();
    await bundle.runtime.migrate();
    logger.info(readyMessage);
    return { ...bundle, database: createDatabase(bundle.runtime, bundle.locks) };
  } catch (error) {
    if (bundle !== undefined) {
      try {
        await bundle.runtime.close();
      } catch (closeError) {
        reportFailure(closeError, {
          operation: "database.startup.cleanup",
          component: "database",
        });
      }
    }
    reportFailure(error, { operation: "database.startup", component: "database" });
    throw error;
  }
}

function loadRuntimeConfig(): RuntimeConfig {
  const trustedClientIpHeader = process.env["PASEO_HUB_TRUSTED_CLIENT_IP_HEADER"];
  if (trustedClientIpHeader !== undefined) validateHeaderName(trustedClientIpHeader);
  return {
    bind: process.env["PASEO_HUB_BIND"] ?? "0.0.0.0",
    ...(trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader }),
    authPolicy: readInstanceAuthPolicy(process.env),
  };
}

interface HubIdentity {
  appUrl: string;
  authSecret: string;
  explicitAppUrl?: string;
}

async function resolveHubIdentity(
  database: DatabaseRuntime,
  effectivePort: number,
): Promise<HubIdentity> {
  const configuredAppUrl = nonEmptyEnvironment(process.env["PASEO_HUB_APP_URL"]);
  const configuredAuthSecret = process.env["PASEO_HUB_AUTH_SECRET"];
  const configuration = createRuntimeConfiguration({
    database,
    environment: {
      ...(configuredAppUrl === undefined ? {} : { appUrl: configuredAppUrl }),
      ...(configuredAuthSecret === undefined ? {} : { authSecret: configuredAuthSecret }),
    },
    effectivePort,
    randomBytes,
  });
  return {
    appUrl: await configuration.publicUrl(),
    authSecret: await configuration.authSecret(),
    ...(configuredAppUrl === undefined ? {} : { explicitAppUrl: configuredAppUrl }),
  };
}

function nonEmptyEnvironment(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

async function main(): Promise<void> {
  const removeProcessFailureHandlers = installProcessFailureHandlers();
  const build = await loadBuiltStartServer();
  await build.startProductionRuntime();
  const config = loadRuntimeConfig();
  const port = readPort();
  const server = createFetchServer(
    (request) => build.default.fetch(request),
    config.trustedClientIpHeader === undefined
      ? {}
      : { trustedClientIpHeader: config.trustedClientIpHeader },
  );
  server.on("upgrade", (request, socket, head) => {
    void handleDaemonUpgradeRequest({
      request,
      socket,
      handle: () => build.handleDaemonUpgrade(request, socket, head),
    });
  });
  const appUrl =
    nonEmptyEnvironment(process.env["PASEO_HUB_APP_URL"]) ?? `http://localhost:${port}`;
  server.listen(port, config.bind, () => {
    logger.info(`server started, available at: ${appUrl}`);
  });

  const stop = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await build.stopProductionRuntime();
  };
  const stopAfterSignal = () => {
    void shutdownProductionServer(stop)
      .then((clean) => {
        if (!clean) process.exitCode = 1;
        return undefined;
      })
      .finally(removeProcessFailureHandlers);
  };
  process.once("SIGTERM", stopAfterSignal);
  process.once("SIGINT", stopAfterSignal);
}

export async function shutdownProductionServer(
  stop: () => Promise<void>,
  failureLogger?: Pick<Logger, "warn" | "error">,
): Promise<boolean> {
  try {
    await stop();
    return true;
  } catch (error) {
    reportFailure(
      error,
      { operation: "server.shutdown", component: "server" },
      failureLogger === undefined ? {} : { logger: failureLogger },
    );
    return false;
  }
}

export async function handleDaemonUpgradeRequest(options: {
  request: Pick<IncomingMessage, "method" | "url">;
  socket: Pick<Duplex, "destroy">;
  handle(): Promise<void>;
  logger?: Pick<Logger, "warn" | "error">;
}): Promise<void> {
  try {
    await options.handle();
  } catch (error) {
    reportFailure(
      error,
      {
        operation: "daemon.upgrade",
        component: "daemons",
        ...(options.request.method === undefined ? {} : { method: options.request.method }),
        path: requestPath(options.request.url),
      },
      options.logger === undefined ? {} : { logger: options.logger },
    );
    options.socket.destroy();
  }
}

function requestPath(value: string | undefined): string {
  if (value === undefined) return "/";
  try {
    return new URL(value, "http://hub.invalid").pathname;
  } catch {
    return "/";
  }
}

function readPort(): number {
  const value = process.env["PORT"] ?? "3000";
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid PORT value: ${value}`);
  return port;
}

export function runHubCommandLine(): void {
  main().catch((error: unknown) => {
    reportFailure(error, { operation: "server.startup.fatal", component: "server" });
    process.exit(1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHubCommandLine();
