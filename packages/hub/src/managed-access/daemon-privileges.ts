import type { ResolvedDaemonAccess } from "../access/store.js";

/**
 * A daemon names the Project privileges it understands in this header when it consumes a ticket
 * or refreshes a lease. The Hub never issues one the daemon would not enforce: an older daemon
 * either rejects the whole ticket or, worse, honors the session permission that comes with it
 * without narrowing it (`schedule.manage` brings `automation.manage`). A header, not a body field,
 * so an older Hub that validates the body strictly keeps working.
 */
export const DAEMON_PROJECT_PRIVILEGES_HEADER = "x-clisbot-project-privileges";

/** Privileges a daemon that sends no header predates; everything else every daemon knows. */
const PRIVILEGES_NEWER_THAN_THE_HEADER = new Set(["schedule.manage"]);

/** The session permission each newer privilege brings, dropped with it. */
const PERMISSION_BROUGHT_BY: Record<string, string> = { "schedule.manage": "automation.manage" };

export function daemonKnownPrivileges(header: string | null): (privilege: string) => boolean {
  if (header === null) return (privilege) => !PRIVILEGES_NEWER_THAN_THE_HEADER.has(privilege);
  const known = new Set(
    header
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return (privilege) => known.has(privilege);
}

/** The authority narrowed to what the daemon can enforce; owners and Host admins pass through. */
export function limitAuthorityToDaemon<T extends ResolvedDaemonAccess>(
  authority: T,
  knows: (privilege: string) => boolean,
): T {
  if (authority.resourceMode !== "projects") return authority;
  const projects = authority.projects.map((project) => ({
    ...project,
    privileges: project.privileges.filter(knows),
  }));
  const daemonPrivileges = authority.daemonPrivileges.filter(knows);
  const held = new Set([...daemonPrivileges, ...projects.flatMap((project) => project.privileges)]);
  const dropped = new Set(
    Object.entries(PERMISSION_BROUGHT_BY)
      .filter(([privilege]) => !held.has(privilege))
      .map(([, permission]) => permission),
  );
  return {
    ...authority,
    projects,
    daemonPrivileges,
    permissions: authority.permissions.filter((permission) => !dropped.has(permission)),
  };
}
