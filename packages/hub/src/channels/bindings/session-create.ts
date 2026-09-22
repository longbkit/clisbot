// Minting the daemon session a route's first mention needs (§4.3.4): the
// conversation's `/agent` + `/model` selection folded onto the route's agent
// spec, the reply capability a `tool`-path route attaches, the workspace the
// session lands in, and the trusted `create_agent_request` itself.
//
// The bot is created IDLE (implementation doc §2.1): the caller delivers the
// first channel prompt only after it has subscribed the session's stream, so
// splitting create from send is what keeps the first turn observable.
//
// The engine (`index.ts`) owns the decision and the binding row; this file
// owns everything between "admitted" and "the session exists". Its context is
// the narrowed slice of the engine's, so the dependencies of minting a session
// are visible without reading the engine.

import type { ChannelStore } from "../../db/channels.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import { outboundAttachesTool } from "../config/enums.js";
import type { DaemonConnection } from "../daemon/client.js";
import type { AgentSnapshot, CreateAgentConfig } from "../daemon/types.js";
import { resolveConversationConfiguration } from "../commands-config.js";
import { autoAllowsEveryToolClass } from "../policy.js";
import { HostNotReachedError } from "../daemon/enrolled-client.js";
import { HostBusyError } from "../daemon/create-gate.js";
import { resolveSessionWorkspaceId } from "../workspace-organization.js";
import {
  nativeSenderId,
  type ChannelReplyCapabilityService,
} from "../channel-reply-capabilities.js";
import type {
  AgentSpecResolver,
  ChannelAgentAccessTarget,
  ChannelReplyBindingRef,
  InboundMessage,
  PlaneLogger,
  SupportedChannelName,
} from "../plane/types.js";
import { routeFingerprint, routePosition, type ThreadKey } from "./stored-route.js";
import { sessionTitle } from "./prompt.js";

/** What minting a session needs from the plane; `BindingEngineContext` extends it. */
export interface SessionCreateContext {
  organizationId: string;
  channelRevisionId?: string | null | undefined;
  logger: PlaneLogger;
  store: Pick<ChannelStore, "access">;
  daemon: DaemonConnection;
  replyCapabilities?: ChannelReplyCapabilityService | undefined;
  /** Resolve a route's agent target into a `create_agent_request` config.
   * The route's effective defaults select the outbound path (E4/E6); on a
   * `tool` path the `bindingRef` names the thread the attached MCP tool
   * posts into (the account + the thread key being created). */
  resolveAgentSpec: AgentSpecResolver;
  resolveAgentAccessTarget?:
    | ((target: Extract<CompiledRoute["target"], { kind: "agent" }>) => ChannelAgentAccessTarget)
    | undefined;
  /** COMPAT(clisbot-control-plane): record a created agent's home (its
   * create-time `cwd`) for the relay's native-media path (G7–G11). The plane
   * owns the agentId→cwd Map; the relay resolves it through its `agentCwd`
   * resolver. Absent = the engine records nothing (the relay's media home
   * falls back to the shared home root). */
  noteAgentCwd?: ((agentId: string, cwd: string) => void) | undefined;
}

/** The agent label carrying the pending execution id, so orphan recovery can
 * find the agent a crashed create left behind. A label rather than the title:
 * the title belongs to the reader, and the daemon names an untitled agent from
 * its first message. */
export const CHANNEL_EXECUTION_ID_LABEL = "clisbot.channel-execution-id";
const AUTO_ACCEPT_FEATURE_ID = "auto_accept";

/**
 * Route "Accept automatically" means the session should auto-accept permission
 * prompts. That is the daemon `auto_accept` feature — independent of
 * `toolPolicy`, which preapproves exact MCP tools when the provider contract
 * supports it.
 */
export function applyRouteAutoAccept(
  config: CreateAgentConfig,
  route: CompiledRoute,
): CreateAgentConfig {
  if (!autoAllowsEveryToolClass(route)) return config;
  return {
    ...config,
    featureValues: { ...config.featureValues, [AUTO_ACCEPT_FEATURE_ID]: true },
  };
}

export function channelExecutionLabels(pendingExecutionId: string): Record<string, string> {
  return { [CHANNEL_EXECUTION_ID_LABEL]: pendingExecutionId };
}

/** The agent a pending execution created, if it survived. */
export function findChannelExecutionAgent(
  agents: readonly AgentSnapshot[],
  pendingExecutionId: string,
): AgentSnapshot | undefined {
  return agents.find(
    (agent) =>
      agent.labels?.[CHANNEL_EXECUTION_ID_LABEL] === pendingExecutionId ||
      // COMPAT(channel-execution-title-marker): added 2026-09-17, remove after 2026-12-31.
      // A create pending across the Hub upgrade still carries the old title marker.
      agent.title === `clisbot-channel:${pendingExecutionId}`,
  );
}

/**
 * The create RPC was issued and did not confirm. The daemon may hold the Agent
 * anyway (a timeout, a socket that dropped mid-call), so the thread's pending
 * marker is the only way back to it and must stay.
 */
export class ChannelAgentCreateUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super(`agent create unconfirmed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = "ChannelAgentCreateUnconfirmedError";
  }
}

export class ChannelWorkflowTargetError extends Error {
  constructor(workflow: string) {
    super(`route targets workflow ${workflow}; the bindings plane drives agent routes only`);
    this.name = "ChannelWorkflowTargetError";
  }
}

function issueReplyCapability(
  context: SessionCreateContext,
  input: {
    account: CompiledChannelAccount;
    route: CompiledRoute;
    ref: ChannelReplyBindingRef;
    executionId: string;
    requester: InboundMessage;
    target: Extract<CompiledRoute["target"], { kind: "agent" }>;
  },
): { token: string; canSendFiles: boolean } {
  const { account, route, ref, executionId, requester } = input;
  const capabilities = context.replyCapabilities;
  const accessTarget = context.resolveAgentAccessTarget?.(input.target);
  if (capabilities === undefined || accessTarget === undefined) {
    throw new Error("Channel reply capability is unavailable");
  }
  const token = capabilities.issue({
    organizationId: context.organizationId,
    channelRevisionId: context.channelRevisionId ?? null,
    routePosition: routePosition(account, route),
    routeFingerprint: routeFingerprint(route),
    ref,
    // The turn that is minting the session. Every later turn restamps it
    // (`noteTurn` in `followUp`): the tool's idempotency keys and its
    // output ceiling are scoped by the turn, and the model reuses
    // "reply-1" in every one of them.
    turnId: executionId,
    // The turn's requester, in the native form the platform reports back:
    // the ported channel tools authorize against it, and a command button
    // this Agent posts is clickable only by them.
    requesterSenderId: nativeSenderId(account.channel, requester.senderIdentity),
    // The message this turn is answering, so the tool's `react` has a
    // current message to target (see `requesterMessageId`).
    ...(requester.externalMessageId === undefined
      ? {}
      : { requesterMessageId: requester.externalMessageId }),
    ...(accessTarget.projectRoot === undefined ? {} : { projectRoot: accessTarget.projectRoot }),
  });
  return { token, canSendFiles: accessTarget.projectRoot !== undefined };
}

/**
 * Issue the trusted `create_agent_request` with the route's agent target. The
 * bot is created IDLE (implementation doc §2.1): the caller delivers the
 * first channel prompt only after it has subscribed the session's stream,
 * so splitting create from send is what keeps the first turn observable.
 */
export async function createRouteSession(
  context: SessionCreateContext,
  account: CompiledChannelAccount,
  route: CompiledRoute,
  key: ThreadKey,
  executionId: string,
  requester: InboundMessage,
): Promise<{ agentId: string }> {
  const routeTarget = route.target;
  if (routeTarget.kind !== "agent") {
    throw new ChannelWorkflowTargetError(routeTarget.workflow);
  }
  const ref = {
    channel: account.channel as SupportedChannelName,
    accountId: account.accountId,
    externalConversationId: key.externalConversationId,
    externalThreadId: key.externalThreadId,
  };
  // `/agent` and `/model` are conversation-scoped and outlive every session
  // in it, so they are read here — at the one place a session is minted —
  // rather than carried on the binding row that `/new` deletes.
  const chosen = await context.store.access.findConversationSelection({
    organizationId: context.organizationId,
    ...ref,
  });
  const target = routeTarget;
  const issued = outboundAttachesTool(route.defaults.outbound.path)
    ? issueReplyCapability(context, { account, route, ref, executionId, requester, target })
    : undefined;
  const capabilityToken = issued?.token;
  const canSendFiles = issued?.canSendFiles === true;
  try {
    const baseConfig = context.resolveAgentSpec(
      target,
      route.defaults,
      ref,
      capabilityToken === undefined
        ? undefined
        : {
            token: capabilityToken,
            canSendFiles,
          },
      undefined,
    );
    // No per-sender Access check: the Route publisher delegated this
    // configuration and the conversation selection was checked against whoever
    // made it. Chat authority was settled at admission.
    const config = applyRouteAutoAccept(
      resolveConversationConfiguration(baseConfig, chosen),
      route,
    );
    const workspaceId = await resolveSessionWorkspace(context, route, config, requester);
    const created = await context.daemon
      .createAgent(config, {
        ...createIdentity(executionId, requester),
        source: requester,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      })
      .catch((error: unknown) => {
        // Never written to the Host: there is no Agent to find, so no marker to keep.
        if (error instanceof HostNotReachedError || error instanceof HostBusyError) throw error;
        throw new ChannelAgentCreateUnconfirmedError(error);
      });
    if (
      capabilityToken !== undefined &&
      context.replyCapabilities?.bind(capabilityToken, created.agentId) !== true
    ) {
      await context.daemon.cancelAgent(created.agentId).catch(() => undefined);
      throw new Error("Channel reply capability could not bind to the created Agent");
    }
    // COMPAT(clisbot-control-plane): the agent's home for the relay's
    // native-media path — the `cwd` the daemon runs it in (G7–G11).
    context.noteAgentCwd?.(created.agentId, config.cwd);
    return { agentId: created.agentId };
  } catch (error) {
    // An unconfirmed create may still produce the Agent, and that Agent was
    // launched with this token: revoking it now would leave it able to work but
    // not to answer. The marker's recovery binds it or revokes it.
    if (capabilityToken !== undefined && !(error instanceof ChannelAgentCreateUnconfirmedError)) {
      context.replyCapabilities?.revoke(capabilityToken);
    }
    throw error;
  }
}

/**
 * A thread's first session has no session to continue, so it opens a new
 * workspace named from the inbound that mints it (A3). Off, or on a daemon
 * that cannot create one, the daemon places the session as before.
 */
async function resolveSessionWorkspace(
  context: SessionCreateContext,
  route: CompiledRoute,
  config: CreateAgentConfig,
  requester: InboundMessage,
): Promise<string | undefined> {
  return await resolveSessionWorkspaceId(context.daemon, {
    organize: route.defaults.workspace?.organize,
    cwd: config.cwd,
    ...(config.projectId === undefined ? {} : { projectId: config.projectId }),
    firstAgentContext: { prompt: requester.text },
    source: requester,
    logger: context.logger,
  });
}

/** The created Agent's labels (orphan recovery) and title: the trigger's own
 * first line, never the rendered prompt the daemon would otherwise name it from. */
function createIdentity(
  executionId: string,
  requester: InboundMessage,
): { labels: Record<string, string>; title?: string } {
  const title = sessionTitle(requester.text);
  return { labels: channelExecutionLabels(executionId), ...(title === undefined ? {} : { title }) };
}
