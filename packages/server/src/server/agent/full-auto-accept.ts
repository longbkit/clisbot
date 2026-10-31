import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import type {
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSessionConfig,
} from "./agent-sdk-types.js";

/**
 * Full auto-accept: the agent runs the provider's no-prompt mode, and the daemon approves
 * any tool permission request the agent still raises, whether or not a client is
 * connected. Questions, plans and choices always wait for a person.
 */
export { FULL_AUTO_ACCEPT_MODE_ID };

/**
 * Set by a provider on a request that asks the user to pick one of several answers
 * (an ACP chooser), so no automatic policy picks one for them.
 */
export const PERMISSION_CHOICE_METADATA = "clisbotChoice";

/** The answer the daemon gives on the user's behalf. Each provider picks its "allow once". */
export const FULL_AUTO_ACCEPT_RESPONSE: AgentPermissionResponse = { behavior: "allow" };

export function isFullAutoAcceptMode(modeId: string | null | undefined): boolean {
  return modeId === FULL_AUTO_ACCEPT_MODE_ID;
}

/** The provider mode Full auto-accept runs on: the no-prompt mode, else the current one. */
export function resolveFullAutoAcceptProviderMode(
  modes: readonly AgentMode[],
  currentModeId: string | null,
): string | null {
  return modes.find((mode) => mode.isUnattended === true)?.id ?? currentModeId;
}

/** A tool approval that offers an allow. Never a question, a plan, a mode switch or a choice. */
export function isAutoAcceptablePermission(request: AgentPermissionRequest): boolean {
  if (request.kind !== "tool") return false;
  if (request.metadata?.[PERMISSION_CHOICE_METADATA] === true) return false;
  const actions = request.actions ?? [];
  return actions.length === 0 || actions.some((action) => action.behavior === "allow");
}

/**
 * A provider whose own auto-accept is on (ACP, Copilot, OpenCode `auto_accept`) answers
 * first; the daemon answering too would race it.
 */
export function shouldDaemonAutoAccept(
  config: AgentSessionConfig,
  request: AgentPermissionRequest,
): boolean {
  return (
    config.fullAutoAccept === true &&
    config.featureValues?.auto_accept !== true &&
    isAutoAcceptablePermission(request)
  );
}
