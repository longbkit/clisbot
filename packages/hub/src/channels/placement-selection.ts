import type { ChannelConversationSelectionRecord } from "../db/channel-access.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { CreateAgentConfig, ProjectSnapshot } from "./daemon/types.js";
import type { ChannelAgentAccessTarget } from "./plane/types.js";
import { routeFingerprint, routePosition } from "./bindings/stored-route.js";

/** A choice the sender must change; retrying the same prompt cannot repair it. */
export class ChannelPlacementRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelPlacementRefusedError";
  }
}

/** Hub-owned choice for the next session, independent of the running binding. */
export interface ChannelPlacementSelection {
  projectId: string;
  projectRoot: string;
  workspaceId?: string;
  routePosition: number;
  routeFingerprint: string;
  daemonReference: string;
}

export function placementTarget(placement: ChannelPlacementSelection): ChannelAgentAccessTarget {
  return {
    daemonReference: placement.daemonReference,
    projectId: placement.projectId,
    projectRoot: placement.projectRoot,
  };
}

/** Model defaults do not change placement; their authority is checked again before use. */
export function placementRouteFingerprint(route: CompiledRoute): string {
  const { agentControls: _controls, ...defaults } = route.defaults;
  return routeFingerprint({ ...route, defaults });
}

export function assertWorktreeProject(
  config: CreateAgentConfig,
  project: ProjectSnapshot,
  workspaceId?: string,
): void {
  if (!workspaceId && config.worktree && project.projectKind !== "git")
    throw new ChannelPlacementRefusedError(
      "This Project has no Git repository. Select an existing Workspace.",
    );
}

export async function resolvePlacementConfiguration(input: {
  config: CreateAgentConfig;
  selection: ChannelConversationSelectionRecord | undefined;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  target: ChannelAgentAccessTarget;
  daemon: DaemonConnection;
}): Promise<CreateAgentConfig> {
  const chosen = input.selection?.selectedPlacement;
  if (!chosen || input.route.defaults.workspace?.commands === false) return input.config;
  if (
    chosen.routePosition !== routePosition(input.account, input.route) ||
    chosen.routeFingerprint !== placementRouteFingerprint(input.route) ||
    chosen.daemonReference !== input.target.daemonReference
  ) {
    throw new ChannelPlacementRefusedError(
      "The Project/Workspace selection expired after a Route or Host change. Select it again or use /project clear.",
    );
  }
  if (!input.daemon.listProjects)
    throw new ChannelPlacementRefusedError("Project discovery is unavailable on this Host.");
  const project = (await input.daemon.listProjects()).find((p) => p.projectId === chosen.projectId);
  if (!project || project.projectRootPath !== chosen.projectRoot)
    throw new ChannelPlacementRefusedError(
      "The selected Project is unavailable. Select another Project or use /project clear.",
    );
  assertWorktreeProject(input.config, project, chosen.workspaceId);
  let cwd = chosen.projectRoot;
  if (chosen.workspaceId) {
    const workspace = (await input.daemon.listWorkspaces?.(chosen.projectId))?.find(
      (w) => w.id === chosen.workspaceId,
    );
    if (!workspace || workspace.projectId !== chosen.projectId)
      throw new ChannelPlacementRefusedError(
        "The selected Workspace is unavailable. Select another Workspace or use /workspace clear.",
      );
    cwd = workspace.workspaceDirectory;
  }
  const { workspaceId: _workspace, worktree, ...base } = input.config;
  return {
    ...base,
    cwd,
    projectId: chosen.projectId,
    ...(chosen.workspaceId ? { workspaceId: chosen.workspaceId } : {}),
    ...(!chosen.workspaceId && worktree ? { worktree } : {}),
  };
}

/** Persisted on the binding so current-session authority survives selection changes/restarts. */
export function storedPlacementTarget(stored: unknown): ChannelAgentAccessTarget | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const target = (stored as { placement?: unknown }).placement;
  if (typeof target !== "object" || target === null) return undefined;
  const value = target as Partial<ChannelAgentAccessTarget>;
  if (typeof value.daemonReference !== "string" || typeof value.projectId !== "string")
    return undefined;
  return {
    daemonReference: value.daemonReference,
    projectId: value.projectId,
    ...(typeof value.projectRoot === "string" ? { projectRoot: value.projectRoot } : {}),
  };
}
