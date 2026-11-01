import { CONNECTOR_CARD_METADATA } from "@clisbot/protocol/connectors/types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import type {
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
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

/**
 * Set on a request the daemon raised itself (`AgentManager.requestDaemonPermission`), such as
 * a Connector's connect and send cards. Only a person answers those.
 */
export const DAEMON_PERMISSION_METADATA = "clisbotDaemonPermission";

/**
 * Set by a provider on an MCP server's elicitation (Codex `mcpServer/elicitation/request`). An MCP
 * server asks the user for input or consent it chose to ask for; it is not one of the agent's
 * tool calls, so no automatic policy answers it.
 */
export const MCP_ELICITATION_METADATA = "clisbotMcpElicitation";

/** Set when the daemon's automatic approval failed: the request now waits for a person. */
export const AUTO_ACCEPT_FAILED_METADATA = "clisbotAutoAcceptFailed";

/**
 * Requests a person must answer whatever the mode: daemon-owned cards, Connector cards, choices,
 * MCP elicitations and a request the daemon already failed to approve.
 */
function isPersonOnlyRequest(request: AgentPermissionRequest): boolean {
  const metadata = request.metadata;
  if (!metadata) return false;
  return (
    metadata[DAEMON_PERMISSION_METADATA] === true ||
    metadata[AUTO_ACCEPT_FAILED_METADATA] === true ||
    metadata[CONNECTOR_CARD_METADATA] !== undefined ||
    metadata[PERMISSION_CHOICE_METADATA] === true ||
    metadata[MCP_ELICITATION_METADATA] === true
  );
}

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

/**
 * A tool approval that offers an allow. Never a question, a plan, a mode switch, a choice, or
 * a card the daemon raised itself (Connector connect and send cards).
 */
export function isAutoAcceptablePermission(request: AgentPermissionRequest): boolean {
  if (request.kind !== "tool") return false;
  if (isPersonOnlyRequest(request)) return false;
  const actions = request.actions ?? [];
  return actions.length === 0 || actions.some((action) => action.behavior === "allow");
}

/** The provider's own auto-accept toggle (ACP, Copilot, OpenCode). */
const PROVIDER_AUTO_ACCEPT_FEATURE_ID = "auto_accept";

/**
 * What decides whether the daemon answers: the agent's Full auto-accept flag and the features the
 * provider reports. A live agent and its snapshot carry both, so the daemon, local waiters and a
 * remote observer reading a snapshot judge the same request the same way.
 */
export interface AutoAcceptState {
  fullAutoAccept?: boolean;
  features?: readonly { id: string; value?: unknown }[] | null;
}

/**
 * A provider whose own auto-accept is on answers first; the daemon answering too would race it.
 * The provider answers from the toggle it reports, so that is what is read here, not the stored
 * `featureValues`, which a provider without the toggle ignores.
 */
function providerAutoAccepts(features: AutoAcceptState["features"]): boolean {
  return (
    features?.some(
      (feature) =>
        feature.id === PROVIDER_AUTO_ACCEPT_FEATURE_ID &&
        (feature.value === true || feature.value === "true"),
    ) === true
  );
}

/** True when the daemon answers this request for the user, so no person is waited on. */
export function isDaemonAutoAccepted(
  state: AutoAcceptState,
  request: AgentPermissionRequest,
): boolean {
  return (
    state.fullAutoAccept === true &&
    !providerAutoAccepts(state.features) &&
    isAutoAcceptablePermission(request)
  );
}
