// Which workspace a channel session lands in, and what names it
// (docs/features/workspace-organization/README.md).
//
// Before this module the Hub sent no workspace at all: every channel session —
// a first mention, `/new`, `/quick`, `/side`, `/fork` — made the daemon mint a
// fresh directory workspace for the route's cwd, named after the directory,
// with the first request nowhere in sight. Two consequences: sessions that
// belong to one piece of work scattered across workspaces, and the workspace
// list read as N copies of the same repo name.
//
// Both fixes reuse daemon behaviour that already exists, so the daemon is
// untouched (zero diff):
//
//  - `/side` and `/fork` continue the source session's work, so they inherit
//    its `workspaceId` and `create_agent_request` carries it (A1/A2).
//  - A session that needs a NEW workspace creates it first through
//    `workspace.create.request` with the first request as `firstAgentContext`,
//    which is the same call the app's New Workspace flow makes; the daemon's
//    `WorkspaceAutoName` then names it and never overwrites a user-set title
//    (A3/A4). A session joining an existing workspace sends no naming context,
//    so nothing renames it (A5).
//
// `workspace.organize: false` on any defaults layer returns every call site to
// the pre-feature behaviour: no workspace id on the wire, daemon places and
// names the session (A6). The knob is absent until an operator authors it, so
// an untouched revision compiles to the block — and the `routeFingerprint` —
// it always had; absence reads as ON here.
//
// Failure posture: organization is placement, never admission. A daemon that
// cannot report the source session or create the workspace logs and yields
// `undefined` — the session is still created, in the workspace the daemon
// picks, exactly as before this module.
//
// Two consequences worth knowing:
//
//  - A workspace is minted before `create_agent_request`, so a session create
//    that fails afterwards leaves an empty workspace behind. The daemon's own
//    create path does the same (it creates the directory workspace first and
//    only cleans up a worktree it cut), so this moves the window rather than
//    opening a new one.
//  - Inheriting carries the SOURCE session's workspace, not the route
//    environment's directory. When the bound session sits in a workspace
//    outside the route's Project — possible only if the route's environment
//    changed after the session was bound — the daemon refuses the create with
//    "Workspace … does not belong to Project …" and the command says so in the
//    thread. That is the loud failure, not a silent placement elsewhere.

import type { DaemonConnection } from "./daemon/client.js";
import type { FirstAgentContext } from "./daemon/types.js";
import type { InboundMessage, PlaneLogger } from "./plane/types.js";

export interface SessionWorkspaceInput {
  /** The route's folded `workspace.organize`. `undefined` — the unauthored
   * floor — is ON; only an explicit `false` returns placement to the daemon. */
  organize: boolean | undefined;
  /** The session this one continues — `/side` and `/fork` inherit its workspace. */
  sourceAgentId?: string | undefined;
  /** The route environment's directory, backing a newly created workspace. */
  cwd: string;
  projectId?: string | undefined;
  /** The first request that will run in a new workspace; the daemon names it from this. */
  firstAgentContext?: FirstAgentContext | undefined;
  /** The inbound this creation is attributed to (the session-operation ticket). */
  source?: InboundMessage | undefined;
  logger?: PlaneLogger | undefined;
}

/**
 * Resolve the `workspaceId` for a session the channel plane is about to
 * create. `undefined` means "send none": the daemon places the session, which
 * is both the flag-off behaviour and the fallback when organization cannot be
 * resolved.
 */
export async function resolveSessionWorkspaceId(
  daemon: DaemonConnection,
  input: SessionWorkspaceInput,
): Promise<string | undefined> {
  if (input.organize === false) return undefined;
  if (input.sourceAgentId !== undefined) {
    return await inheritSourceWorkspaceId(daemon, input.sourceAgentId, input.logger);
  }
  return await createWorkspaceForFirstRequest(daemon, input);
}

/** The workspace the source session lives in, so the continuation joins it. */
async function inheritSourceWorkspaceId(
  daemon: DaemonConnection,
  sourceAgentId: string,
  logger?: PlaneLogger,
): Promise<string | undefined> {
  try {
    const source = (await daemon.listAgents()).find((agent) => agent.id === sourceAgentId);
    if (source?.workspaceId === undefined) {
      logger?.warn("channel workspace organization: source session reports no workspace", {
        agentId: sourceAgentId,
      });
      return undefined;
    }
    return source.workspaceId;
  } catch (error) {
    logger?.warn("channel workspace organization: source session lookup failed", {
      err: error,
      agentId: sourceAgentId,
    });
    return undefined;
  }
}

/**
 * Mint the new session's workspace so the daemon can name it from the first
 * request. Skipped without a naming seed or on a daemon too old for
 * `workspace.create.request` (`workspaceMultiplicity`) — in both cases the
 * daemon's own workspace creation produces the identical result.
 */
async function createWorkspaceForFirstRequest(
  daemon: DaemonConnection,
  input: SessionWorkspaceInput,
): Promise<string | undefined> {
  const firstAgentContext = input.firstAgentContext;
  if (firstAgentContext?.prompt === undefined || firstAgentContext.prompt.trim() === "") {
    return undefined;
  }
  if (daemon.getServerInfo()?.features?.["workspaceMultiplicity"] !== true) return undefined;
  try {
    const created = await daemon.createWorkspace(
      {
        cwd: input.cwd,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        firstAgentContext: { ...firstAgentContext, prompt: firstAgentContext.prompt.trim() },
      },
      input.source === undefined ? undefined : { source: input.source },
    );
    return created.workspaceId;
  } catch (error) {
    input.logger?.warn("channel workspace organization: workspace creation failed", {
      err: error,
      cwd: input.cwd,
    });
    return undefined;
  }
}
