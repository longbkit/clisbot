import os from "node:os";
import nodePath from "node:path";
import { parseGitRemoteLocation } from "@clisbot/protocol/git-remote";
import { expandHomePath } from "@clisbot/protocol/project-folders";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { ProjectPrivilege } from "./types.js";

const MANAGE: ProjectPrivilege = "workspace.manage";

/**
 * Replies that describe the Project or workspace a creation request just made.
 * That Project is not in the session's ticket yet, so the ordinary outbound filter
 * would drop the reply and leave the request unanswered.
 */
export const PROJECT_CREATION_REPLIES: ReadonlySet<SessionOutboundMessage["type"]> = new Set([
  "project.add.response",
  "open_project_response",
  "project.create_directory.response",
  "project.github.clone.response",
  "bot.create.response",
]);

/**
 * What a `workspace.manage` operation acts on. The daemon permission is granted to
 * the whole session, so each operation must be checked against its own targets:
 * holding the privilege on one Project must not reach another.
 */
export type WorkspaceManagementTarget =
  /** A Project that may not exist yet: the folder that becomes its root. */
  | { kind: "new-project"; path: string }
  /**
   * Every resource the request names. Handlers choose between them (a worktree
   * archive acts on `worktreePath` before `workspaceId`), so all must be allowed.
   */
  | { kind: "existing"; resources: readonly ExistingResource[] };

type ExistingResource =
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "path"; path: string };

export interface WorkspaceManagementAuthority {
  allowsDaemonPrivilege(privilege: ProjectPrivilege): boolean;
  allowsProject(projectId: string, privilege: ProjectPrivilege): boolean;
  allowsWorkspace(workspaceId: string, privilege: ProjectPrivilege): Promise<boolean>;
  allowsCwd(cwd: string, privilege: ProjectPrivilege): Promise<boolean>;
  /** Whether `path` is already a Project's root or a workspace's folder: adding it creates nothing. */
  isExistingProjectPlace(path: string): Promise<boolean>;
  /** The Host folder policy, the creating Host grants' rules, and no nesting. */
  mayCreateProjectAt(path: string): Promise<boolean>;
}

/** The targets of a `workspace.manage` operation, or undefined for any other message. */
export function workspaceManagementTarget(
  message: SessionInboundMessage,
): WorkspaceManagementTarget | undefined {
  switch (message.type) {
    case "project.add.request":
    case "open_project_request":
      return { kind: "new-project", path: expandHome(message.cwd) };
    case "project.create_directory.request":
      return {
        kind: "new-project",
        path: nodePath.join(expandHome(message.parentPath), message.name),
      };
    case "project.github.clone.request": {
      const folder = cloneFolderName(message.repo);
      // A name the handler would refuse names no resource, so it is refused here too.
      return folder === null
        ? existing({})
        : { kind: "new-project", path: nodePath.join(expandHome(message.targetDirectory), folder) };
    }
    case "project.rename.request":
    case "project.icon.set.request":
    case "project.remove.request":
      return existing({ projectId: message.projectId });
    case "archive_workspace_request":
    case "workspace.recovery.restore.request":
    case "workspace.title.set.request":
    case "workspace.pin.set.request":
      return existing({ workspaceId: message.workspaceId });
    case "clisbot_worktree_archive_request":
      return existing({
        workspaceId: message.workspaceId,
        paths: [message.worktreePath, message.repoRoot],
      });
    case "create_clisbot_worktree_request":
      // The worktree is made from `cwd` and attached to `projectId`.
      return existing({ projectId: message.projectId, paths: [message.cwd] });
    default:
      return undefined;
  }
}

function existing(named: {
  projectId?: string | undefined;
  workspaceId?: string | undefined;
  paths?: ReadonlyArray<string | undefined>;
}): WorkspaceManagementTarget {
  const resources: ExistingResource[] = [];
  if (named.projectId !== undefined)
    resources.push({ kind: "project", projectId: named.projectId });
  if (named.workspaceId !== undefined) {
    resources.push({ kind: "workspace", workspaceId: named.workspaceId });
  }
  for (const path of named.paths ?? []) {
    if (path !== undefined) resources.push({ kind: "path", path });
  }
  return { kind: "existing", resources };
}

/**
 * Whether a Project-restricted session may run a `workspace.manage` operation, or
 * undefined when the message is not one. Only a Host grant creates, where
 * `mayCreateProjectAt` allows; re-adding an existing Project needs the privilege on
 * it. Every other case needs the privilege on each resource the request names,
 * and a request that names none is refused.
 */
export async function allowsWorkspaceManagement(
  message: SessionInboundMessage,
  authority: WorkspaceManagementAuthority,
): Promise<boolean | undefined> {
  const target = workspaceManagementTarget(message);
  if (target === undefined) return undefined;
  if (target.kind === "new-project") {
    if (await authority.isExistingProjectPlace(target.path)) {
      return authority.allowsCwd(target.path, MANAGE);
    }
    return (
      authority.allowsDaemonPrivilege(MANAGE) && (await authority.mayCreateProjectAt(target.path))
    );
  }
  if (target.resources.length === 0) return false;
  const checks = await Promise.all(
    target.resources.map((resource) => allowsResource(resource, authority)),
  );
  return checks.every(Boolean);
}

function allowsResource(
  resource: ExistingResource,
  authority: WorkspaceManagementAuthority,
): boolean | Promise<boolean> {
  switch (resource.kind) {
    case "project":
      return authority.allowsProject(resource.projectId, MANAGE);
    case "workspace":
      return authority.allowsWorkspace(resource.workspaceId, MANAGE);
    case "path":
      return authority.allowsCwd(resource.path, MANAGE);
  }
}

function expandHome(value: string): string {
  return expandHomePath(value, os.homedir());
}

/**
 * The folder a clone lands in, named the way the clone handler names it
 * (`normalizeCloneRepository` in `session.ts`): the remote's last path segment,
 * or `name` of `owner/name`, without `.git`.
 */
function cloneFolderName(repo: string): string | null {
  const trimmed = repo.trim();
  const remote = parseGitRemoteLocation(trimmed);
  const raw = remote
    ? remote.path.split("/").findLast((segment) => segment.length > 0)
    : trimmed.split("/")[1];
  const name = raw?.endsWith(".git") ? raw.slice(0, -4) : raw;
  if (!name || name === "." || name === ".." || /[/\\]/.test(name)) return null;
  return name;
}
