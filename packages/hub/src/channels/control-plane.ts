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
  type RouteTarget,
} from "./config/compile.js";

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
  /** Resolve a route's agent target into a daemon `create_agent` config. */
  resolveAgentSpec: (target: Extract<RouteTarget, { kind: "agent" }>) => CreateAgentConfig;
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
    resolveAgentSpec: createChannelAgentSpecResolver(bundle),
  };
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
 */
export function createChannelAgentSpecResolver(
  bundle: CompiledHubBundle,
): (target: Extract<RouteTarget, { kind: "agent" }>) => CreateAgentConfig {
  const environments = new Map(
    bundle.configuration.environments.map(
      (environment) => [environment.name, environment] as const,
    ),
  );
  return (target) => {
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
    return {
      provider: agent.provider,
      cwd: environment.cwd,
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.mode === undefined ? {} : { modeId: agent.mode }),
      ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
      ...(agent.options === undefined ? {} : { providerOptions: agent.options }),
    };
  };
}
