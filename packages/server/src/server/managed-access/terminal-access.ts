/**
 * Terminal versus Terminal profiles for a Project-restricted session
 * (docs/features/access/terminal-and-project-creation.md#using-a-running-terminal).
 * A shell needs `terminal.use`; a profile terminal needs `terminal.use`, or
 * `terminal.profile.use` with that profile granted.
 */
import {
  PROMPT_SENTINEL,
  getTerminalProfileIcon,
  profileTakesPrompt,
} from "@getpaseo/protocol/terminal-profiles";
import type { TerminalProfile } from "@getpaseo/protocol/messages";
import type { ProjectAuthorization } from "./types.js";

/** Whether the grant may launch, or use a terminal launched from, `profileId`. */
export function grantAllowsProfile(
  grant: ProjectAuthorization | undefined,
  profileId: string,
): boolean {
  if (grant === undefined || !grant.privileges.has("project.use")) return false;
  if (grant.privileges.has("terminal.use")) return true;
  if (!grant.privileges.has("terminal.profile.use")) return false;
  const granted = grant.terminalProfiles;
  return granted === "*" || (granted?.includes(profileId) ?? false);
}

/** Whether the grant may use a terminal launched as `profileId`, or a shell when absent. */
export function grantAllowsTerminalLaunch(
  grant: ProjectAuthorization | undefined,
  profileId: string | undefined,
): boolean {
  if (profileId === undefined) {
    return grant?.privileges.has("project.use") === true && grant.privileges.has("terminal.use");
  }
  return grantAllowsProfile(grant, profileId);
}

/** Any terminal privilege at all: lists are admitted, then filtered per terminal. */
export function grantHasAnyTerminal(grant: ProjectAuthorization | undefined): boolean {
  return (
    grant?.privileges.has("project.use") === true &&
    (grant.privileges.has("terminal.use") || grant.privileges.has("terminal.profile.use"))
  );
}

/**
 * What `terminal.profile.list` returns. A session without the shell gets only its
 * granted profiles, and never their command or args, which can carry secrets: the
 * daemon resolves the command at launch. The icon and prompt slot the app would
 * otherwise read from the command come resolved.
 */
export function launchableTerminalProfiles(
  profiles: readonly TerminalProfile[],
  grant: ProjectAuthorization | "unrestricted" | null | undefined,
): { profiles: TerminalProfile[]; shell: boolean } {
  if (grant === "unrestricted") return { profiles: [...profiles], shell: true };
  if (grant === null || grant === undefined || !grantHasAnyTerminal(grant)) {
    return { profiles: [], shell: false };
  }
  if (grant.privileges.has("terminal.use")) return { profiles: [...profiles], shell: true };
  return {
    profiles: profiles
      .filter((profile) => grantAllowsProfile(grant, profile.id))
      .map((profile) => withoutCommand(profile)),
    shell: false,
  };
}

function withoutCommand(profile: TerminalProfile): TerminalProfile {
  const redacted: TerminalProfile = {
    id: profile.id,
    name: profile.name,
    command: "",
    args: profileTakesPrompt(profile) ? [PROMPT_SENTINEL] : [],
  };
  const icon = getTerminalProfileIcon(profile);
  if (icon !== undefined) redacted.icon = icon;
  return redacted;
}
