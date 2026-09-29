/**
 * Which Terminal profiles, and whether a shell, a launch menu offers
 * (docs/features/access/terminal-and-project-creation.md#profile-list).
 * A daemon that advertises `terminalProfileGrants` answers per Project; any
 * other daemon has no Managed Access over terminals, so its own config applies.
 */
import type { TerminalProfile } from "@clisbot/protocol/messages";
import { resolveTerminalProfiles } from "@clisbot/protocol/terminal-profiles";

export interface LaunchableTerminalProfiles {
  profiles: readonly TerminalProfile[];
  shell: boolean;
  /** Settings › Terminals can change profiles: Administrator on a managed Host. */
  canManageProfiles: boolean;
}

export function launchableFromConfig(
  configured: TerminalProfile[] | undefined,
  permissions: readonly string[] | undefined,
): LaunchableTerminalProfiles {
  return {
    profiles: resolveTerminalProfiles(configured),
    shell: true,
    canManageProfiles: canManageTerminalProfiles(permissions),
  };
}

export function canManageTerminalProfiles(permissions: readonly string[] | undefined): boolean {
  // COMPAT(sessionPermissions): older daemons omit this projection; backend remains authoritative.
  return permissions === undefined || permissions.includes("daemon.manage");
}
