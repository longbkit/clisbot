import type { AuthServer } from "../../auth/server.js";
import { createHash } from "node:crypto";
import type { GitHubConfigurationProvider } from "../../configuration/github-sync.js";
import type { Database } from "../../db/types.js";
import { outputContextProvider, replyOutputTool } from "../../execution-capabilities/outputs.js";
import { logger } from "../../logger.js";
import { reportFailure } from "../../failures/index.js";
import { createDiscordRegistration } from "../../providers/discord/index.js";
import { createGitHubRegistration } from "../../providers/github/index.js";
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
import { GITHUB_TRIGGER_EVENT_NAMES } from "../../triggers/github/classification.js";

interface Slot {
  active: ActiveRegistration | undefined;
  retained: Map<string, ActiveRegistration>;
  identity: ProviderApplicationIdentity | undefined;
  triggerResources: TriggerProviderResources | undefined;
  handler: TriggerHandler | undefined;
}

interface ActiveRegistration {
  provider: Provider;
  snapshotId: string;
  registration: ProviderRegistration;
  triggers: readonly TriggerProvider[];
  sourcesStarted: boolean;
  acceptingEvents: boolean;
  leases: number;
  longLeases: Set<string>;
  retiring: boolean;
  retirement: Promise<void> | undefined;
}

interface RuntimeSnapshotMarker {
  snapshotId: string;
  leaseId: string;
}

const RUNTIME_SNAPSHOT_KEY = "__paseoProviderRuntimeSnapshot";

type SlackInstallationHandler = Parameters<
  NonNullable<ProviderRuntimeOwner["onSlackInstallation"]>
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
  }) => ProviderRegistration;
}

/** @package */
export class DynamicProviderRuntime implements ProviderRuntimeOwner {
  private readonly slots = new Map<Provider, Slot>([
    ["github", emptySlot()],
    ["slack", emptySlot()],
    ["discord", emptySlot()],
  ]);
  private readonly stable = new Map<Provider, ProviderRegistration>();
  private slackInstallationHandler: SlackInstallationHandler | undefined;
  private nextSnapshot = 0;
  private nextLease = 0;
  private readonly executionSnapshots = new Map<string, RuntimeSnapshotMarker>();
  private readonly githubAuthoritySnapshots = new Map<string, RuntimeSnapshotMarker>();

  constructor(private readonly options: DynamicProviderRuntimeOptions) {
    for (const provider of ["github", "slack", "discord"] as const) {
      this.stable.set(provider, this.stableRegistration(provider));
    }
  }

  registrations(): readonly ProviderRegistration[] {
    return [this.stable.get("github")!, this.stable.get("discord")!, this.stable.get("slack")!];
  }

  identity(provider: Provider): ProviderApplicationIdentity | undefined {
    return this.slot(provider).identity;
  }

  slackDelivery(): { status(): SlackDeliveryStatus; retry(): Promise<void> } | undefined {
    return this.slot("slack").active?.registration.slackDelivery;
  }

  onSlackInstallation(
    handler: NonNullable<DynamicProviderRuntime["slackInstallationHandler"]>,
  ): void {
    this.slackInstallationHandler = handler;
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
    const triggerResources = slot.triggerResources;
    const active: ActiveRegistration = {
      provider,
      snapshotId: `${provider}:${configurationVersion}:${++this.nextSnapshot}`,
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
      longLeases: new Set(),
      retiring: false,
      retirement: undefined,
    };
    let published = false;
    return {
      start: async () => {
        if (slot.handler === undefined) return;
        await startSources(active, slot.handler);
      },
      beginConnection: async (request) => {
        const response = await registration.connection.actions["start"]?.(request);
        if (response === undefined || !response.ok) throw new Error("provider unavailable");
        const body: unknown = await response.json();
        const url =
          body !== null && typeof body === "object" && "url" in body
            ? Reflect.get(body, "url")
            : undefined;
        if (typeof url !== "string") throw new Error("provider unavailable");
        return { url };
      },
      publish: () => {
        const previous = slot.active;
        if (previous !== undefined) previous.acceptingEvents = false;
        slot.active = active;
        slot.retained.set(active.snapshotId, active);
        slot.identity = identity;
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
          void this.retireWhenDrained(provider, slot, previous);
        }
      },
      close: () => (published ? Promise.resolve() : stopSources(active)),
    };
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
      return this.options.registrationFactory({
        provider,
        configuration,
        callbackOrigin,
        configurationVersion,
        expectedConfigurationVersion: activation?.expectedConfigurationVersion,
        activateConfiguration: activation?.activateConfiguration ?? false,
        onVerifiedSlackInstallation: (input) => {
          if (this.slackInstallationHandler === undefined) {
            throw new Error("Slack installation handler unavailable");
          }
          return this.slackInstallationHandler(input);
        },
      });
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
          : { expectedConfigurationVersion: activation.expectedConfigurationVersion }),
        activateConfiguration: activation?.activateConfiguration ?? false,
        onVerifiedInstallation: (input) => {
          if (this.slackInstallationHandler === undefined) {
            throw new Error("Slack installation handler unavailable");
          }
          return this.slackInstallationHandler(input);
        },
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
    throw new Error("provider configuration mismatch");
  }

  private stableRegistration(provider: Provider): ProviderRegistration {
    const slot = this.slot(provider);
    const source: TriggerSource = {
      start: async (handler) => {
        slot.handler = handler;
        if (slot.active !== undefined) await startSources(slot.active, handler);
      },
      stop: async () => {
        slot.handler = undefined;
        if (slot.active !== undefined) {
          slot.active.acceptingEvents = false;
          await stopSources(slot.active);
        }
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
          slot.active?.registration.connection.status(connections) ?? {
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
                const context = args[3];
                return this.registrationForExecution(provider, slot, context?.executionId).then(
                  (active) => {
                    const integration = active?.registration.integration;
                    if (active === undefined || integration === undefined) {
                      throw new Error("github integration unavailable");
                    }
                    return this.withLease(active, () => integration.resolve(...args));
                  },
                );
              },
              githubAuthority: {
                mint: (
                  input: Parameters<
                    NonNullable<
                      NonNullable<ProviderRegistration["integration"]>["githubAuthority"]
                    >["mint"]
                  >[0],
                ) => {
                  return this.registrationForExecution(provider, slot, input.executionId).then(
                    async (active) => {
                      const authority = active?.registration.integration?.githubAuthority;
                      if (active === undefined || authority === undefined) {
                        throw new Error("github authority unavailable");
                      }
                      const minted = await this.withLease(active, () => authority.mint(input));
                      this.githubAuthoritySnapshots.set(
                        minted.token,
                        this.acquireLongLease(active),
                      );
                      return minted;
                    },
                  );
                },
                revoke: (token: string) => {
                  const marker = this.githubAuthoritySnapshots.get(token);
                  const active =
                    marker === undefined ? slot.active : slot.retained.get(marker.snapshotId);
                  const authority = active?.registration.integration?.githubAuthority;
                  if (active === undefined || authority === undefined) {
                    throw new Error("github authority unavailable");
                  }
                  return this.withLease(active, () => authority.revoke(token)).then(() => {
                    this.githubAuthoritySnapshots.delete(token);
                    if (marker !== undefined) this.releaseLongLease(provider, slot, marker);
                    return undefined;
                  });
                },
              },
            },
          }
        : {}),
      triggerProviders: [
        (resources) => {
          slot.triggerResources = resources;
          if (slot.active !== undefined) {
            slot.active.triggers = slot.active.registration.triggerProviders
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
                  const active = this.registrationForContext(slot, input.outputContext);
                  const output = active?.registration.outputs.find(
                    (candidate) => candidate.type === `${provider}.reply`,
                  );
                  if (active === undefined || output === undefined) {
                    throw new Error(`${provider} output unavailable`);
                  }
                  return this.withLease(active, () =>
                    output.execute({ ...input, outputContext: unmarkContext(input.outputContext) }),
                  );
                },
              },
            ],
      requests:
        provider === "discord"
          ? []
          : [
              {
                name: provider === "github" ? "webhook" : "slack.events",
                handle: (request) => {
                  const active = slot.active;
                  const handler = active?.registration.requests[0];
                  return active === undefined || handler === undefined
                    ? Promise.resolve(new Response("Not Found", { status: 404 }))
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
              resolve: (input) => {
                return this.registrationForExecution(provider, slot, input.executionId).then(
                  (active) => {
                    const attachment = active?.registration.attachment;
                    if (active === undefined || attachment === undefined) {
                      throw new Error(`${provider} attachment unavailable`);
                    }
                    return this.withLease(active, () => attachment.resolve(input));
                  },
                );
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

  private dynamicTrigger(provider: Provider, slot: Slot): TriggerProvider {
    const current = () => {
      const active = slot.active;
      const trigger = active?.triggers[0];
      if (active === undefined || trigger === undefined) {
        throw new Error(`${provider} trigger provider unavailable`);
      }
      return { active, trigger };
    };
    const select = (value: unknown) => {
      const active = this.registrationForContext(slot, value);
      const trigger = active?.triggers[0];
      if (active === undefined || trigger === undefined) return current();
      return { active, trigger };
    };
    const invoke = <T>(value: unknown, operation: (trigger: TriggerProvider) => Promise<T>) => {
      const selected = select(value);
      return this.withLease(selected.active, () => operation(selected.trigger));
    };
    return {
      name: provider,
      eventNames: eventNames(provider),
      match: async (external) => {
        const selected = current();
        return this.withLease(selected.active, async () => {
          const result = await selected.trigger.match(external);
          if (typeof result === "string") return result;
          for (const match of result) {
            if (match.invocation.status === "rejected") continue;
            const marker = this.acquireLongLease(selected.active);
            match.triggerContext = markContext(match.triggerContext, marker);
            match.outputContext = markContext(match.outputContext, marker);
          }
          return result;
        });
      },
      materializeLaunch: (input) => {
        const marker = snapshotMarker(input.triggerContext);
        if (marker !== undefined) this.executionSnapshots.set(input.executionId, marker);
        return invoke(
          input.triggerContext,
          (trigger) =>
            trigger.materializeLaunch?.({
              ...input,
              triggerContext: unmarkContext(input.triggerContext),
            }) ?? Promise.resolve({}),
        );
      },
      materializeContext: (input) =>
        invoke(
          input.triggerContext,
          (trigger) =>
            trigger.materializeContext?.({
              ...input,
              triggerContext: unmarkContext(input.triggerContext),
            }) ?? Promise.resolve(undefined),
        ),
      onDispatchAccepted: (triggerContext, outputContext, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onDispatchAccepted?.(
              unmarkContext(triggerContext),
              unmarkContext(outputContext),
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionStarted: (triggerContext, outputContext, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionStarted?.(
              unmarkContext(triggerContext),
              unmarkContext(outputContext),
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionCompleted: (triggerContext, outputContext, result, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionCompleted?.(
              unmarkContext(triggerContext),
              unmarkContext(outputContext),
              result,
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionFailed: (triggerContext, outputContext, reason, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onAgentExecutionFailed?.(
              unmarkContext(triggerContext),
              unmarkContext(outputContext),
              reason,
              reactionState,
            ) ?? Promise.resolve(),
        ),
      onAgentExecutionTerminal: async (executionId, triggerContext) => {
        const marker = snapshotMarker(triggerContext) ?? this.executionSnapshots.get(executionId);
        try {
          await invoke(
            triggerContext,
            (trigger) =>
              trigger.onAgentExecutionTerminal?.(executionId, unmarkContext(triggerContext)) ??
              Promise.resolve(),
          );
        } finally {
          this.executionSnapshots.delete(executionId);
          if (marker !== undefined) this.releaseLongLease(provider, slot, marker);
        }
      },
      onMachineTerminated: (triggerContext, reason, reactionState) =>
        invoke(
          triggerContext,
          (trigger) =>
            trigger.onMachineTerminated?.(unmarkContext(triggerContext), reason, reactionState) ??
            Promise.resolve(),
        ),
    };
  }

  private dynamicGitHubConfiguration(slot: Slot): GitHubConfigurationProvider {
    const invoke = <T>(operation: (configuration: GitHubConfigurationProvider) => Promise<T>) => {
      const active = slot.active;
      const configuration = active?.registration.githubConfiguration;
      if (active === undefined || configuration === undefined) {
        throw new Error("github configuration unavailable");
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

  private registrationForContext(slot: Slot, value: unknown): ActiveRegistration | undefined {
    const marker = snapshotMarker(value);
    return marker === undefined ? slot.active : slot.retained.get(marker.snapshotId);
  }

  private async registrationForExecution(
    _provider: Provider,
    slot: Slot,
    executionId: string | undefined,
  ): Promise<ActiveRegistration | undefined> {
    if (executionId === undefined) return slot.active;
    let marker = this.executionSnapshots.get(executionId);
    if (marker === undefined) {
      const execution = await this.options.database.findAgentExecutionById(executionId);
      marker = snapshotMarker(execution?.triggerContext);
      if (marker !== undefined) this.executionSnapshots.set(executionId, marker);
    }
    return marker === undefined ? slot.active : slot.retained.get(marker.snapshotId);
  }

  private async withLease<T>(active: ActiveRegistration, operation: () => Promise<T>): Promise<T> {
    active.leases += 1;
    try {
      return await operation();
    } finally {
      active.leases -= 1;
      if (active.retiring) {
        const slot = this.slots.get(active.provider);
        if (slot !== undefined) void this.retireWhenDrained(active.provider, slot, active);
      }
    }
  }

  private acquireLongLease(active: ActiveRegistration): RuntimeSnapshotMarker {
    const leaseId = `lease:${++this.nextLease}`;
    active.longLeases.add(leaseId);
    active.leases += 1;
    return { snapshotId: active.snapshotId, leaseId };
  }

  private releaseLongLease(provider: Provider, slot: Slot, marker: RuntimeSnapshotMarker): void {
    const active = slot.retained.get(marker.snapshotId);
    if (active === undefined || !active.longLeases.delete(marker.leaseId)) return;
    active.leases -= 1;
    if (active.retiring) void this.retireWhenDrained(provider, slot, active);
  }

  private retireWhenDrained(
    provider: Provider,
    slot: Slot,
    active: ActiveRegistration,
  ): Promise<void> {
    if (active.leases > 0) return Promise.resolve();
    active.retirement ??= retire(provider, active).finally(() => {
      slot.retained.delete(active.snapshotId);
    });
    return active.retirement;
  }

  private async registrationForAction(
    provider: Provider,
    slot: Slot,
    action: string,
    request: Request,
  ): Promise<ActiveRegistration | undefined> {
    if (action !== "callback" && action !== "setup") return slot.active;
    const state = new URL(request.url).searchParams.get("state");
    if (state === null) return slot.active;
    const snapshot = await this.options.database.findConnectionAttemptConfiguration(
      createHash("sha256").update(state).digest("hex"),
    );
    if (snapshot === undefined) return slot.active;
    const existing =
      slot.active?.registration.configurationSnapshot?.version === snapshot.configurationVersion &&
      slot.active.registration.configurationSnapshot.callbackOrigin === snapshot.callbackOrigin
        ? slot.active
        : undefined;
    if (existing !== undefined) return existing;
    try {
      const configuration = parseProviderApplicationConfiguration(snapshot.configurationSnapshot);
      if (configuration.provider !== provider) return slot.active;
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
        snapshotId: `${provider}:${snapshot.configurationVersion}:callback`,
        registration,
        triggers: [],
        sourcesStarted: false,
        acceptingEvents: false,
        leases: 0,
        longLeases: new Set(),
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
      return slot.active;
    }
  }
}

function emptySlot(): Slot {
  return {
    active: undefined,
    retained: new Map(),
    identity: undefined,
    triggerResources: undefined,
    handler: undefined,
  };
}

function actionNames(provider: Provider): readonly string[] {
  if (provider === "github") return ["start", "disconnect", "setup", "callback"];
  return ["start", "disconnect", "callback"];
}

function eventNames(provider: Provider): TriggerProvider["eventNames"] {
  if (provider === "slack") return ["slack.mention"];
  if (provider === "discord") return ["discord.mention"];
  return GITHUB_TRIGGER_EVENT_NAMES;
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
      { operation: "provider_runtime.retire", component: "provider_runtime", provider },
      { logger, kind: "internal" },
    );
  }
}

function markContext(value: unknown, marker: RuntimeSnapshotMarker): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("provider runtime contexts must be objects");
  }
  return { ...value, [RUNTIME_SNAPSHOT_KEY]: marker };
}

function snapshotMarker(value: unknown): RuntimeSnapshotMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const marker = ownValue(value, RUNTIME_SNAPSHOT_KEY);
  if (typeof marker !== "object" || marker === null) return undefined;
  const snapshotId = ownValue(marker, "snapshotId");
  const leaseId = ownValue(marker, "leaseId");
  return typeof snapshotId === "string" && typeof leaseId === "string"
    ? { snapshotId, leaseId }
    : undefined;
}

function unmarkContext(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const context = { ...value };
  Reflect.deleteProperty(context, RUNTIME_SNAPSHOT_KEY);
  return context;
}

function ownValue(value: object, key: PropertyKey): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}
