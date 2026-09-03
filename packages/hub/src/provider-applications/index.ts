import type { AccountAccessValue } from "../auth/organization-access.js";
import type { BindLinearConnectionInput, BindSlackConnectionInput } from "../db/types.js";
import type { LinearInstallation } from "../providers/linear/client.js";
import type { SlackSocketInstallationVerifier } from "../providers/slack/installation.js";
import type { SlackDeliveryStatus } from "../triggers/slack/source/index.js";
import { TRUSTED_REQUEST_ORIGIN_HEADER } from "../http/request-origin.js";
import { parseProviderApplicationConfiguration } from "./internal/store.js";
import { reportFailure } from "../failures/index.js";

export const PROVIDERS = ["github", "slack", "discord", "linear"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface GitHubProviderApplicationConfiguration {
  provider: "github";
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  /** Absent until the operator sets up event triggers, which need a public HTTPS address. */
  webhookSecret?: string;
  expectedVersion?: number;
}

export type SlackProviderApplicationConfiguration =
  | {
      provider: "slack";
      transport: "socket";
      appId: string;
      appToken: string;
      expectedVersion?: number;
    }
  | {
      provider: "slack";
      transport: "webhook";
      appId: string;
      clientId: string;
      clientSecret: string;
      signingSecret: string;
      expectedVersion?: number;
    };

export interface DiscordProviderApplicationConfiguration {
  provider: "discord";
  applicationId: string;
  clientSecret: string;
  botToken: string;
  expectedVersion?: number;
}

export interface LinearProviderApplicationConfiguration {
  provider: "linear";
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  expectedVersion?: number;
}

export type ProviderApplicationConfiguration =
  | GitHubProviderApplicationConfiguration
  | SlackProviderApplicationConfiguration
  | DiscordProviderApplicationConfiguration
  | LinearProviderApplicationConfiguration;

export type ProviderApplicationIdentity =
  | { provider: "github"; id: string; name: string; ownerLogin: string }
  | { provider: "slack"; id: string; name: string }
  | { provider: "discord"; id: string; name: string }
  | { provider: "linear"; id: string; name: string };

export interface StoredProviderApplication {
  provider: Provider;
  configuration: ProviderApplicationConfiguration;
  identity: ProviderApplicationIdentity;
  version: number;
  verifiedAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface ProviderApplicationStore {
  read(
    provider: Provider,
    providerApplicationId: string,
  ): Promise<StoredProviderApplication | undefined>;
  list(provider: Provider): Promise<readonly StoredProviderApplication[]>;
  readAll(): Promise<readonly StoredProviderApplication[]>;
  save(input: {
    provider: Provider;
    configuration: ProviderApplicationConfiguration;
    identity: ProviderApplicationIdentity;
    expectedVersion: number | undefined;
    updatedByUserId: string;
  }): Promise<StoredProviderApplication>;
  activate(input: {
    provider: Provider;
    identity: ProviderApplicationIdentity;
    configurationVersion: number;
  }): Promise<void>;
  completeSlackInstallation(input: {
    configuration: SlackProviderApplicationConfiguration;
    identity: Extract<ProviderApplicationIdentity, { provider: "slack" }>;
    expectedVersion: number | undefined;
    updatedByUserId: string;
    binding: BindSlackConnectionInput;
  }): Promise<void>;
  completeSlackSocketApplication(input: {
    configuration: Extract<SlackProviderApplicationConfiguration, { transport: "socket" }>;
    identity: Extract<ProviderApplicationIdentity, { provider: "slack" }>;
    expectedVersion: number | undefined;
    updatedByUserId: string;
    organizationId: string;
    installation: VerifiedSlackInstallation;
  }): Promise<StoredProviderApplication>;
  completeLinearInstallation(input: {
    configuration: LinearProviderApplicationConfiguration;
    identity: Extract<ProviderApplicationIdentity, { provider: "linear" }>;
    expectedVersion: number | undefined;
    updatedByUserId: string;
    installation: LinearInstallation;
    binding: BindLinearConnectionInput;
  }): Promise<void>;
}

export interface ProviderRuntimeCandidate {
  start(): Promise<void>;
  beginConnection?(request: Request): Promise<{ url: string }>;
  /** Publication is an in-memory pointer replacement and must not perform fallible work. */
  publish(): void;
  close(): Promise<void>;
}

export interface ProviderRuntimeOwner {
  prepare(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
    callbackOrigin: string,
    identity: ProviderApplicationIdentity,
    configurationVersion: number,
    activation?: {
      expectedConfigurationVersion: number | undefined;
      activateConfiguration: boolean;
    },
  ): Promise<ProviderRuntimeCandidate>;
  identity?(
    provider: Provider,
    providerApplicationId: string,
  ): ProviderApplicationIdentity | undefined;
  onSlackInstallation?(
    handler: (input: {
      configuration: unknown;
      expectedConfigurationVersion: number | undefined;
      callbackOrigin: string;
      userId: string;
      installation: VerifiedSlackInstallation;
      binding: BindSlackConnectionInput;
    }) => Promise<void>,
  ): void;
  onLinearInstallation?(
    handler: (input: {
      configuration: unknown;
      expectedConfigurationVersion: number | undefined;
      callbackOrigin: string;
      userId: string;
      installation: LinearInstallation;
      binding: BindLinearConnectionInput;
    }) => Promise<void>,
  ): void;
}

export interface ProviderApplicationVerifier {
  verify(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
  ): Promise<ProviderApplicationIdentity>;
}

export interface ConnectedProviderIdentity {
  id: string;
  name: string;
  applicationId: string | null;
  status: "connected" | "actionNeeded";
}

export interface ProviderApplicationInventory {
  connectedIdentities(
    provider: Provider,
    providerApplicationId?: string,
  ): Promise<readonly ConnectedProviderIdentity[]>;
  /** Durably assigns pre-feature, unowned connections before their environment runtime publishes. */
  claimLegacyConnections(
    provider: Provider,
    identity: ProviderApplicationIdentity,
  ): Promise<boolean>;
  lastEventAt(
    provider: Provider,
    identity: ProviderApplicationIdentity,
    configurationVersion: number,
  ): Promise<Date | null>;
}

export type ProviderApplicationStatus =
  | "notConfigured"
  | "verified"
  | "connected"
  | "actionNeeded"
  | "managedByEnvironment";

export interface ProviderApplicationView {
  provider: Provider;
  status: ProviderApplicationStatus;
  managedByEnvironment: boolean;
  identifiers: Readonly<Record<string, string>>;
  identity: ProviderApplicationIdentity | null;
  connections: readonly ConnectedProviderIdentity[];
  /**
   * Whether inbound deliveries can be admitted at all. GitHub's webhook secret is optional, and
   * without it every delivery is rejected — so the surface must not offer to wait for an event
   * that can never be accepted.
   */
  eventsConfigured: boolean;
  lastEventAt: string | null;
  replaceable: boolean;
  configurationVersion: number | null;
  deliveryStatus?: SlackDeliveryStatus;
}

export interface ProviderApplicationOverview {
  callbackOrigin: string;
  providers: Record<Provider, ProviderApplicationView>;
  applications: Record<Provider, readonly ProviderApplicationView[]>;
}

/** A verified Application that an organization manager may use to create a Connection. */
export interface ProviderApplicationCatalogEntry {
  provider: Provider;
  id: string;
  name: string;
}

export interface ProviderApplicationResult {
  status: "verified";
  provider: Provider;
  identity: ProviderApplicationIdentity;
  configurationVersion: number;
}

export interface ProviderApplicationContinuation {
  status: "continuing";
  provider: "slack" | "linear";
  url: string;
}

export type ProviderApplicationSaveResult =
  | ProviderApplicationResult
  | ProviderApplicationContinuation;

export interface VerifiedSlackInstallation {
  appId: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botAccessToken: string;
  scopes: string[];
}

export type ProviderApplicationErrorCode =
  | "forbidden"
  | "invalidOrigin"
  | "invalidInput"
  | "credentialsRejected"
  | "permissionMissing"
  | "rateLimited"
  | "network"
  | "timeout"
  | "upstreamUnavailable"
  | "invalidResponse"
  | "internal"
  | "identityConflict"
  | "configurationConflict"
  | "managedByEnvironment"
  | "httpsRequired";

export class ProviderApplicationError extends Error {
  constructor(
    readonly code: ProviderApplicationErrorCode,
    readonly safeContext?: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ProviderApplicationError";
  }
}

/**
 * Which credential the provider actually objected to. Collapsing "this secret is wrong" into
 * "these credentials are wrong" sends the operator back to the portal to re-copy every field,
 * and collapsing "this belongs to a different app" into either one sends them looking for a
 * typo that is not there.
 */
export type ProviderVerificationSubject =
  | "appToken"
  | "botToken"
  | "clientSecret"
  | "privateKey"
  | "identityMismatch";

export class ProviderVerificationError extends Error {
  constructor(
    readonly reason:
      | "credentialsRejected"
      | "permissionMissing"
      | "rateLimited"
      | "network"
      | "timeout"
      | "upstreamUnavailable"
      | "invalidResponse",
    readonly safeStatus?: number,
    options?: ErrorOptions & { subject?: ProviderVerificationSubject },
  ) {
    super(reason, options);
    this.name = "ProviderVerificationError";
    this.subject = options?.subject;
  }

  readonly subject: ProviderVerificationSubject | undefined;
}

/**
 * Which first-party surface an OAuth or install round trip has to come back to. An enum rather
 * than a caller-supplied route keeps the redirect allowlisted while the legacy Hub pages and the
 * unified Paseo client coexist.
 */
export type ProviderApplicationSurface = "appSetup" | "apps" | "paseo";

export const PROVIDER_APPLICATION_RETURN_ROUTES: Readonly<
  Record<ProviderApplicationSurface, string>
> = { appSetup: "/", apps: "/apps", paseo: "/settings/hub/configuration" };

export function providerApplicationReturnRoute(
  surface: ProviderApplicationSurface | undefined,
): string {
  return PROVIDER_APPLICATION_RETURN_ROUTES[surface ?? "apps"];
}

export interface ProviderApplications {
  overview(request: Request): Promise<ProviderApplicationOverview>;
  connectionCatalog(request: Request): Promise<readonly ProviderApplicationCatalogEntry[]>;
  verifyAndSave(
    request: Request,
    provider: Provider,
    input: ProviderApplicationConfiguration,
    surface?: ProviderApplicationSurface,
  ): Promise<ProviderApplicationSaveResult>;
  beginConnection(
    request: Request,
    provider: Provider,
    providerApplicationId: string,
    organizationId: string,
    surface?: ProviderApplicationSurface,
  ): Promise<{ url: string }>;
  configureSlackSocket(
    request: Request,
    input: { appToken: string; botToken: string; expectedVersion?: number },
  ): Promise<ProviderApplicationResult>;
  retrySlackSocket(request: Request, providerApplicationId: string): Promise<void>;
  /** Redacted post-commit signal; optional for older/injected implementations. */
  onConfigurationChanged?(
    listener: (change: ProviderApplicationConfigurationChange) => Promise<void>,
  ): () => void;
}

export interface ProviderApplicationConfigurationChange {
  provider: Provider;
  providerApplicationId: string;
}

interface ProviderApplicationsOptions {
  auth: {
    resolveAccount(request: Request): Promise<AccountAccessValue>;
    rejectCookieMutation(request: Request): Response | undefined;
  };
  store: ProviderApplicationStore;
  environment: Partial<Record<Provider, ProviderApplicationConfiguration>>;
  runtime: ProviderRuntimeOwner;
  verifier: ProviderApplicationVerifier;
  inventory: ProviderApplicationInventory;
  callbackOrigin(request: Request): string | Promise<string>;
  beginCandidateConnection?: (
    request: Request,
    organizationId: string,
    returnRoute: string,
    begin: (request: Request) => Promise<{ url: string }>,
  ) => Promise<{ url: string }>;
  slackSocketVerifier?: SlackSocketInstallationVerifier;
  slackDelivery?: {
    status(providerApplicationId?: string): SlackDeliveryStatus;
    retry(providerApplicationId?: string): Promise<void>;
  };
}

export function createProviderApplications(
  options: ProviderApplicationsOptions,
): ProviderApplications {
  const queues = new Map<Provider, Promise<void>>();
  const configurationListeners = new Set<
    (change: ProviderApplicationConfigurationChange) => Promise<void>
  >();
  options.runtime.onSlackInstallation?.((input) =>
    serialize(queues, "slack", () =>
      completeSlackInstallation(options, input, configurationListeners),
    ),
  );
  options.runtime.onLinearInstallation?.((input) =>
    serialize(queues, "linear", () =>
      completeLinearInstallation(options, input, configurationListeners),
    ),
  );

  return {
    onConfigurationChanged(listener) {
      configurationListeners.add(listener);
      return () => configurationListeners.delete(listener);
    },
    async overview(request) {
      await requireOperator(options, request);
      const callbackOrigin = await safeCallbackOrigin(options, request);
      const stored = await options.store.readAll();
      const entries = await Promise.all(
        // eslint-disable-next-line complexity -- this is the single projection of provider state.
        PROVIDERS.map(async (provider) => {
          const environment = options.environment[provider];
          const persisted = stored.find((application) => application.provider === provider);
          const resolved = environment ?? persisted?.configuration;
          const connections = await options.inventory.connectedIdentities(provider);
          const identity =
            (persisted === undefined
              ? undefined
              : options.runtime.identity?.(provider, persisted.identity.id)) ??
            persisted?.identity ??
            null;
          const status = providerStatus(environment !== undefined, identity, connections);
          const configurationVersion = environment === undefined ? (persisted?.version ?? null) : 0;
          const deliveryStatus =
            provider === "slack"
              ? options.slackDelivery?.status(identity?.id ?? undefined)
              : undefined;
          const view: ProviderApplicationView = {
            provider,
            status,
            managedByEnvironment: environment !== undefined,
            identifiers: resolved === undefined ? {} : publicIdentifiers(resolved),
            identity,
            connections,
            eventsConfigured: acceptsEvents(resolved),
            lastEventAt:
              provider === "discord" || identity === null || configurationVersion === null
                ? null
                : ((
                    await options.inventory.lastEventAt(provider, identity, configurationVersion)
                  )?.toISOString() ?? null),
            replaceable: connections.length === 0,
            configurationVersion,
            ...(deliveryStatus === undefined ? {} : { deliveryStatus }),
          };
          return [provider, view] as const;
        }),
      );
      const [github, slack, discord, linear] = entries.map(([, view]) => view);
      if (
        github === undefined ||
        slack === undefined ||
        discord === undefined ||
        linear === undefined
      ) {
        throw new Error("provider overview is incomplete");
      }
      const applications: Record<Provider, ProviderApplicationView[]> = {
        github: [],
        slack: [],
        discord: [],
        linear: [],
      };
      for (const provider of PROVIDERS) {
        applications[provider] = await Promise.all(
          stored
            .filter((application) => application.provider === provider)
            .map(async (application) => {
              const connections = await options.inventory.connectedIdentities(
                provider,
                application.identity.id,
              );
              const identity =
                options.runtime.identity?.(provider, application.identity.id) ??
                application.identity;
              const view: ProviderApplicationView = {
                provider,
                status: providerStatus(false, identity, connections),
                managedByEnvironment: false,
                identifiers: publicIdentifiers(application.configuration),
                identity,
                connections,
                eventsConfigured: acceptsEvents(application.configuration),
                lastEventAt:
                  provider === "discord"
                    ? null
                    : ((
                        await options.inventory.lastEventAt(provider, identity, application.version)
                      )?.toISOString() ?? null),
                replaceable: connections.length === 0,
                configurationVersion: application.version,
              };
              if (provider === "slack") {
                const deliveryStatus = options.slackDelivery?.status(application.identity.id);
                if (deliveryStatus !== undefined) view.deliveryStatus = deliveryStatus;
              }
              return view;
            }),
        );
      }
      return {
        callbackOrigin,
        providers: { github, slack, discord, linear },
        applications,
      };
    },

    async connectionCatalog(request) {
      await requireAccount(options, request);
      const stored = await options.store.readAll();
      const catalog = new Map<string, ProviderApplicationCatalogEntry>();
      for (const application of stored) {
        if (!supportsManagedConnection(application.configuration)) continue;
        catalog.set(`${application.provider}:${application.identity.id}`, {
          provider: application.provider,
          id: application.identity.id,
          name: application.identity.name,
        });
      }
      for (const provider of PROVIDERS) {
        const configuration = options.environment[provider];
        if (configuration === undefined || !supportsManagedConnection(configuration)) continue;
        const id = providerApplicationIdentityId(configuration);
        const identity = options.runtime.identity?.(provider, id);
        catalog.set(`${provider}:${id}`, {
          provider,
          id,
          name: identity?.name ?? id,
        });
      }
      return Array.from(catalog.values()).sort(
        (left, right) =>
          left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name),
      );
    },

    async verifyAndSave(request, provider, input, surface) {
      rejectMutation(options, request);
      const account = await requireOperator(options, request);
      const callbackOrigin = await safeCallbackOrigin(options, request);
      if (options.environment[provider] !== undefined) {
        throw new ProviderApplicationError("managedByEnvironment");
      }
      if (input.provider !== provider) throw new ProviderApplicationError("invalidInput");
      return serialize<ProviderApplicationSaveResult>(queues, provider, () => {
        const returnRoute = providerApplicationReturnRoute(surface);
        if (provider === "slack" && input.provider === "slack") {
          return beginSlackConfiguration(
            options,
            request,
            account,
            callbackOrigin,
            input,
            returnRoute,
          );
        }
        if (provider === "linear" && input.provider === "linear") {
          return beginLinearConfiguration(
            options,
            request,
            account,
            callbackOrigin,
            input,
            returnRoute,
          );
        }
        return verifyAndActivateProvider(
          options,
          account,
          provider,
          input,
          callbackOrigin,
          configurationListeners,
        );
      });
    },

    async beginConnection(request, provider, providerApplicationId, organizationId, surface) {
      rejectMutation(options, request);
      // The Application remains instance-operator managed, but an organization owner or admin may
      // create a Connection from an already verified Application. The provider's existing start
      // operation rechecks that organization authority before it persists an attempt.
      await requireAccount(options, request);
      const callbackOrigin = await safeCallbackOrigin(options, request);
      if (provider === "linear") requireHttpsOrigin(callbackOrigin);
      return serialize(queues, provider, async () => {
        const stored = await options.store.read(provider, providerApplicationId);
        const configuration = options.environment[provider] ?? stored?.configuration;
        if (configuration === undefined || options.beginCandidateConnection === undefined) {
          throw new ProviderApplicationError("invalidInput");
        }
        const configurationVersion =
          options.environment[provider] === undefined ? stored!.version : 0;
        const identity =
          options.runtime.identity?.(provider, providerApplicationId) ?? stored?.identity;
        if (identity === undefined) throw new ProviderApplicationError("invalidInput");
        let candidate: ProviderRuntimeCandidate | undefined;
        try {
          candidate = await options.runtime.prepare(
            provider,
            configuration,
            callbackOrigin,
            identity,
            configurationVersion,
          );
          if (candidate.beginConnection === undefined) {
            throw new Error("provider connection unavailable");
          }
          const result = await options.beginCandidateConnection(
            request,
            organizationId,
            providerApplicationReturnRoute(surface),
            (candidateRequest) => candidate!.beginConnection!(candidateRequest),
          );
          await candidate.close();
          return result;
        } catch (error) {
          await closeCandidate(candidate, provider, "begin_connection");
          if (error instanceof ProviderApplicationError) throw error;
          throw new ProviderApplicationError("internal", undefined, {
            cause: error,
          });
        }
      });
    },
    async configureSlackSocket(request, input) {
      rejectMutation(options, request);
      const account = await requireOperator(options, request);
      if (options.environment.slack !== undefined) {
        throw new ProviderApplicationError("managedByEnvironment");
      }
      if (options.slackSocketVerifier === undefined) {
        throw new ProviderApplicationError("internal");
      }
      return serialize(queues, "slack", async () => {
        if (!input.appToken.startsWith("xapp-") || !input.botToken.startsWith("xoxb-")) {
          throw new ProviderApplicationError("invalidInput");
        }
        const organizationId = account.session.activeOrganizationId;
        if (organizationId === null) throw new ProviderApplicationError("invalidInput");
        let installation: Awaited<ReturnType<SlackSocketInstallationVerifier["verify"]>>;
        try {
          installation = await options.slackSocketVerifier!.verify(input.appToken, input.botToken);
        } catch (error) {
          if (error instanceof ProviderVerificationError) {
            throw new ProviderApplicationError(error.reason, error.subject, {
              cause: error,
            });
          }
          throw new ProviderApplicationError("internal", undefined, {
            cause: error,
          });
        }
        const configuration = {
          provider: "slack" as const,
          transport: "socket" as const,
          appId: installation.appId,
          appToken: input.appToken,
        };
        const identity = {
          provider: "slack" as const,
          id: installation.appId,
          name: installation.appId,
        };
        let candidate: ProviderRuntimeCandidate | undefined;
        try {
          candidate = await options.runtime.prepare(
            "slack",
            configuration,
            await safeCallbackOrigin(options, request),
            identity,
            (input.expectedVersion ?? 0) + 1,
          );
          await candidate.start();
          const saved = await options.store.completeSlackSocketApplication({
            configuration,
            identity,
            expectedVersion: input.expectedVersion,
            updatedByUserId: account.account.id,
            organizationId,
            installation,
          });
          candidate.publish();
          candidate = undefined;
          await notifyConfigurationChanged(configurationListeners, {
            provider: "slack",
            providerApplicationId: identity.id,
          });
          return {
            status: "verified",
            provider: "slack",
            identity,
            configurationVersion: saved.version,
          };
        } catch (error) {
          await closeCandidate(candidate, "slack", "configure_socket");
          if (isConfigurationConflict(error)) {
            throw new ProviderApplicationError("configurationConflict");
          }
          if (isIdentityConflict(error)) {
            throw new ProviderApplicationError("identityConflict");
          }
          if (error instanceof ProviderApplicationError) throw error;
          throw new ProviderApplicationError("internal", undefined, {
            cause: error,
          });
        }
      });
    },
    async retrySlackSocket(request, providerApplicationId) {
      rejectMutation(options, request);
      await requireOperator(options, request);
      if (options.slackDelivery === undefined) {
        throw new ProviderApplicationError("invalidInput");
      }
      await options.slackDelivery.retry(providerApplicationId);
    },
  };
}

function rejectMutation(options: ProviderApplicationsOptions, request: Request): void {
  if (request.method !== "POST") throw new ProviderApplicationError("forbidden");
  if (options.auth.rejectCookieMutation(request) !== undefined) {
    throw new ProviderApplicationError("forbidden");
  }
}

async function requireOperator(
  options: ProviderApplicationsOptions,
  request: Request,
): Promise<AccountAccessValue> {
  const account = await requireAccount(options, request);
  if (!account.isInstanceOperator) throw new ProviderApplicationError("forbidden");
  return account;
}

async function requireAccount(
  options: ProviderApplicationsOptions,
  request: Request,
): Promise<AccountAccessValue> {
  let account: AccountAccessValue;
  try {
    account = await options.auth.resolveAccount(request);
  } catch (error) {
    throw new ProviderApplicationError("forbidden", undefined, {
      cause: error,
    });
  }
  return account;
}

async function safeCallbackOrigin(
  options: ProviderApplicationsOptions,
  request: Request,
): Promise<string> {
  try {
    return await options.callbackOrigin(request);
  } catch (error) {
    throw new ProviderApplicationError("invalidOrigin", undefined, {
      cause: error,
    });
  }
}

function serialize<T>(
  queues: Map<Provider, Promise<void>>,
  provider: Provider,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(provider) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(provider, settled);
  void settled.finally(() => {
    if (queues.get(provider) === settled) queues.delete(provider);
  });
  return result;
}

function providerStatus(
  environmentManaged: boolean,
  identity: ProviderApplicationIdentity | null,
  connections: readonly ConnectedProviderIdentity[],
): ProviderApplicationStatus {
  if (environmentManaged) return "managedByEnvironment";
  if (connections.some((connection) => connection.status === "actionNeeded")) return "actionNeeded";
  if (connections.length > 0) return "connected";
  return identity === null ? "notConfigured" : "verified";
}

/**
 * GitHub admits a delivery only when it can check the signature, so an App saved without a
 * webhook secret has repository access and no event triggers. Slack and Linear signing secrets
 * are part of their credentials, and Discord never delivers anything here.
 */
function acceptsEvents(configuration: ProviderApplicationConfiguration | undefined): boolean {
  if (configuration === undefined) return false;
  if (configuration.provider === "github") return (configuration.webhookSecret ?? "") !== "";
  return configuration.provider === "slack" || configuration.provider === "linear";
}

function publicIdentifiers(
  configuration: ProviderApplicationConfiguration,
): Readonly<Record<string, string>> {
  switch (configuration.provider) {
    case "github":
      return {
        appId: configuration.appId,
        appSlug: configuration.appSlug,
        clientId: configuration.clientId,
      };
    case "slack":
      return configuration.transport === "webhook"
        ? {
            appId: configuration.appId,
            transport: configuration.transport,
            clientId: configuration.clientId,
          }
        : { appId: configuration.appId, transport: configuration.transport };
    case "discord":
      return { applicationId: configuration.applicationId };
    case "linear":
      return { clientId: configuration.clientId };
  }
  throw new Error("unknown provider configuration");
}

function providerApplicationIdentityId(configuration: ProviderApplicationConfiguration): string {
  if (configuration.provider === "github" || configuration.provider === "slack") {
    return configuration.appId;
  }
  return configuration.provider === "discord"
    ? configuration.applicationId
    : configuration.clientId;
}

function supportsManagedConnection(configuration: ProviderApplicationConfiguration): boolean {
  return configuration.provider !== "slack" || configuration.transport === "webhook";
}

function withoutExpectedVersion(
  input: ProviderApplicationConfiguration,
): ProviderApplicationConfiguration {
  const { expectedVersion: _expectedVersion, ...configuration } = input;
  return configuration as ProviderApplicationConfiguration;
}

function sameExternalIdentity(
  left: ProviderApplicationIdentity,
  right: ProviderApplicationIdentity,
): boolean {
  return left.provider === right.provider && left.id === right.id;
}

function identityConflictsWithConnections(
  identity: ProviderApplicationIdentity,
  previous: StoredProviderApplication | undefined,
  connections: readonly ConnectedProviderIdentity[],
): boolean {
  if (connections.length === 0) return false;
  if (
    connections.some(
      (connection) => connection.applicationId !== null && connection.applicationId !== identity.id,
    )
  ) {
    return true;
  }
  return (
    connections.some((connection) => connection.applicationId === null) &&
    (previous === undefined || !sameExternalIdentity(previous.identity, identity))
  );
}

function isConfigurationConflict(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    Reflect.get(error, "name") === "ProviderConfigurationConflictError"
  );
}

function isIdentityConflict(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    Reflect.get(error, "name") === "ProviderApplicationIdentityConflictError"
  );
}

export { TRUSTED_REQUEST_ORIGIN_HEADER } from "../http/request-origin.js";

export function resolveCallbackOrigin(request: Request, explicitAppUrl?: string): string {
  const browserValue = request.headers.get("origin") ?? request.headers.get("referer");
  if (browserValue === null || browserValue === "null") throw new Error("invalid browser origin");
  const browserOrigin = parseHttpOrigin(browserValue);
  const expectedOrigin =
    explicitAppUrl === undefined
      ? request.headers.get(TRUSTED_REQUEST_ORIGIN_HEADER)
      : parseHttpOrigin(explicitAppUrl);
  if (expectedOrigin === null || parseHttpOrigin(expectedOrigin) !== browserOrigin) {
    throw new Error("browser origin does not match trusted request origin");
  }
  return browserOrigin;
}

export { createProviderApplicationStore } from "./internal/store.js";
export { parseProviderApplicationConfiguration } from "./internal/store.js";
export { readProviderApplicationEnvironment } from "./internal/environment.js";
export { createProviderApplicationVerifier } from "./internal/verifier.js";
export { DynamicProviderRuntime } from "./internal/runtime-owner.js";
export { createProviderApplicationInventory } from "./internal/inventory.js";

export async function activateProviderApplicationsAtStartup(options: {
  store: ProviderApplicationStore;
  environment: Partial<Record<Provider, ProviderApplicationConfiguration>>;
  runtime: ProviderRuntimeOwner;
  verifier: ProviderApplicationVerifier;
  inventory: ProviderApplicationInventory;
  callbackOrigin: string;
}): Promise<readonly { provider: Provider; error: unknown }[]> {
  const failures: { provider: Provider; error: unknown }[] = [];
  const storedProviders = await options.store.readAll();
  for (const provider of PROVIDERS) {
    const environmentConfiguration = options.environment[provider];
    const persisted = storedProviders.filter((application) => application.provider === provider);
    const applications =
      environmentConfiguration === undefined
        ? persisted.map((stored) => ({
            configuration: stored.configuration,
            stored,
          }))
        : [{ configuration: environmentConfiguration, stored: undefined }];
    for (const application of applications) {
      try {
        const identity = await startupIdentity(
          provider,
          environmentConfiguration,
          application.stored,
          options.verifier,
        );
        let candidate: ProviderRuntimeCandidate | undefined;
        try {
          const configurationVersion = application.stored?.version ?? 0;
          candidate = await options.runtime.prepare(
            provider,
            application.configuration,
            options.callbackOrigin,
            identity,
            configurationVersion,
          );
          await candidate.start();
          await options.store.activate({
            provider,
            identity,
            configurationVersion,
          });
          candidate.publish();
          candidate = undefined;
        } catch (error) {
          await closeCandidate(candidate, provider, "activate_at_startup");
          throw error;
        }
      } catch (error) {
        failures.push({ provider, error });
      }
    }
  }
  return failures;
}

async function startupIdentity(
  provider: Provider,
  environmentConfiguration: ProviderApplicationConfiguration | undefined,
  stored: StoredProviderApplication | undefined,
  verifier: ProviderApplicationVerifier,
): Promise<ProviderApplicationIdentity> {
  if (environmentConfiguration === undefined) {
    if (stored === undefined) throw new Error("stored provider application unavailable");
    return stored.identity;
  }
  if (provider === "slack" && environmentConfiguration.provider === "slack") {
    return {
      provider: "slack",
      id: environmentConfiguration.appId,
      name: "Slack app",
    };
  }
  if (provider === "linear" && environmentConfiguration.provider === "linear") {
    return {
      provider: "linear",
      id: environmentConfiguration.clientId,
      name: "Linear app",
    };
  }
  return verifier.verify(provider, environmentConfiguration);
}

function parseHttpOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid origin");
  if (url.username !== "" || url.password !== "") throw new Error("invalid origin");
  return url.origin;
}

function requireHttpsOrigin(callbackOrigin: string): void {
  if (!callbackOrigin.startsWith("https://")) {
    throw new ProviderApplicationError("httpsRequired", callbackOrigin);
  }
}

async function beginSlackConfiguration(
  options: ProviderApplicationsOptions,
  request: Request,
  account: AccountAccessValue,
  callbackOrigin: string,
  input: SlackProviderApplicationConfiguration,
  returnRoute: string,
): Promise<ProviderApplicationContinuation> {
  requireHttpsOrigin(callbackOrigin);
  const previous = await options.store.read("slack", input.appId);
  if (previous?.version !== input.expectedVersion) {
    throw new ProviderApplicationError("configurationConflict");
  }
  const organizationId = account.session.activeOrganizationId;
  if (organizationId === null || options.beginCandidateConnection === undefined) {
    throw new ProviderApplicationError("invalidInput");
  }
  const candidate = await options.runtime.prepare(
    "slack",
    withoutExpectedVersion(input),
    callbackOrigin,
    { provider: "slack", id: input.appId, name: input.appId },
    (input.expectedVersion ?? 0) + 1,
    {
      expectedConfigurationVersion: input.expectedVersion,
      activateConfiguration: true,
    },
  );
  if (candidate.beginConnection === undefined) {
    await closeCandidate(candidate, "slack", "begin_configuration");
    throw new ProviderApplicationError("internal");
  }
  try {
    const { url } = await options.beginCandidateConnection(
      request,
      organizationId,
      returnRoute,
      (candidateRequest) => {
        const result = candidate.beginConnection?.(candidateRequest);
        return result ?? Promise.reject(new Error("provider unavailable"));
      },
    );
    await candidate.close();
    return { status: "continuing", provider: "slack", url };
  } catch (error) {
    await closeCandidate(candidate, "slack", "begin_configuration");
    if (error instanceof ProviderApplicationError) throw error;
    throw new ProviderApplicationError("internal", undefined, { cause: error });
  }
}

/**
 * Linear cannot verify an OAuth client's secret without an authorization grant. Treat saving
 * credentials as a candidate connection: the callback verifies the grant, persists the app and
 * workspace binding atomically, then publishes the prepared runtime.
 */
async function beginLinearConfiguration(
  options: ProviderApplicationsOptions,
  request: Request,
  account: AccountAccessValue,
  callbackOrigin: string,
  input: LinearProviderApplicationConfiguration,
  returnRoute: string,
): Promise<ProviderApplicationContinuation> {
  requireHttpsOrigin(callbackOrigin);
  const previous = await options.store.read("linear", input.clientId);
  if (previous?.version !== input.expectedVersion) {
    throw new ProviderApplicationError("configurationConflict");
  }
  const organizationId = account.session.activeOrganizationId;
  if (organizationId === null || options.beginCandidateConnection === undefined) {
    throw new ProviderApplicationError("invalidInput");
  }
  const candidate = await options.runtime.prepare(
    "linear",
    withoutExpectedVersion(input),
    callbackOrigin,
    { provider: "linear", id: input.clientId, name: "Linear app" },
    (input.expectedVersion ?? 0) + 1,
    {
      expectedConfigurationVersion: input.expectedVersion,
      activateConfiguration: true,
    },
  );
  if (candidate.beginConnection === undefined) {
    await closeCandidate(candidate, "linear", "begin_configuration");
    throw new ProviderApplicationError("internal");
  }
  try {
    const { url } = await options.beginCandidateConnection(
      request,
      organizationId,
      returnRoute,
      (candidateRequest) => {
        const result = candidate.beginConnection?.(candidateRequest);
        return result ?? Promise.reject(new Error("provider unavailable"));
      },
    );
    await candidate.close();
    return { status: "continuing", provider: "linear", url };
  } catch (error) {
    await closeCandidate(candidate, "linear", "begin_configuration");
    if (error instanceof ProviderApplicationError) throw error;
    throw new ProviderApplicationError("internal", undefined, { cause: error });
  }
}

async function verifyAndActivateProvider(
  options: ProviderApplicationsOptions,
  account: AccountAccessValue,
  provider: Provider,
  input: ProviderApplicationConfiguration,
  callbackOrigin: string,
  configurationListeners: ReadonlySet<
    (change: ProviderApplicationConfigurationChange) => Promise<void>
  >,
): Promise<ProviderApplicationResult> {
  let identity: ProviderApplicationIdentity;
  try {
    identity = await options.verifier.verify(provider, input);
  } catch (error) {
    if (error instanceof ProviderVerificationError) {
      // The subject travels as safe context so the copy can name the field the provider
      // objected to instead of sending the operator back over all of them.
      throw new ProviderApplicationError(error.reason, error.subject, {
        cause: error,
      });
    }
    throw new ProviderApplicationError("internal", undefined, { cause: error });
  }
  if (identity.provider !== provider) throw new ProviderApplicationError("credentialsRejected");
  const previous = await options.store.read(provider, identity.id);
  const connections = await options.inventory.connectedIdentities(provider, identity.id);
  if (identityConflictsWithConnections(identity, previous, connections)) {
    throw new ProviderApplicationError("identityConflict", previous?.identity.name);
  }
  let candidate: ProviderRuntimeCandidate | undefined;
  try {
    candidate = await options.runtime.prepare(
      provider,
      withoutExpectedVersion(input),
      callbackOrigin,
      identity,
      (input.expectedVersion ?? 0) + 1,
    );
    await candidate.start();
    const saved = await options.store.save({
      provider,
      configuration: withoutExpectedVersion(input),
      identity,
      expectedVersion: input.expectedVersion,
      updatedByUserId: account.account.id,
    });
    candidate.publish();
    candidate = undefined;
    await notifyConfigurationChanged(configurationListeners, {
      provider,
      providerApplicationId: identity.id,
    });
    return {
      status: "verified",
      provider,
      identity,
      configurationVersion: saved.version,
    };
  } catch (error) {
    await closeCandidate(candidate, provider, "verify_and_save");
    if (error instanceof ProviderApplicationError) throw error;
    const gateway = provider === "discord" ? discordGatewayFailure(error) : undefined;
    if (gateway !== undefined) {
      throw new ProviderApplicationError(gateway.code, discordGatewayContext(gateway.failure), {
        cause: error,
      });
    }
    if (isIdentityConflict(error)) {
      throw new ProviderApplicationError("identityConflict", previous?.identity.name);
    }
    if (isConfigurationConflict(error)) {
      throw new ProviderApplicationError("configurationConflict");
    }
    throw new ProviderApplicationError("internal", undefined, { cause: error });
  }
}

function discordGatewayContext(failure: string): string {
  return `discordGateway${failure[0]?.toUpperCase()}${failure.slice(1)}`;
}

function discordGatewayFailure(error: unknown):
  | {
      code: "credentialsRejected" | "permissionMissing" | "internal";
      failure: string;
    }
  | undefined {
  if (!(error instanceof Error) || error.name !== "DiscordGatewayError") return undefined;
  const code: unknown = Reflect.get(error, "code");
  const failure: unknown = Reflect.get(error, "gatewayFailure");
  if (
    (code !== "credentialsRejected" && code !== "permissionMissing" && code !== "internal") ||
    typeof failure !== "string"
  ) {
    return undefined;
  }
  return { code, failure };
}

async function completeSlackInstallation(
  options: ProviderApplicationsOptions,
  input: {
    configuration: unknown;
    expectedConfigurationVersion: number | undefined;
    callbackOrigin: string;
    userId: string;
    installation: VerifiedSlackInstallation;
    binding: BindSlackConnectionInput;
  },
  configurationListeners: ReadonlySet<
    (change: ProviderApplicationConfigurationChange) => Promise<void>
  >,
): Promise<void> {
  const configuration = parseProviderApplicationConfiguration(input.configuration);
  if (configuration.provider !== "slack" || configuration.appId !== input.installation.appId) {
    throw new ProviderApplicationError("credentialsRejected");
  }
  const previous = await options.store.read("slack", input.installation.appId);
  const identity: ProviderApplicationIdentity = {
    provider: "slack",
    id: input.installation.appId,
    name: input.installation.appId,
  };
  const connections = await options.inventory.connectedIdentities("slack", identity.id);
  if (identityConflictsWithConnections(identity, previous, connections)) {
    throw new ProviderApplicationError("identityConflict", previous?.identity.name);
  }
  let candidate: ProviderRuntimeCandidate | undefined;
  try {
    candidate = await options.runtime.prepare(
      "slack",
      configuration,
      input.callbackOrigin,
      identity,
      (input.expectedConfigurationVersion ?? 0) + 1,
    );
    await candidate.start();
    await options.store.completeSlackInstallation({
      configuration,
      identity,
      expectedVersion: input.expectedConfigurationVersion,
      updatedByUserId: input.userId,
      binding: input.binding,
    });
    candidate.publish();
    candidate = undefined;
    await notifyConfigurationChanged(configurationListeners, {
      provider: "slack",
      providerApplicationId: identity.id,
    });
  } catch (error) {
    await closeCandidate(candidate, "slack", "complete_installation");
    throw error;
  }
}

async function completeLinearInstallation(
  options: ProviderApplicationsOptions,
  input: {
    configuration: unknown;
    expectedConfigurationVersion: number | undefined;
    callbackOrigin: string;
    userId: string;
    installation: LinearInstallation;
    binding: BindLinearConnectionInput;
  },
  configurationListeners: ReadonlySet<
    (change: ProviderApplicationConfigurationChange) => Promise<void>
  >,
): Promise<void> {
  const configuration = parseProviderApplicationConfiguration(input.configuration);
  if (
    configuration.provider !== "linear" ||
    configuration.clientId !== input.binding.providerApplicationId
  ) {
    throw new ProviderApplicationError("credentialsRejected");
  }
  const previous = await options.store.read("linear", input.binding.providerApplicationId);
  const connections = await options.inventory.connectedIdentities(
    "linear",
    input.binding.providerApplicationId,
  );
  const identity: ProviderApplicationIdentity = {
    provider: "linear",
    id: configuration.clientId,
    name: "Linear app",
  };
  if (identityConflictsWithConnections(identity, previous, connections)) {
    throw new ProviderApplicationError("identityConflict", previous?.identity.name);
  }
  let candidate: ProviderRuntimeCandidate | undefined;
  try {
    candidate = await options.runtime.prepare(
      "linear",
      configuration,
      input.callbackOrigin,
      identity,
      (input.expectedConfigurationVersion ?? 0) + 1,
    );
    await candidate.start();
    await options.store.completeLinearInstallation({
      configuration,
      identity,
      expectedVersion: input.expectedConfigurationVersion,
      updatedByUserId: input.userId,
      installation: input.installation,
      binding: input.binding,
    });
    candidate.publish();
    candidate = undefined;
    await notifyConfigurationChanged(configurationListeners, {
      provider: "linear",
      providerApplicationId: identity.id,
    });
  } catch (error) {
    await closeCandidate(candidate, "linear", "complete_installation");
    throw error;
  }
}

async function notifyConfigurationChanged(
  listeners: ReadonlySet<(change: ProviderApplicationConfigurationChange) => Promise<void>>,
  change: ProviderApplicationConfigurationChange,
): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(change);
    } catch (error) {
      reportFailure(error, {
        operation: "provider_application.configuration_changed.notify",
        component: "provider_applications",
        provider: change.provider,
      });
    }
  }
}

async function closeCandidate(
  candidate: ProviderRuntimeCandidate | undefined,
  provider: Provider,
  parentOperation: string,
): Promise<void> {
  if (candidate === undefined) return;
  try {
    await candidate.close();
  } catch (error) {
    reportFailure(error, {
      operation: `provider_application.${parentOperation}.cleanup`,
      component: "provider_applications",
      provider,
    });
  }
}
