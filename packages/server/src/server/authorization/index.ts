import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { DAEMON_PERMISSIONS, type DaemonPermission } from "@getpaseo/protocol/messages";
import {
  type PermissionRequirement,
  requiredPermissionForInbound,
  requiredPermissionForOutbound,
} from "./operation-permissions.js";
import type {
  ProjectAuthorization,
  ProjectPrivilege,
  SessionResourceAuthorization,
} from "../managed-access/types.js";

export { DAEMON_PERMISSIONS, type DaemonPermission };

const daemonPermissionSet: ReadonlySet<string> = new Set(DAEMON_PERMISSIONS);

export function isDaemonPermission(value: string): value is DaemonPermission {
  return daemonPermissionSet.has(value);
}

export function parseDaemonPermissions(values: readonly string[]): DaemonPermission[] {
  const permissions = [...new Set(values)];
  if (!permissions.every(isDaemonPermission)) throw new Error("Invalid daemon permission");
  return permissions;
}

export const OWNER_PERMISSIONS: readonly DaemonPermission[] = DAEMON_PERMISSIONS;

export class SessionAuthorization {
  private permissions: ReadonlySet<DaemonPermission>;
  private resources: SessionResourceAuthorization | null;

  constructor(permissions: readonly DaemonPermission[], resources?: SessionResourceAuthorization) {
    this.permissions = new Set(permissions);
    this.resources = resources ?? null;
  }

  allowsInbound(message: SessionInboundMessage): boolean {
    return (
      this.hasActiveLease() &&
      (this.allows(requiredPermissionForInbound(message.type)) ||
        (message.type === "workspace.create.request" && this.allowsManagedWorkspaceCreation()))
    );
  }

  allowsOutbound(message: SessionOutboundMessage): boolean {
    return (
      this.hasActiveLease() &&
      (this.allows(requiredPermissionForOutbound(message)) ||
        (message.type === "workspace.create.response" && this.allowsManagedWorkspaceCreation()))
    );
  }

  // Managed Access owns this narrow exception; ordinary Paseo retains workspace.manage.
  // Exact project/source checks remain with ManagedResourceAuthorizer before dispatch.
  private allowsManagedWorkspaceCreation(): boolean {
    return (
      this.resources?.resourceMode === "projects" &&
      this.permissions.has("workspace.write") &&
      [...this.resources.projects.keys()].some((id) => this.allowsProject(id, "workspace.create"))
    );
  }

  replacePermissions(permissions: readonly DaemonPermission[]): void {
    this.permissions = new Set(permissions);
  }

  replaceResources(resources: SessionResourceAuthorization): void {
    this.resources = {
      resourceMode: resources.resourceMode,
      projects: resources.projects,
      ...(resources.daemonPrivileges === undefined
        ? {}
        : { daemonPrivileges: resources.daemonPrivileges }),
      leaseId: resources.leaseId,
      leaseExpiresAt: resources.leaseExpiresAt,
    };
  }

  listPermissions(): DaemonPermission[] {
    return [...this.permissions];
  }

  allowsPermission(permission: DaemonPermission): boolean {
    return this.permissions.has(permission);
  }

  isResourceRestricted(): boolean {
    return this.resources?.resourceMode === "projects";
  }

  authorizedProjectIds(): readonly string[] | null {
    if (this.resources === null || this.resources.resourceMode === "daemon") return null;
    return [...this.resources.projects.keys()];
  }

  project(projectId: string): ProjectAuthorization | undefined {
    if (this.resources === null || this.resources.resourceMode === "daemon") {
      return undefined;
    }
    return this.resources.projects.get(projectId);
  }

  /** A privilege the Hub granted on the whole Host, not only on listed Projects. */
  allowsDaemonPrivilege(privilege: ProjectPrivilege): boolean {
    if (!this.hasActiveLease()) return false;
    if (this.resources === null || this.resources.resourceMode === "daemon") return true;
    // Mirrors allowsProject: a Project privilege means nothing without project.use.
    const privileges = this.resources.daemonPrivileges;
    return privileges?.has("project.use") === true && privileges.has(privilege);
  }

  allowsProject(projectId: string, privilege: ProjectPrivilege): boolean {
    if (!this.hasActiveLease()) return false;
    if (this.resources === null || this.resources.resourceMode === "daemon") return true;
    const project = this.resources.projects.get(projectId);
    return project?.privileges.has("project.use") === true && project.privileges.has(privilege);
  }

  leaseExpiresAt(): number | null {
    return this.resources?.leaseExpiresAt ?? null;
  }

  leaseId(): string | null {
    return this.resources?.leaseId ?? null;
  }

  extendLease(leaseId: string, leaseExpiresAt: number): boolean {
    if (this.resources?.leaseId !== leaseId || leaseExpiresAt <= this.resources.leaseExpiresAt) {
      return false;
    }
    this.resources.leaseExpiresAt = leaseExpiresAt;
    return true;
  }

  isLeaseActive(): boolean {
    return this.hasActiveLease();
  }

  private allows(requirement: PermissionRequirement): boolean {
    if (requirement === null) return true;
    if (typeof requirement === "string") return this.permissions.has(requirement);
    return requirement.some((permission) => this.permissions.has(permission));
  }

  private hasActiveLease(): boolean {
    return this.resources === null || Date.now() < this.resources.leaseExpiresAt;
  }
}

const LEGACY_HUB_EXECUTION_SCOPE = "hub.execution.*";

export function permissionsForLegacyHubScopes(
  scopes: readonly string[],
): readonly DaemonPermission[] {
  // COMPAT(semanticHubPermissions): added in v0.7, remove after Hub enrollment uses permissions.
  return scopes.includes(LEGACY_HUB_EXECUTION_SCOPE) ? ["hub.execute"] : [];
}
