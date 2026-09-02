import type { AuthServer } from "../../auth/server.js";
import { createHash } from "node:crypto";
import type { GitHubConfigurationProvider } from "../../configuration/github-sync.js";
import type { Database } from "../../db/types.js";
import { outputContextProvider, replyOutputTool } from "../../execution-capabilities/outputs.js";
import { logger } from "../../logger.js";
import { reportFailure } from "../../failures/index.js";
import { createDiscordRegistration } from "../../providers/discord/index.js";
import { createGitHubRegistration } from "../../providers/github/index.js";
import { createLinearRegistration } from "../../providers/linear/index.js";
import type {
  ProviderRegistration,
  TriggerProviderResources,
} from "../../providers/registration.js";
import { createSlackRegistration } from "../../providers/slack/index.js";
import type { TriggerHandler, TriggerProvider, TriggerSource } from "../../triggers/index.js";
import type {
  Provider,
  ProviderApplicationConfiguration,
  ProviderApplicationIdentity,
  ProviderRuntimeCandidate,
  ProviderRuntimeOwner,
} from "../index.js";
import { parseProviderApplicationConfiguration } from "./store.js";
import type { SlackDeliveryStatus } from "../../triggers/slack/source/index.js";
import { GITHUB_TRIGGER_SOURCE_NAMES } from "../../triggers/github/classification.js";

interface Slot {
  active: Map<string, ActiveRegistration>;
  identities: Map<string, ProviderApplicationIdentity>;
  triggerResources: TriggerProviderResources | undefined;
  handler: TriggerHandler | undefined;
}

interface ActiveRegistration {
  provider: Provider;
  providerApplicationId: string;
  registration: ProviderRegistration;
  triggers: readonly TriggerProvider[];
  sourcesStarted: boolean;
  acceptingEvents: boolean;
  leases: number;
  retiring: boolean;
  retirement: Promise<void> | undefined;
}

class ProviderRuntimeUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code.replaceAll("_", " "));
    this.name = "ProviderRuntimeUnavailableError";
  }
}

function unavailable(code: string): ProviderRuntimeUnavailableError {
  return new ProviderRuntimeUnavailableError(code);
}

type SlackInstallationHandler = Parameters<
  NonNullable<ProviderRuntimeOwner["onSlackInstallation"]>
>[0];
type LinearInstallationHandler = Parameters<
  NonNullable<ProviderRuntimeOwner["onLinearInstallation"]>
>[0];

interface DynamicProviderRuntimeOptions {
  database: Database;
  auth: AuthServer;
  applicationBaseUrl: string;
  fetch?: typeof fetch;
  registrationFactory?: (input: {
    provider: Provider;
    configuration: ProviderApplicationConfiguration;
    callbackOrigin: string;
    configurationVersion: number;
    expectedConfigurationVersion: number | undefined;
    activateConfiguration: boolean;
    onVerifiedSlackInstallation: SlackInstallationHandler;
    onVerifiedLinearInstallation: LinearInstallationHandler;
  }) => ProviderRegistration;
}

/** @package */
export class DynamicProviderRuntime implements ProviderRuntimeOwner {
  private readonly slots = new Map<Provider, Slot>([
    ["github", emptySlot()],
    ["slack", emptySlot()],
    ["discord", emptySlot()],
    ["linear", emptySlot()],
  ]);
  private readonly stable = new Map<Provider, ProviderRegistration>();
  private slackInstallationHandler: SlackInstallationHandler | undefined;
  private linearInstallationHandler: LinearInstallationHandler | undefined;
  private readonly suppressedSlackInbound = new Set<string>();

  constructor(private readonly options: DynamicProviderRuntimeOptions) {
    for (const provider of ["github", "slack", "discord", "linear"] as const) {
      this.stable.set(provider, this.stableRegistration(provider));
    }
  }

  registrations(): readonly ProviderRegistration[] {
    return [
      this.stable.get("github")!,
      this.stable.get("discord")!,
      this.stable.get("slack")!,
      this.stable.get("linear")!,
    ];
  }

  identity(
    provider: Provider,
    providerApplicationId: string,
  ): ProviderApplicationIdentity | undefined {
    return [...this.slot(provider).identities.values()].find(
      (identity) => identity.id === providerApplicationId,
    );
  }

  slackDelivery(
    providerApplicationId?: string,
  ): { status(): SlackDeliveryStatus; retry(): Promise<void> } | undefined {
    return selectActive(this.slot("slack"), providerApplicationId)?.registration.slackDelivery;
  }

  onSlackInstallation(
    handler: NonNullable<DynamicProviderRuntime["slackInstallationHandler"]>,
  ): void {
    this.slackInstallationHandler = handler;
  }

  onLinearInstallation(
    handler: NonNullable<DynamicProviderRuntime["linearInstallationHandler"]>,
  ): void {
    this.linearInstallationHandler = handler;
  }

  async prepare(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
    callbackOrigin: string,
    identity: ProviderApplicationIdentity,
    configurationVersion: number,
    activation?: {
      expectedConfigurationVersion: number | undefined;
      activateConfiguration: boolean;
    },
  ): Promise<ProviderRuntimeCandidate> {
    const registration = this.build(
      provider,
      configuration,
      callbackOrigin,
      configurationVersion,
      activation,
    );
    const slot = this.slot(provider);
    const providerApplicationId = runtimeApplicationKey(provider, identity.id);
    const triggerResources = slot.triggerResources;
    const active: ActiveRegistration = {
      provider,
      providerApplicationId: identity.id,
      registration,
      triggers:
        triggerResources === undefined
          ? []
          : registration.triggerProviders
              .map((factory) => factory(triggerResources))
              .filter((trigger): trigger is TriggerProvider => trigger !== undefined),
      sourcesStarted: false,
      acceptingEvents: false,
      leases: 0,
      retiring: false,
      retirement: undefined,
    };
    let published = false;
    return {
      start: async () => {
        if (slot.handler === undefined || this.inboundSuppressed(active)) return;
        await startSources(active, slot.handler);
      },
      beginConnection: async (request) => {
        const response = await registration.connection.actions["start"]?.(request);
        if (response === undefined || !response.ok)
          throw unavailable("provider_application_unavailable");
        const body: unknown = await response.json();
        const url =
          body !== null && typeof body === "object" && "url" in body
            ? Reflect.get(body, "url")
            : undefined;
        if (typeof url !== "string") throw unavailable("provider_application_unavailable");
        return { url };
      },
      publish: () => {
        const previous = slot.active.get(providerApplicationId);
        if (previous !== undefined) previous.acceptingEvents = false;
        slot.active.set(providerApplicationId, active);
        slot.identities.set(providerApplicationId, identity);
        active.acceptingEvents = true;
        published = true;
        if (previous !== undefined) {
          previous.retiring = true;
          void stopSources(previous).catch((error: unknown) => {
            reportFailure(error, {
              operation: "provider_runtime.retire_inbound",
              component: "provider_runtime",
              provider,
            });
          });
          void this.retireWhenDrained(provider, previous);
        }
      },
      close: () => (published ? Promise.resolve() : stopSources(active)),
    };
  }

  /** Transfer Socket Mode ownership to/from the OpenClaw channel vertical.
   * One Slack app must have exactly one inbound consumer: Slack load-balances
   * envelopes across concurrent sockets instead of broadcasting them. */
  async setSlackInboundSuppressed(
    providerApplicationId: string,
    suppressed: boolean,
  ): Promise<void> {
    if (suppressed) this.suppressedSlackInbound.add(providerApplicationId);
    else this.suppressedSlackInbound.delete(providerApplicationId);
    const active = selectActive(this.slot("slack"), providerApplicationId);
    if (active === undefined) return;
    if (suppressed) {
      await stopSources(active);
      return;
    }
    const handler = this.slot("slack").handler;
    if (handler !== undefined && active.acceptingEvents) await startSources(active, handler);
  }

  private build(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
    callbackOrigin: string,
    configurationVersion: number,
    activation?: {
      expectedConfigurationVersion: number | undefined;
      activateConfiguration: boolean;
    },
  ): ProviderRegistration {
    if (this.options.registrationFactory !== undefined) {
      return this.options.registrationFactory(
        this.customRegistrationInput(
          provider,
          configuration,
          callbackOrigin,
          configurationVersion,
          activation,
        ),
      );
    }
    const shared = {
      database: this.options.database,
      auth: this.options.auth,
      applicationBaseUrl: this.options.applicationBaseUrl,
      publicBaseUrl: callbackOrigin,
      configurationVersion,
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    };
    if (provider === "github" && configuration.provider === "github") {
      return createGitHubRegistration({ ...shared, configuration });
    }
    if (provider === "slack" && configuration.provider === "slack") {
      return createSlackRegistration({
        ...shared,
        configuration,
        ...(activation?.expectedConfigurationVersion === undefined
          ? {}
          : {
              expectedConfigurationVersion: activation.expectedConfigurationVersion,
            }),
        activateConfiguration: activation?.activateConfiguration ?? false,
        onVerifiedInstallation: (input) => this.handleSlackInstallation(input),
      });
    }
    if (provider === "discord" && configuration.provider === "discord") {
      return createDiscordRegistration({
        ...shared,
        configuration: {
          clientId: configuration.applicationId,
          clientSecret: configuration.clientSecret,
          botToken: configuration.botToken,
        },
      });
    }
    if (provider === "linear" && configuration.provider === "linear") {
      return createLinearRegistration({
        ...shared,
        configuration,
        ...(activation?.expectedConfigurationVersion === undefined
          ? {}
          : {
              expectedConfigurationVersion: activation.expectedConfigurationVersion,
            }),
        activateConfiguration: activation?.activateConfiguration ?? false,
        onVerifiedInstallation: (input) => this.handleLinearInstallation(input),
      });
    }
    throw new Error("provider configuration mismatch");
  }

  private customRegistrationInput(
    provider: Provider,
    configuration: ProviderApplicationConfiguration,
    callbackOrigin: string,
    configurationVersion: number,
    activation:
      | {
          expectedConfigurationVersion: number | undefined;
          activateConfiguration: boolean;
        }
      | undefined,
  ): Parameters<NonNullable<DynamicProviderRuntimeOptions["registrationFactory"]>>[0] {
    return {
      provider,
      configuration,
      callbackOrigin,
      configurationVersion,
      expectedConfigurationVersion: activation?.expectedConfigurationVersion,
      activateConfiguration: activation?.activateConfiguration ?? false,
      onVerifiedSlackInstallation: (input) => this.handleSlackInstallation(input),
      onVerifiedLinearInstallation: (input) => this.handleLinearInstallation(input),
    };
  }

  private handleSlackInstallation(input: Parameters<SlackInstallationHandler>[0]): Promise<void> {
    if (this.slackInstallationHandler === undefined) {
      throw unavailable("slack_installation_handler_unavailable");
    }
    return this.slackInstallationHandler(input);
  }

  private handleLinearInstallation(input: Parameters<LinearInstallationHandler>[0]): Promise<void> {
    if (this.linearInstallationHandler === undefined) {
      throw unavailable("linear_installation_handler_unavailable");
    }
    return this.linearInstallationHandler(input);
  }

  private stableRegistration(provider: Provider): ProviderRegistration {
    const slot = this.slot(provider);
    const source: TriggerSource = {
      start: async (handler) => {
        slot.handler = handler;
        await Promise.all(
          [...slot.active.values()]
            .filter((active) => !this.inboundSuppressed(active))
            .map((active) => startSources(active, handler)),
        );
      },
      stop: async () => {
        slot.handler = undefined;
        for (const active of slot.active.values()) active.acceptingEvents = false;
        await Promise.all([...slot.active.values()].map(stopSources));
      },
    };
    const connectionActions = Object.fromEntries(
      actionNames(provider).map((action) => [
        action,
        async (request: Request) => {
          const active = await this.registrationForAction(provider, slot, action, request);
          if (active === undefined) {
            return Response.json({ error: "provider_not_configured" }, { status: 409 });
          }
          return this.withLease(
            active,
            () =>
              active.registration.connection.actions[action]?.(request) ??
              Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 })),
          );
        },
      ]),
    );
    return {
      connection: {
        name: provider,
        status: (connections) =>
          firstActive(slot)?.registration.connection.status(connections) ?? {
            status: "notConfigured" as const,
          },
        actions: connectionActions,
      },
      ...(provider === "github"
        ? {
            integration: {
              resolve: (
                ...args: Parameters<NonNullable<ProviderRegistration["integration"]>["resolve"]>
              ) => {
                const active = firstActive(slot);
                const integration = active?.registration.integration;
                if (active === undefined || integration === undefined) {
                  throw unavailable("github_integration_unavailable");
                }
                return this.withLease(active, () => integration.resolve(...args));
              },
              githubAuthority: {
                mint: (
                  input: Parameters<
                    NonNullable<
                      NonNullable<ProviderRegistration["integration"]>["githubAuthority"]
                    >["mint"]
                  >[0],
                ) => {
                  const active = firstActive(slot);
                  const authority = active?.registration.integration?.githubAuthority;
                  if (active === undefined || authority === undefined) {
                    throw unavailable("github_authority_unavailable");
                  }
                  return this.withLease(active, () => authority.mint(input));
                },
                revoke: (token: string) => {
                  const active = firstActive(slot);
                  const authority = active?.registration.integration?.githubAuthority;
                  if (active === undefined || authority === undefined) {
                    throw unavailable("github_authority_unavailable");
                  }
                  return this.withLease(active, () => authority.revoke(token));
                },
              },
            },
          }
        : {}),
      triggerProviders: [
        (resources) => {
          slot.triggerResources = resources;
          for (const active of slot.active.values()) {
            active.triggers = active.registration.triggerProviders
              .map((factory) => factory(resources))
              .filter((trigger): trigger is TriggerProvider => trigger !== undefined);
          }
          return this.dynamicTrigger(provider, slot);
        },
      ],
      sources: [source],
      outputs:
        provider === "github"
          ? []
          : [
              {
                type: `${provider}.reply`,
                tool: replyOutputTool,
                available: outputContextProvider(provider),
                execute: (input) => {
                  const active = selectActive(slot, applicationIdFrom(input));
                  const output = active?.registration.outputs.find(
                    (candidate) => candidate.type === `${provider}.reply`,
                  );
                  if (active === undefined || output === undefined) {
                    throw unavailable(`${provider}_output_unavailable`);
                  }
                  return this.withLease(active, () => output.execute(input));
                },
              },
            ],
      requests:
        provider === "discord"
          ? []
          : [
              {
                name: provider === "github" ? "webhook" : `${provider}.events`,
                handle: async (request) => {
                  const active = await this.activeForRequest(provider, slot, request);
                  const handler = active?.registration.requests[0];
                  return active === undefined || handler === undefined
                    ? new Response("Not Found", { status: 404 })
                    : this.withLease(active, () => handler.handle(request));
                },
              },
            ],
      ...(provider === "github"
        ? { githubConfiguration: this.dynamicGitHubConfiguration(slot) }
        : {}),
      ...(provider === "slack" || provider === "discord"
        ? {
            attachment: {
              provider,
              resolve: async (input) => {
                const providerApplicationId =
                  applicationIdFrom(input) ??
                  (provider === "slack"
                    ? (
                        await this.options.database.findSlackConnectionByIdForOrganization(
                          input.organizationId,
                          input.connectionId,
                        )
                      )?.providerApplicationId
                    : undefined);
                const active = selectActive(slot, providerApplicationId);
                const attachment = active?.registration.attachment;
                if (active === undefined || attachment === undefined) {
                  throw unavailable(`${provider}_attachment_unavailable`);
                }
                return this.withLease(active, () => attachment.resolve(input));
              },
            },
          }
        : {}),
    };
  }

  private slot(provider: Provider): Slot {
    const slot = this.slots.get(provider);
    if (slot === undefined) throw new Error(`unknown provider: ${provider}`);
    return slot;
  }

  private inboundSuppressed(active: ActiveRegistration): boolean {
    return (
      active.provider === "slack" && this.suppressedSlackInbound.has(active.providerApplicationId)
    );
  }

  private dynamicTrigger(provider: Provider, slot: Slot): TriggerProvider {
    const current = (input?: unknown) => {
      const active = selectActive(slot, applicationIdFrom(input));
      const trigger = active?.triggers[0];
      if (active === undefined || trigger === undefined) {
        throw unavailable(`${provider}_trigger_unavailable`);
      }
      return { active, trigger };
    };
    const invoke = <T>(input: unknown, operation: (trigger: TriggerProvider) => Promise<T>) => {
      const selected = current(input);
      return this.withLease(selected.active, () => operation(selected.trigger));
    };
    return {
      name: provider,
      eventNames: eventNames(provider),
      match: async (external) => {
        const selected = current(external);
        return this.withLease(selected.active, () => selected.trigger.match(external));
      },
      materializeLaunch: (input) => {
        const selected = current(input);
        return this.withLease(
          selected.active,
          () => selected.trigger.materializeLaunch?.(input) ?? Promise.resolve({}),
        );
      },
      materializeContext: (input) => {
        const selected = current(input);
        return this.withLease(
          selected.active,
          () => selected.trigger.materializeContext?.(input) ?? Promise.resolve(undefined),
        );
      },
      onDispatchAccepted: (triggerContext, outputContext, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onDispatchAccepted?.(triggerContext, outputContext, reactionState) ??
            Promise.resolve(),
        ),
      onAgentExecutionStarted: (triggerContext, outputContext, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionStarted?.(triggerContext, outputContext, reactionState) ??
            Promise.resolve(),
        ),
      onAgentExecutionCompleted: (triggerContext, outputContext, result, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionCompleted?.(
              triggerContext,
              outputContext,
              result,
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionFailed: (triggerContext, outputContext, reason, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionFailed?.(
              triggerContext,
              outputContext,
              reason,
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionTerminal: (executionId, triggerContext) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionTerminal?.(executionId, triggerContext) ?? Promise.resolve(),
        ),
      onMachineTerminated: (triggerContext, reason, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onMachineTerminated?.(triggerContext, reason, reactionState) ??
            Promise.resolve(),
        ),
    };
  }

  private dynamicGitHubConfiguration(slot: Slot): GitHubConfigurationProvider {
    const invoke = <T>(operation: (configuration: GitHubConfigurationProvider) => Promise<T>) => {
      const active = firstActive(slot);
      const configuration = active?.registration.githubConfiguration;
      if (active === undefined || configuration === undefined) {
        throw unavailable("github_configuration_unavailable");
      }
      return this.withLease(active, () => operation(configuration));
    };
    return {
      listInstallationRepositories: (input) =>
        invoke((configuration) => configuration.listInstallationRepositories(input)),
      readDefaultBranchHead: (input) =>
        invoke((configuration) => configuration.readDefaultBranchHead(input)),
      listFilesAtCommit: (input) =>
        invoke((configuration) => configuration.listFilesAtCommit(input)),
      readFileAtCommit: (input) => invoke((configuration) => configuration.readFileAtCommit(input)),
    };
  }

  private async withLease<T>(active: ActiveRegistration, operation: () => Promise<T>): Promise<T> {
    active.leases += 1;
    try {
      return await operation();
    } finally {
      active.leases -= 1;
      if (active.retiring) {
        void this.retireWhenDrained(active.provider, active);
      }
    }
  }

  private retireWhenDrained(provider: Provider, active: ActiveRegistration): Promise<void> {
    if (active.leases > 0) return Promise.resolve();
    active.retirement ??= retire(provider, active);
    return active.retirement;
  }

  private async registrationForAction(
    provider: Provider,
    slot: Slot,
    action: string,
    request: Request,
  ): Promise<ActiveRegistration | undefined> {
    if (action !== "callback" && action !== "setup") {
      if (provider !== "slack") return firstActive(slot);
      return selectActive(slot, await applicationIdFromRequest(request));
    }
    const state = new URL(request.url).searchParams.get("state");
    if (state === null) {
      return provider === "slack"
        ? selectActive(slot, await applicationIdFromRequest(request))
        : firstActive(slot);
    }
    const snapshot = await this.options.database.findConnectionAttemptConfiguration(
      createHash("sha256").update(state).digest("hex"),
    );
    if (snapshot === undefined) return firstActive(slot);
    const snapshotKey = runtimeApplicationKey(provider, snapshot.providerApplicationId);
    const existing =
      slot.active.get(snapshotKey)?.registration.configurationSnapshot?.version ===
        snapshot.configurationVersion &&
      slot.active.get(snapshotKey)?.registration.configurationSnapshot?.callbackOrigin ===
        snapshot.callbackOrigin
        ? slot.active.get(snapshotKey)
        : undefined;
    if (existing !== undefined) return existing;
    try {
      const configuration = parseProviderApplicationConfiguration(snapshot.configurationSnapshot);
      if (configuration.provider !== provider) return firstActive(slot);
      const registration = this.build(
        provider,
        configuration,
        snapshot.callbackOrigin,
        snapshot.configurationVersion,
        {
          expectedConfigurationVersion: snapshot.expectedConfigurationVersion ?? undefined,
          activateConfiguration: snapshot.activateConfiguration,
        },
      );
      const restored: ActiveRegistration = {
        provider,
        providerApplicationId: snapshot.providerApplicationId,
        registration,
        triggers: [],
        sourcesStarted: false,
        acceptingEvents: false,
        leases: 0,
        retiring: false,
        retirement: undefined,
      };
      return restored;
    } catch (error) {
      reportFailure(error, {
        operation: "provider_runtime.restore_callback_snapshot",
        component: "provider_runtime",
        provider,
      });
      return firstActive(slot);
    }
  }

  private async activeForRequest(
    provider: Provider,
    slot: Slot,
    request: Request,
  ): Promise<ActiveRegistration | undefined> {
    if (provider !== "slack" || request.method !== "POST") return firstActive(slot);
    try {
      const payload: unknown = await request.clone().json();
      return selectActive(slot, applicationIdFrom(payload));
    } catch {
      return firstActive(slot);
    }
  }
}

async function applicationIdFromRequest(request: Request): Promise<string | undefined> {
  const query = new URL(request.url).searchParams.get("providerApplicationId");
  if (query !== null && query !== "") return query;
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  try {
    const payload: unknown = await request.clone().json();
    return applicationIdFrom(payload);
  } catch {
    return undefined;
  }
}

function emptySlot(): Slot {
  return {
    active: new Map(),
    identities: new Map(),
    triggerResources: undefined,
    handler: undefined,
  };
}

function firstActive(slot: Slot): ActiveRegistration | undefined {
  return slot.active.values().next().value;
}

function selectActive(
  slot: Slot,
  providerApplicationId: string | undefined,
): ActiveRegistration | undefined {
  if (providerApplicationId !== undefined) {
    const selected = slot.active.get(providerApplicationId);
    if (selected !== undefined) return selected;
  }
  return slot.active.size === 1 ? firstActive(slot) : undefined;
}

function applicationIdFrom(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  for (const key of ["providerApplicationId", "provider_application_id", "api_app_id", "appId"]) {
    const candidate: unknown = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  for (const key of ["event", "receipt", "triggerContext", "outputContext"]) {
    const nestedValue: unknown = Reflect.get(value, key);
    const nested = applicationIdFrom(nestedValue);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function runtimeApplicationKey(provider: Provider, providerApplicationId: string): string {
  return provider === "slack" ? providerApplicationId : provider;
}

function actionNames(provider: Provider): readonly string[] {
  if (provider === "github") return ["start", "disconnect", "setup", "callback"];
  return ["start", "disconnect", "callback"];
}

function eventNames(provider: Provider): TriggerProvider["eventNames"] {
  if (provider === "slack") return ["slack.mention"];
  if (provider === "discord") return ["discord.mention"];
  if (provider === "linear") return ["linear.issue", "linear.comment"];
  return GITHUB_TRIGGER_SOURCE_NAMES;
}

async function startSources(active: ActiveRegistration, handler: TriggerHandler): Promise<void> {
  if (active.sourcesStarted) return;
  const started: TriggerSource[] = [];
  try {
    for (const source of active.registration.sources) {
      await source.start((trigger) =>
        active.acceptingEvents
          ? handler(trigger)
          : Promise.reject(new Error("provider source was retired")),
      );
      started.push(source);
    }
    active.sourcesStarted = true;
  } catch (error) {
    const cleanup = await Promise.allSettled(started.toReversed().map((source) => source.stop()));
    for (const failure of cleanup) {
      if (failure.status === "rejected") {
        reportFailure(failure.reason, {
          operation: "provider_runtime.start_sources.cleanup",
          component: "provider_runtime",
          provider: active.provider,
        });
      }
    }
    throw error;
  }
}

async function stopSources(active: ActiveRegistration): Promise<void> {
  if (!active.sourcesStarted) return;
  active.sourcesStarted = false;
  const results = await Promise.allSettled(
    active.registration.sources.toReversed().map((source) => source.stop()),
  );
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
}

async function retire(provider: Provider, active: ActiveRegistration): Promise<void> {
  try {
    await stopSources(active);
  } catch (error) {
    reportFailure(
      error,
      {
        operation: "provider_runtime.retire",
        component: "provider_runtime",
        provider,
      },
      { logger, kind: "internal" },
    );
  }
}
