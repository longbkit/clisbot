/**
 * The Session's side of Terminal profiles: resolving a `profileId` launch from this
 * daemon's own config, recording each launch, and `terminal.profile.list`
 * (docs/features/access/terminal-and-project-creation.md#launch). Kept here so
 * `session.ts`, an upstream file, only wires it in.
 */
import type {
  SessionOutboundMessage,
  TerminalProfile,
  TerminalProfileListRequest,
} from "@getpaseo/protocol/messages";
import {
  PROMPT_SENTINEL,
  resolveTerminalProfileLaunch,
  resolveTerminalProfiles,
  type TerminalProfileLaunch,
} from "@getpaseo/protocol/terminal-profiles";
import type { TerminalSession } from "../../terminal/terminal.js";
import { launchableTerminalProfiles } from "./terminal-access.js";
import { trackTerminalLaunch } from "./terminal-launches.js";
import type { ProjectAuthorization } from "./types.js";

interface TerminalProfileAuthority {
  isRestricted(): boolean;
  terminalGrantForCwd(cwd: string): Promise<ProjectAuthorization | "unrestricted" | null>;
}

export interface TerminalProfileSession {
  /** Options for `TerminalSessionController`. */
  controllerHooks: {
    resolveProfileLaunch(profileId: string, prompt: string): TerminalProfileLaunch | null;
    onTerminalCreated(session: TerminalSession, launch: { profileId?: string }): void;
  };
  handleList(request: TerminalProfileListRequest): Promise<SessionOutboundMessage>;
}

export function createTerminalProfileSession(deps: {
  configuredProfiles(): TerminalProfile[] | undefined;
  authority: TerminalProfileAuthority;
  actorId(): string | undefined;
}): TerminalProfileSession {
  const profiles = () => resolveTerminalProfiles(deps.configuredProfiles());
  return {
    controllerHooks: {
      resolveProfileLaunch: (profileId, prompt) =>
        resolveProfileLaunch(profiles(), profileId, prompt, deps.authority.isRestricted()),
      onTerminalCreated: (session, launch) => {
        const createdBy = deps.actorId();
        trackTerminalLaunch(session, { ...launch, ...(createdBy ? { createdBy } : {}) });
      },
    },
    handleList: async (request) => ({
      type: "terminal.profile.list.response",
      payload: {
        requestId: request.requestId,
        ...launchableTerminalProfiles(
          profiles(),
          await deps.authority.terminalGrantForCwd(request.cwd),
        ),
        error: null,
      },
    }),
  };
}

/**
 * What a `profileId` launch runs, or null to refuse it. Never a shell by accident:
 * an empty resolved command would start the default shell. For a restricted
 * session a prompt must stay an argument: a profile whose command is the prompt
 * slot would let the prompt pick the program, and a leading `-` would reach the
 * CLI's option parser (`--dangerously-skip-permissions`), so it gets a space.
 */
export function resolveProfileLaunch(
  profiles: readonly TerminalProfile[],
  profileId: string,
  prompt: string,
  restricted: boolean,
): TerminalProfileLaunch | null {
  const profile = profiles.find(({ id }) => id === profileId);
  if (!profile) return null;
  if (restricted && profile.command.includes(PROMPT_SENTINEL)) return null;
  const safePrompt = restricted && prompt.startsWith("-") ? ` ${prompt}` : prompt;
  const launch = resolveTerminalProfileLaunch(profile, safePrompt);
  return launch.command.trim() === "" ? null : launch;
}
