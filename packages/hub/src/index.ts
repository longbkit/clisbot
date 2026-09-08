import { randomBytes } from "node:crypto";
import { validateHeaderName, type IncomingMessage, type Server } from "node:http";
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
import { applyClisbotEnvDefaults } from "./env-alias.js";
import { composeInvitationMailer } from "./invitations/index.js";
import {
  readCredentialCipherEnvironment,
  type CredentialCipher,
} from "./credentials/credential-cipher.js";
import { AccessStore } from "./access/store.js";
import { AccessLeaseRevocation } from "./managed-access/revocation.js";
import { AccessTicketService, readAccessLeaseDuration } from "./managed-access/tickets.js";
import { createSignalShutdown } from "./shutdown.js";

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
    // COMPAT(clisbot-control-plane): the channel plane's data dir must exist
    // before the database handle resolves it for the embedded runtime, so the
    // same directory is threaded to the application composition.
    const hubDataDirectory = resolveHubDataDirectory();
    const credentialCipher = await readCredentialCipherEnvironment(process.env, {
      hubDataDirectory,
    });
    const { database, runtime, locks } = await createDatabaseHandle(
      hubDataDirectory,
      credentialCipher,
    );
    resources.own(() => database.close());
    const identity = await resolveHubIdentity(runtime, readPort(), credentialCipher);
    const accessTickets = new AccessTicketService(runtime, new AccessStore(runtime), {
      leaseDurationMs: readAccessLeaseDuration(
        process.env["PASEO_HUB_MANAGED_ACCESS_LEASE_DURATION"],
      ),
    });
    let notifyAccessLeaseRevocation = (_daemonId: string, _leaseIds: readonly string[]): boolean =>
      false;
    const accessLeaseRevocation = new AccessLeaseRevocation(accessTickets, (daemonId, leaseIds) => {
      notifyAccessLeaseRevocation(daemonId, leaseIds);
    });
    const entitlements = composeEntitlements(database, runtime);
    resources.own(() => entitlements.close());
    const billingConfig = readBillingConfig();
    const invitationMailer = composeInvitationMailer();
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
      invitationMailer,
      (organizationId) =>
        accessLeaseRevocation.revokeOrganization(organizationId).then(() => undefined),
    );
    resources.own(() => auth.close());
    await auth.initialize?.();
    const providerEnvironment = await readProviderApplicationEnvironment(process.env);
    const providerStore = createProviderApplicationStore(
      runtime,
      locks,
      credentialCipher,
      database,
    );
    const providerVerifier = createProviderApplicationVerifier();
    const providerInventory = createProviderApplicationInventory(runtime);
    const providerRuntime = new DynamicProviderRuntime({
      database,
      auth,
      applicationBaseUrl: identity.appUrl,
    });
    const slackInboundOwners = new Map<string, Set<string>>();
    const slackInboundTransitions = new Map<string, Promise<void>>();
    const serializeSlackInbound = async <T>(
      providerApplicationId: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      const previous = slackInboundTransitions.get(providerApplicationId) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => gate);
      slackInboundTransitions.set(providerApplicationId, tail);
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (slackInboundTransitions.get(providerApplicationId) === tail) {
          slackInboundTransitions.delete(providerApplicationId);
        }
      }
    };
    const claimSlackInbound = async (
      providerApplicationId: string,
      owner: string,
    ): Promise<() => Promise<void>> => {
      await serializeSlackInbound(providerApplicationId, async () => {
        const owners = slackInboundOwners.get(providerApplicationId) ?? new Set<string>();
        if (owners.size === 0) {
          await providerRuntime.setSlackInboundSuppressed(providerApplicationId, true);
        }
        owners.add(owner);
        slackInboundOwners.set(providerApplicationId, owners);
      });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await serializeSlackInbound(providerApplicationId, async () => {
          const current = slackInboundOwners.get(providerApplicationId);
          current?.delete(owner);
          if (current !== undefined && current.size > 0) return;
          slackInboundOwners.delete(providerApplicationId);
          await providerRuntime.setSlackInboundSuppressed(providerApplicationId, false);
        });
      };
    };
    const providerApplications = createProviderApplications({
      auth,
      store: providerStore,
      environment: providerEnvironment,
      runtime: providerRuntime,
      verifier: providerVerifier,
      slackSocketVerifier: createSlackSocketInstallationVerifier(),
      slackDelivery: {
        status: (providerApplicationId) =>
          providerRuntime.slackDelivery(providerApplicationId)?.status() ?? {
            state: "stopped",
          },
        retry: (providerApplicationId) =>
          providerRuntime.slackDelivery(providerApplicationId)?.retry() ?? Promise.resolve(),
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
      // COMPAT(clisbot-control-plane): runtime + data dir threaded to the channel
      // supervisor; the kill-switch is consulted at composition.
      databaseRuntime: runtime,
      hubDataDir: hubDataDirectory,
      auth,
      entitlements: entitlements.service,
      billing,
      registrations: providerRuntime.registrations(),
      providerApplications,
      publicBaseUrl: identity.appUrl,
      completionTokenSecret: identity.authSecret,
      accessTickets,
      accessLeaseRevocation,
      claimSlackInbound,
      close: () => resources.close(),
    });
    notifyAccessLeaseRevocation = application.hub.revokeAccessLeases;
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
  invitationMailer: ReturnType<typeof composeInvitationMailer>,
  onOrganizationAccessChanged: (organizationId: string) => Promise<void>,
) {
  return createAuthServer({
    database,
    locks,
    entitlements: entitlements.service,
    secret: identity.authSecret,
    baseURL: identity.appUrl,
    policy: authPolicy,
    masterPassword: process.env["CLISBOT_MASTER_PASSWORD"],
    ...(trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader }),
    ...(invitationMailer === undefined ? {} : { invitationMailer }),
    onOrganizationAccessChanged,
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

async function createDatabaseHandle(
  hubDataDirectory: string,
  credentialCipher: CredentialCipher,
): Promise<DatabaseRuntimeBundle & { database: Database }> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl !== undefined && databaseUrl.length > 0) {
    return initializeDatabaseRuntime(
      () => postgresDatabaseRuntime(databaseUrl),
      "database runtime ready: postgres",
      credentialCipher,
    );
  }

  return initializeDatabaseRuntime(
    () => embeddedDatabaseRuntime(hubDataDirectory),
    `database runtime ready: embedded (${hubDataDirectory})`,
    credentialCipher,
  );
}

async function initializeDatabaseRuntime(
  createRuntime: () => Promise<DatabaseRuntimeBundle>,
  readyMessage: string,
  credentialCipher: CredentialCipher,
): Promise<DatabaseRuntimeBundle & { database: Database }> {
  let bundle: DatabaseRuntimeBundle | undefined;
  try {
    bundle = await createRuntime();
    await bundle.runtime.migrate();
    logger.info(readyMessage);
    return {
      ...bundle,
      database: createDatabase(bundle.runtime, bundle.locks, credentialCipher),
    };
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
    reportFailure(error, {
      operation: "database.startup",
      component: "database",
    });
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
  credentialCipher: CredentialCipher,
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
    credentialCipher,
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
  // COMPAT(clisbot-env-alias): fork operator namespace + shared home, applied at
  // process entry (implementation doc §4.5 / plan §14.8). No-op unless the operator
  // set a CLISBOT_* var or left the fork defaults unset.
  applyClisbotEnvDefaults();
  const build = await loadBuiltStartServer();
  await build.startProductionRuntime();
  const config = loadRuntimeConfig();
  const port = readPort();
  const canonicalRequestOrigin = nonEmptyEnvironment(process.env["PASEO_HUB_APP_URL"]);
  // COMPAT(clisbot-control-plane): admission is closed before anything is torn
  // down (D-W4-05). Without it the first shutdown step disposed the runtime
  // while the listener was still accepting, so a request that arrived during
  // the teardown reached a half-disposed database or supervisor.
  const admission = createHttpAdmission((request) => build.default.fetch(request));
  const server = createFetchServer((request) => admission.fetch(request), {
    ...(config.trustedClientIpHeader === undefined
      ? {}
      : { trustedClientIpHeader: config.trustedClientIpHeader }),
    ...(canonicalRequestOrigin === undefined ? {} : { canonicalRequestOrigin }),
  });
  server.on("upgrade", (request, socket, head) => {
    if (!admission.open) {
      socket.destroy();
      return;
    }
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

  // COMPAT(clisbot-control-plane): bounded, twice-signalable shutdown
  // (D-W4-05). Installed with `on`, not `once`: the handler itself decides
  // what a repeat signal means, so a second SIGTERM always ends the process.
  const stopAfterSignal = createSignalShutdown({
    sequence: {
      steps: [
        {
          // Before anything is disposed: new HTTP requests and new daemon
          // upgrades stop being accepted, and the ones in flight finish.
          name: "admission",
          run: async () => {
            admission.close();
          },
        },
        {
          // First, because it stops ADMISSION. The composed runtime's
          // disposal chain runs in reverse acquisition order, and
          // `application-runtime.ts` registers the channel supervisor's
          // `stopAll` last for exactly that reason: the account transports
          // (Slack Socket Mode, Telegram getUpdates) stop taking inbound
          // before the hub's daemon links and the database close.
          name: "runtime",
          run: () => build.stopProductionRuntime(),
        },
        {
          // Then the listener. The order is load-bearing — see
          // `closeHttpListener`.
          name: "listener",
          run: () => closeHttpListener(server),
        },
      ],
      // Idempotent: `stopApplication` clears the runtime singleton, so this is
      // a no-op after a clean stop and finishes the disposal chain (including
      // the embedded database close that unlinks the data-directory lock)
      // when a step threw before it ran.
      release: () => build.stopProductionRuntime(),
    },
    exit: (code) => {
      removeProcessFailureHandlers();
      process.exit(code);
    },
    logger,
  });
  process.on("SIGTERM", () => stopAfterSignal("SIGTERM"));
  process.on("SIGINT", () => stopAfterSignal("SIGINT"));
}

/** HTTP admission, as one switch the shutdown sequence can throw.
 *
 * A closed gate answers every new request 503 with `retry-after` and refuses
 * new WebSocket upgrades; requests already inside the handler run to
 * completion, which is what makes it safe to dispose the runtime next. */
export function createHttpAdmission(handler: (request: Request) => Promise<Response> | Response): {
  readonly open: boolean;
  fetch(request: Request): Promise<Response>;
  close(): void;
} {
  let open = true;
  return {
    get open() {
      return open;
    },
    close(): void {
      open = false;
    },
    async fetch(request: Request): Promise<Response> {
      if (!open) {
        return new Response("The Hub is shutting down.", {
          status: 503,
          headers: { "retry-after": "5", connection: "close" },
        });
      }
      return await handler(request);
    },
  };
}

/**
 * The production stop sequence: stop the runtime FIRST, then close the
 * listener (the same order the test harnesses use — `hub-harness.ts`
 * `stopApp`, `hub-child.ts` `shutdown`). The signal path runs these as two
 * ordered steps of `createSignalShutdown`; this composition stays for the
 * harnesses that stop the server without a signal.
 */
export async function stopProductionServer(
  server: Server,
  stopRuntime: () => Promise<void>,
): Promise<void> {
  await stopRuntime();
  await closeHttpListener(server);
}

/**
 * Drain and close the listener. Runs only AFTER the runtime stop: the daemon's
 * accepted WebSocket is an active connection the http server-level
 * `closeIdleConnections` / `closeAllConnections` cannot reach — an upgraded
 * socket leaves the http connection tracker on Node 22, so a bare
 * `server.close()` hangs on it.
 */
export async function closeHttpListener(server: Server): Promise<void> {
  // Drain the remaining sockets with the same duck-typed guard the test
  // harnesses use. `Server` is a minimal interface, so probe with `in` before
  // calling rather than assuming the method exists.
  if ("closeIdleConnections" in server) server.closeIdleConnections();
  if ("closeAllConnections" in server) server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
    reportFailure(error, {
      operation: "server.startup.fatal",
      component: "server",
    });
    process.exit(1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHubCommandLine();
