// The channel control-plane source (plan S8 / implementation doc §4.3): the one
// builder that turns the active organization Channel revision into the control
// plane everything above it consumes — the control-plane ops, the supervisor,
// the execution plane. Loaded only under CLISBOT_HUB_CHANNELS_ENABLED, so
// flag-off this module never enters the process (byte-equivalence).
//
// Two concerns, one module:
//   1. resolve the org-scoped source: the single provisioned organization →
//      its active Channel revision → the authored files.
//   2. compile the snapshot: `compileHubBundle` + `compileChannelControlPlane`
//      + the agent-spec resolver the plane's binding engine drives.
//
// The agent-spec resolver is a pure function of the compiled bundle, so the
// supervisor (which also builds planes) imports it directly — one mapping, one
// place. The field mapping mirrors the daemon's own agent launch fields
// (`daemons/registry.ts` validate/launch path: provider, model, modeId,
// thinkingOptionId, providerOptions) plus the environment's `cwd`.

import { compileHubBundle, type CompiledHubBundle, type HubBundleFile } from "../config/bundle.js";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import type {
  ChannelConfigurationRevisionRecord,
  Database,
  OperatorOrganizationRecord,
} from "../db/types.js";
import type { CreateAgentConfig } from "./daemon/types.js";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelControlPlane,
  type EffectiveDefaults,
  type RouteTarget,
} from "./config/compile.js";
import { compileTriggerDocument, TriggerDocumentError } from "../triggers/configuration/index.js";
import {
  CHANNEL_REPLY_MCP_SERVER_NAME,
  CHANNEL_REPLY_TOOL_NAME,
  CHANNEL_REPLY_FILE_TOOL_NAME,
  type ChannelReplyAgentCapability,
  type ChannelReplyBindingRef,
} from "./plane/types.js";
import { composeMessageToolPrompt } from "./outbound-template.js";

const EMPTY_CHANNEL_RESOURCE = `environments:\n  channel-unconfigured:\n    kind: daemon\n    daemon: channel-unconfigured\n    cwd: /\nagents: {}\n`;

export type ChannelControlPlaneErrorCode =
  | "organization_not_found"
  | "organization_ambiguous"
  | "bundle_unavailable";

/** A source failure — no usable control plane exists for this Hub instance. */
export class ChannelControlPlaneError extends Error {
  constructor(
    readonly code: ChannelControlPlaneErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelControlPlaneError";
  }
}

/** A route target that cannot be resolved against the compiled bundle. This is
 * an impossible state once `compileChannelControlPlane` has validated the
 * route's agent + environment names — the plane treats it as one failed
 * inbound event, never a crash. */
export class ChannelAgentSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelAgentSpecError";
  }
}

/** One load of the channel control plane from the active configuration. */
export interface ChannelControlPlaneSnapshot {
  organizationId: string;
  revision: ChannelConfigurationRevisionRecord | null;
  /** The active revision's authored files — the ops handlers edit these and
   * insert a new revision from the result. */
  files: readonly HubBundleFile[];
  /** The compiled upstream bundle (environments, agents, triggers, hash). */
  bundle: CompiledHubBundle;
  /** The compiled channel control-plane snapshot. */
  controlPlane: ChannelControlPlane;
  /** The Hub's loopback listen port: the base of the tool-path mcpServers
   * URL (`http://127.0.0.1:<hubPort>/mcp/channel/<opaque-capability>`) — the agent and the
   * Hub run on one host, so the tool reaches this process's own loopback. */
  hubPort: number;
  /** Resolve a route's agent target into a daemon `create_agent` config. The
   * route's effective defaults select the outbound path (E4/E6); on a `tool`
   * path the `bindingRef` names the thread the attached MCP tool posts into. */
  resolveAgentSpec: (
    target: Extract<RouteTarget, { kind: "agent" }>,
    defaults: EffectiveDefaults,
    bindingRef: ChannelReplyBindingRef,
    capability?: ChannelReplyAgentCapability | undefined,
  ) => CreateAgentConfig;
  resolveAgentAccessTarget: (
    target: Extract<RouteTarget, { kind: "agent" }>,
  ) => import("./plane/types.js").ChannelAgentAccessTarget;
}

/** The options the agent-spec resolver is built with. */
export interface ChannelAgentSpecResolverOptions {
  /** The Hub's loopback listen port (the tool-path mcpServers URL base). */
  hubPort: number;
}

/** Load the organization-owned Channel control plane. An absent revision is a valid empty plane. */
export async function loadChannelControlPlane(
  database: Database,
  organizationId?: string,
): Promise<ChannelControlPlaneSnapshot> {
  const resolvedOrganizationId = organizationId ?? (await resolveDefaultOrganization(database)).id;
  const revision = await database.findActiveChannelConfiguration(resolvedOrganizationId);
  return compileControlPlaneSnapshot(database, resolvedOrganizationId, revision ?? null);
}

/** P0 is single-operator: exactly one provisioned organization. Zero or
 * several is a misconfiguration the operator must fix, not a guess. */
async function resolveDefaultOrganization(database: Database): Promise<OperatorOrganizationRecord> {
  const organizations = await database.listOrganizationsForOperator();
  if (organizations.length === 0) {
    throw new ChannelControlPlaneError("organization_not_found", "no organization is provisioned");
  }
  if (organizations.length > 1) {
    throw new ChannelControlPlaneError(
      "organization_ambiguous",
      `P0 supports a single organization; ${organizations.length} are provisioned`,
    );
  }
  return organizations[0]!;
}

async function compileControlPlaneSnapshot(
  database: Database,
  organizationId: string,
  revision: ChannelConfigurationRevisionRecord | null,
  options: { skipOpenAudienceTargetSafety?: boolean } = {},
): Promise<ChannelControlPlaneSnapshot> {
  const files = revision?.files ?? [];
  if (files.some((file) => file.path.startsWith(".paseo/workflows/"))) {
    throw new ChannelControlPlaneError(
      "bundle_unavailable",
      "Channel revisions cannot contain Workflow documents; use organization Triggers",
    );
  }
  const resourceFiles = [...files];
  if (!resourceFiles.some(({ path }) => path === ".paseo/hub.yml")) {
    resourceFiles.push({
      path: ".paseo/hub.yml",
      content: EMPTY_CHANNEL_RESOURCE,
    });
  }
  const bundle = compileHubBundle(resourceFiles, { requireWorkflow: false });
  const triggers = await database.listOrganizationTriggers(organizationId);
  const workflowNames = triggers.filter(({ enabled }) => enabled).map(({ name }) => name);
  // The tool-path mcpServers URL needs the Hub's loopback listen port —
  // `process.env.PORT` is set by the Hub's process entry (index.ts
  // `readPort`), so the resolver and the listening server agree on it.
  const hubPort = hubListenPort(process.env);
  const controlPlane = compileChannelControlPlane({
    files,
    agentNames: channelAgentNames(bundle),
    environmentNames: channelEnvironmentNames(bundle),
    workflowNames,
  });
  if (!options.skipOpenAudienceTargetSafety) {
    await assertOpenAudienceTargetSafety(database, organizationId, bundle, controlPlane, triggers);
  }
  return {
    organizationId,
    revision,
    files,
    bundle,
    controlPlane,
    hubPort,
    resolveAgentSpec: createChannelAgentSpecResolver(bundle, { hubPort }),
    resolveAgentAccessTarget: createChannelAgentAccessTargetResolver(bundle),
  };
}

/** Open Routes are intentionally cheaper and narrower than Member Routes.
 * This cross-document check catches controls that the Channel file cannot see. */
export async function assertOpenAudienceTargetSafety(
  database: Database,
  organizationId: string,
  bundle: CompiledHubBundle,
  controlPlane: ChannelControlPlane,
  triggerRecords?: Awaited<ReturnType<Database["listOrganizationTriggers"]>>,
): Promise<void> {
  const issues: Array<{ path: readonly (string | number)[]; message: string }> = [];
  const openTargets = controlPlane.accounts.flatMap((account) =>
    account.routes.flatMap((route, index) =>
      route.audience?.kind === "conversationParticipants"
        ? [{ accountId: account.accountId, index, target: route.target }]
        : [],
    ),
  );
  const records = triggerRecords ?? (await database.listOrganizationTriggers(organizationId));
  const triggerByName = new Map(records.map((trigger) => [trigger.name, trigger]));
  for (const { accountId, index, target } of openTargets) {
    const path = ["channel-accounts", accountId, "routes", index, "target"] as const;
    if (target.kind === "agent") {
      appendOpenAudienceAgentIssues([bundle.agents[target.agent]], path, issues);
      continue;
    }
    const trigger = triggerByName.get(target.workflow);
    if (trigger === undefined) {
      issues.push({
        path,
        message: "external participants require an active Automation",
      });
      continue;
    }
    if (trigger.format !== "single_run") {
      issues.push({
        path,
        message: "external participants require a bounded single-run Automation",
      });
      continue;
    }
    const revision = await database.findOrganizationTriggerRevision(
      trigger.id,
      trigger.activeRevisionId,
    );
    if (revision === undefined) {
      issues.push({
        path,
        message: "external participants require an active Automation revision",
      });
      continue;
    }
    const agent = compileTriggerDocument(revision.yaml).authored.run.agent;
    const choices = "choices" in agent ? Object.values(agent.choices) : [agent];
    appendOpenAudienceAgentIssues(choices, path, issues);
  }
  if (issues.length > 0) throw new ChannelCompilationError(issues);
}

/** Prevents an active open-audience Route from being widened indirectly by an Automation edit. */
export async function assertOpenAudienceAutomationUpdateSafety(input: {
  database: Database;
  organizationId: string;
  automationId: string;
  candidate: ReturnType<typeof compileTriggerDocument>["authored"];
}): Promise<void> {
  const triggerRecords = await input.database.listOrganizationTriggers(input.organizationId);
  const current = triggerRecords.find(({ id }) => id === input.automationId);
  if (current === undefined) return;
  const activeRevision = await input.database.findActiveChannelConfiguration(input.organizationId);
  const snapshot = await compileControlPlaneSnapshot(
    input.database,
    input.organizationId,
    activeRevision ?? null,
    { skipOpenAudienceTargetSafety: true },
  );
  const hasOpenAudienceBacklink = snapshot.controlPlane.accounts.some((account) =>
    account.routes.some(
      (route) =>
        route.audience?.kind === "conversationParticipants" &&
        route.target.kind === "workflow" &&
        route.target.workflow === current.name,
    ),
  );
  if (!hasOpenAudienceBacklink) return;
  if (!input.candidate.enabled || input.candidate.name !== current.name) {
    throw new TriggerDocumentError([
      {
        path: [input.candidate.name !== current.name ? "name" : "enabled"],
        message: "must remain active while an external-participant Channel Route uses it",
      },
    ]);
  }
  const agent = input.candidate.run.agent;
  const choices = "choices" in agent ? Object.values(agent.choices) : [agent];
  const issues: Array<{ path: readonly (string | number)[]; message: string }> = [];
  appendOpenAudienceAgentIssues(choices, ["run", "agent"], issues);
  if (issues.length > 0) throw new TriggerDocumentError(issues);
}

function appendOpenAudienceAgentIssues(
  agents: readonly (
    | {
        provider: string;
        mode?: string | undefined;
        featureValues?: Readonly<Record<string, unknown>> | undefined;
        options?: Readonly<Record<string, unknown>> | undefined;
      }
    | undefined
  )[],
  path: readonly (string | number)[],
  issues: Array<{ path: readonly (string | number)[]; message: string }>,
): void {
  if (agents.some((agent) => agent?.featureValues?.["fast_mode"] === true)) {
    issues.push({
      path,
      message: "Fast mode is unavailable to external participants",
    });
  }
  for (const agent of agents) {
    const modeIssue = openAudienceAgentModeIssue(agent);
    if (modeIssue !== undefined) issues.push({ path, message: modeIssue });
  }
}

function openAudienceAgentModeIssue(
  agent:
    | {
        provider: string;
        mode?: string | undefined;
        featureValues?: Readonly<Record<string, unknown>> | undefined;
        options?: Readonly<Record<string, unknown>> | undefined;
      }
    | undefined,
): string | undefined {
  if (agent === undefined) return "external participants require a known Agent configuration";
  if (agent.mode === undefined) {
    return "external participants require an explicit known-safe Agent Mode";
  }
  const provider = AGENT_PROVIDER_DEFINITIONS.find(({ id }) => id === agent.provider);
  const mode = provider?.modes.find(({ id }) => id === agent.mode);
  if (mode === undefined) {
    return `external participants cannot use unverified Mode "${agent.mode}" for Provider "${agent.provider}"`;
  }
  if (mode.isUnattended === true) {
    return `external participants cannot use unattended Mode "${agent.mode}"`;
  }
  if (agent.featureValues?.["auto_accept"] === true) {
    return "external participants cannot enable automatic tool acceptance";
  }
  if (agent.options?.["approval_policy"] === "never") {
    return "external participants cannot disable tool approvals through Provider options";
  }
  return undefined;
}

function createChannelAgentAccessTargetResolver(bundle: CompiledHubBundle) {
  const environments = new Map(
    bundle.configuration.environments.map(
      (environment) => [environment.name, environment] as const,
    ),
  );
  return (target: Extract<RouteTarget, { kind: "agent" }>) => {
    const environment = environments.get(target.environment);
    if (environment === undefined || environment.kind !== "daemon") {
      throw new ChannelAgentSpecError(
        `route target environment "${target.environment}" is not a daemon environment`,
      );
    }
    return {
      daemonReference: environment.daemonId ?? environment.daemon,
      ...(environment.projectId === undefined ? {} : { projectId: environment.projectId }),
      ...(environment.cwd.startsWith("/") ? { projectRoot: environment.cwd } : {}),
    };
  };
}

/** The Hub's loopback listen port: `PORT` at process entry, 3000 otherwise
 * (the same source index.ts `readPort` reads — the CLI `hub start` sets it
 * to 6868). Exported so tests can pin it. */
export function hubListenPort(environment: Record<string, string | undefined>): number {
  const value = environment["PORT"] ?? "3000";
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

/** The reference names `compileChannelControlPlane` validates route targets
 * against. Daemon environments only — a channel agent target is a
 * `create_agent` on a local daemon, never a fly/docker step. Exported so the
 * ops handlers' pre-compile guard validates candidate files against the same
 * reference names the snapshot was compiled with. */
export function channelEnvironmentNames(bundle: CompiledHubBundle): readonly string[] {
  return bundle.configuration.environments
    .filter(
      (environment) => environment.kind === "daemon" && environment.name !== "channel-unconfigured",
    )
    .map(({ name }) => name);
}

export function channelAgentNames(bundle: CompiledHubBundle): readonly string[] {
  return Object.keys(bundle.agents);
}

/**
 * Build the plane's agent-spec resolver: a route's `{ agent, environment }`
 * target names into the hub bundle, out a daemon `create_agent` config.
 * `title` is the binding engine's (it creates the agent with the execution
 * marker); `template` is ignored at P0.
 *
 * The route's effective defaults select the outbound path (E4/E6). The
 * org-floor `relay` path returns the byte-identical base config the plane
 * built before the toggle existed (no `mcpServers`, no `toolPolicy`, no
 * `systemPrompt`). The `tool` path adds three fields: the `mcpServers`
 * entry (the Hub's channel-reply MCP endpoint with an opaque server-issued
 * capability), the
 * `toolPolicy.preapproved` grant for the `message` tool, and the injected
 * `systemPrompt` block (the route's `outbound.template` override when set,
 * else the ported OpenClaw message-tool-only default). The `bindingRef`
 * names the thread the endpoint posts into: the caller (the binding engine)
 * knows the account + thread key the session was created from.
 */
export function createChannelAgentSpecResolver(
  bundle: CompiledHubBundle,
  options: ChannelAgentSpecResolverOptions,
): (
  target: Extract<RouteTarget, { kind: "agent" }>,
  defaults: EffectiveDefaults,
  bindingRef: ChannelReplyBindingRef,
  capability?: ChannelReplyAgentCapability | undefined,
) => CreateAgentConfig {
  const environments = new Map(
    bundle.configuration.environments.map(
      (environment) => [environment.name, environment] as const,
    ),
  );
  return (target, defaults, _bindingRef, capability) => {
    const agent = bundle.agents[target.agent];
    if (agent === undefined) {
      throw new ChannelAgentSpecError(`unknown agent "${target.agent}"`);
    }
    const environment = environments.get(target.environment);
    if (environment === undefined || environment.kind !== "daemon") {
      throw new ChannelAgentSpecError(
        `route target environment "${target.environment}" is not a daemon environment`,
      );
    }
    const config: CreateAgentConfig = {
      provider: agent.provider,
      cwd: environment.cwd,
      ...(environment.projectId === undefined ? {} : { projectId: environment.projectId }),
      ...(environment.worktree === undefined
        ? {}
        : { worktree: createAgentWorktree(environment.worktree) }),
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.mode === undefined ? {} : { modeId: agent.mode }),
      ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
      ...(agent.featureValues === undefined
        ? {}
        : { featureValues: structuredClone(agent.featureValues) }),
      ...(agent.options === undefined ? {} : { providerOptions: agent.options }),
    };
    if (defaults.outbound.path !== "tool") return config;
    if (capability === undefined) {
      throw new ChannelAgentSpecError("Channel reply capability is unavailable");
    }
    return {
      ...config,
      mcpServers: {
        [CHANNEL_REPLY_MCP_SERVER_NAME]: {
          type: "http",
          url: `http://127.0.0.1:${options.hubPort}/mcp/channel/${capability.token}`,
        },
      },
      toolPolicy: {
        preapproved: [
          {
            kind: "mcp",
            server: CHANNEL_REPLY_MCP_SERVER_NAME,
            tool: CHANNEL_REPLY_TOOL_NAME,
          },
          ...(capability.canSendFiles
            ? [
                {
                  kind: "mcp" as const,
                  server: CHANNEL_REPLY_MCP_SERVER_NAME,
                  tool: CHANNEL_REPLY_FILE_TOOL_NAME,
                },
              ]
            : []),
        ],
      },
      systemPrompt: composeMessageToolPrompt(defaults.outbound.template, {
        canSendFiles: capability.canSendFiles,
      }),
    };
  };
}

function createAgentWorktree(
  worktree:
    | {
        mode: "branch-off";
        newBranch: string;
        base?: string | undefined;
      }
    | { mode: "checkout-branch"; branch: string }
    | { mode: "checkout-pr"; prNumber: number },
): NonNullable<CreateAgentConfig["worktree"]> {
  if (worktree.mode === "branch-off") {
    return {
      mode: "branch-off",
      newBranch: worktree.newBranch,
      ...(worktree.base === undefined ? {} : { base: worktree.base }),
    };
  }
  return structuredClone(worktree);
}
