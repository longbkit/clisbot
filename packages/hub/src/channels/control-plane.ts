// The channel control-plane source (plan S8 / implementation doc §4.3): the one
// builder that turns the active project configuration into the channel control
// plane everything above it consumes — the control-plane ops, the supervisor,
// the execution plane. Loaded only under CLISBOT_HUB_CHANNELS_ENABLED, so
// flag-off this module never enters the process (byte-equivalence).
//
// Two concerns, one module:
//   1. resolve the org-scoped source: the single provisioned organization →
//      its `default` project → the active revision → the authored bundle files
//      (the ops handlers edit these files and insert a new revision).
//   2. compile the snapshot: `compileHubBundle` + `compileChannelControlPlane`
//      + the agent-spec resolver the plane's binding engine drives.
//
// The agent-spec resolver is a pure function of the compiled bundle, so the
// supervisor (which also builds planes) imports it directly — one mapping, one
// place. The field mapping mirrors the daemon's own agent launch fields
// (`daemons/registry.ts` validate/launch path: provider, model, modeId,
// thinkingOptionId, providerOptions) plus the environment's `cwd`.

import { compileHubBundle, type CompiledHubBundle, type HubBundleFile } from "../config/bundle.js";
import { revisionBundleFiles } from "../configuration/store.js";
import type {
  Database,
  OperatorOrganizationRecord,
  ProjectConfigurationRevisionRecord,
} from "../db/types.js";
import type { CreateAgentConfig } from "./daemon/types.js";
import {
  compileChannelControlPlane,
  type ChannelControlPlane,
  type EffectiveDefaults,
  type RouteTarget,
} from "./config/compile.js";
import {
  CHANNEL_REPLY_MCP_SERVER_NAME,
  CHANNEL_REPLY_TOOL_NAME,
  CHANNEL_REPLY_FILE_TOOL_NAME,
  encodeChannelReplyBindingRef,
  type ChannelReplyBindingRef,
} from "./plane/types.js";
import { composeMessageToolPrompt } from "./outbound-template.js";

/** The provisioned default project of every organization (auth/provisioning). */
const DEFAULT_PROJECT_SLUG = "default";

export type ChannelControlPlaneErrorCode =
  | "organization_not_found"
  | "organization_ambiguous"
  | "project_not_found"
  | "no_active_configuration"
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
  projectId: string;
  revision: ProjectConfigurationRevisionRecord;
  /** The active revision's authored files — the ops handlers edit these and
   * insert a new revision from the result. */
  files: readonly HubBundleFile[];
  /** The compiled upstream bundle (environments, agents, triggers, hash). */
  bundle: CompiledHubBundle;
  /** The compiled channel control-plane snapshot. */
  controlPlane: ChannelControlPlane;
  /** The Hub's loopback listen port: the base of the tool-path mcpServers
   * URL (`http://127.0.0.1:<hubPort>/mcp/channel/<ref>`) — the agent and the
   * Hub run on one host, so the tool reaches this process's own loopback. */
  hubPort: number;
  /** Resolve a route's agent target into a daemon `create_agent` config. The
   * route's effective defaults select the outbound path (E4/E6); on a `tool`
   * path the `bindingRef` names the thread the attached MCP tool posts into. */
  resolveAgentSpec: (
    target: Extract<RouteTarget, { kind: "agent" }>,
    defaults: EffectiveDefaults,
    bindingRef: ChannelReplyBindingRef,
  ) => CreateAgentConfig;
}

/** The options the agent-spec resolver is built with. */
export interface ChannelAgentSpecResolverOptions {
  /** The Hub's loopback listen port (the tool-path mcpServers URL base). */
  hubPort: number;
}

/**
 * Load the channel control plane for this Hub instance: the single provisioned
 * organization, its `default` project's active configuration. No caching —
 * every caller loads fresh, so an activated revision is visible immediately.
 */
export async function loadChannelControlPlane(
  database: Database,
): Promise<ChannelControlPlaneSnapshot> {
  const organization = await resolveDefaultOrganization(database);
  const project = await database.findProjectBySlugForOrganization(
    organization.id,
    DEFAULT_PROJECT_SLUG,
  );
  if (project === undefined) {
    throw new ChannelControlPlaneError(
      "project_not_found",
      `organization has no "${DEFAULT_PROJECT_SLUG}" project`,
    );
  }
  const revision = await database.findActiveProjectConfiguration(project.id);
  if (revision === undefined) {
    throw new ChannelControlPlaneError(
      "no_active_configuration",
      "the default project has no active configuration",
    );
  }
  return compileControlPlaneSnapshot(organization.id, project, revision);
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

function compileControlPlaneSnapshot(
  organizationId: string,
  project: { id: string },
  revision: ProjectConfigurationRevisionRecord,
): ChannelControlPlaneSnapshot {
  const files = revisionBundleFiles(revision);
  if (files.length === 0) {
    throw new ChannelControlPlaneError(
      "bundle_unavailable",
      "the active configuration revision carries no authored bundle",
    );
  }
  const bundle = compileHubBundle(files);
  // The tool-path mcpServers URL needs the Hub's loopback listen port —
  // `process.env.PORT` is set by the Hub's process entry (index.ts
  // `readPort`), so the resolver and the listening server agree on it.
  const hubPort = hubListenPort(process.env);
  return {
    organizationId,
    projectId: project.id,
    revision,
    files,
    bundle,
    controlPlane: compileChannelControlPlane({
      files,
      agentNames: channelAgentNames(bundle),
      environmentNames: channelEnvironmentNames(bundle),
      workflowNames: channelWorkflowNames(bundle),
    }),
    hubPort,
    resolveAgentSpec: createChannelAgentSpecResolver(bundle, { hubPort }),
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
    .filter((environment) => environment.kind === "daemon")
    .map(({ name }) => name);
}

export function channelAgentNames(bundle: CompiledHubBundle): readonly string[] {
  return Object.keys(bundle.agents);
}

export function channelWorkflowNames(bundle: CompiledHubBundle): readonly string[] {
  return bundle.configuration.triggers.map(({ name }) => name);
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
 * entry (the Hub's loopback channel-reply MCP endpoint, the opaque binding
 * ref naming the account + thread the agent was created from), the
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
) => CreateAgentConfig {
  const environments = new Map(
    bundle.configuration.environments.map(
      (environment) => [environment.name, environment] as const,
    ),
  );
  return (target, defaults, bindingRef) => {
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
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.mode === undefined ? {} : { modeId: agent.mode }),
      ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
      ...(agent.options === undefined ? {} : { providerOptions: agent.options }),
    };
    if (defaults.outbound.path !== "tool") return config;
    const token = encodeChannelReplyBindingRef(bindingRef);
    return {
      ...config,
      mcpServers: {
        [CHANNEL_REPLY_MCP_SERVER_NAME]: {
          type: "http",
          url: `http://127.0.0.1:${options.hubPort}/mcp/channel/${token}`,
        },
      },
      toolPolicy: {
        preapproved: [
          { kind: "mcp", server: CHANNEL_REPLY_MCP_SERVER_NAME, tool: CHANNEL_REPLY_TOOL_NAME },
          {
            kind: "mcp",
            server: CHANNEL_REPLY_MCP_SERVER_NAME,
            tool: CHANNEL_REPLY_FILE_TOOL_NAME,
          },
        ],
      },
      systemPrompt: composeMessageToolPrompt(defaults.outbound.template),
    };
  };
}
