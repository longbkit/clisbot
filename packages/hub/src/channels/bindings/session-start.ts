// The durable half of starting a thread's first session: the pre-create marker,
// the create it guards, and what becomes of the marker when that create fails.
// `BindingEngine` decides *whether* a session starts; this module makes the
// start recoverable.
import { placementTarget } from "../placement-selection.js";
import { ChannelThreadBindingConflictError, type ChannelStore } from "../../db/channels.js";
import type { ThreadBindingRecord } from "../../db/types.js";
import type { CompiledChannelAccount, CompiledRoute } from "../config/compile.js";
import type { ProcessingController } from "../plane/processing.js";
import type { InboundMessage, SupportedChannelName } from "../plane/types.js";
import { watchSlowCreate } from "./pending-marker.js";
import {
  ChannelAgentCreateUnconfirmedError,
  createRouteSession,
  type SessionCreateContext,
} from "./session-create.js";
import { bindingSummary, routePosition, type ThreadKey } from "./stored-route.js";

export interface SessionStartContext extends SessionCreateContext {
  store: ChannelStore;
  processing?: ProcessingController | undefined;
  /** Tell the sender, once, that their session is taking long to start. */
  onSlowStart?:
    | ((message: InboundMessage, account: CompiledChannelAccount, route: CompiledRoute) => void)
    | undefined;
}

/** One session start: the thread it is for and the execution that names it. */
export interface SessionStart {
  account: CompiledChannelAccount;
  route: CompiledRoute;
  key: ThreadKey;
  executionId: string;
  message: InboundMessage;
  selectedPlacement?: import("../placement-selection.js").ChannelPlacementSelection | null;
}

/**
 * Record the pre-create marker. Returns the marker already there when a
 * concurrent mention won the insert between the caller's lookup and this one,
 * so the caller drives that marker instead of creating a second agent.
 */
export async function recordSessionMarker(
  context: SessionStartContext,
  start: SessionStart,
): Promise<ThreadBindingRecord | undefined> {
  const { account, route, key, message } = start;
  if (context.authorizePlacement) {
    const chosen = await context.store.access.findConversationSelection({
      organizationId: context.organizationId,
      channel: account.channel as SupportedChannelName,
      accountId: account.accountId,
      ...key,
    });
    start.selectedPlacement =
      route.defaults.workspace?.commands === false ? null : (chosen?.selectedPlacement ?? null);
  }
  const defaultPlacement =
    route.target.kind === "agent" ? context.resolveAgentAccessTarget?.(route.target) : undefined;
  const placement = start.selectedPlacement
    ? placementTarget(start.selectedPlacement)
    : defaultPlacement;
  try {
    await context.store.recordPendingThreadBinding({
      organizationId: context.organizationId,
      channel: account.channel as SupportedChannelName,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
      pendingExecutionId: start.executionId,
      initiator: message.senderIdentity,
      route: {
        ...(placement ? { placement } : {}),
        ...bindingSummary(
          route,
          message.conversation,
          {
            revisionId: context.channelRevisionId ?? null,
            position: routePosition(account, route),
          },
          message.conversationLabel,
        ),
      },
    });
    return undefined;
  } catch (error) {
    // The conflict is the only record failure a lookup-then-insert can hit;
    // anything else is a real fault and stays fatal.
    if (!(error instanceof ChannelThreadBindingConflictError)) throw error;
    const existing = await context.store.findThreadBinding(
      context.organizationId,
      account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    if (existing?.status === "pending") return existing;
    throw error;
  }
}

/**
 * Create the marked session and resolve its marker. A create that did not
 * confirm keeps the marker, because the daemon may hold the Agent anyway and
 * the marker is the way back to it; a create that never reached the daemon has
 * nothing to recover, so its marker is released. The failure is rethrown:
 * the plane answers a refused placement, while durable ingress retries a
 * transport failure instead of completing it unanswered.
 */
export async function createMarkedSession(
  context: SessionStartContext,
  start: SessionStart,
): Promise<string> {
  const { account, route, key, executionId, message } = start;
  const stopWatching = watchSlowCreate({
    keepSurface: () => context.processing?.extend(executionId),
    tellSender: () => context.onSlowStart?.(message, account, route),
  });
  try {
    const created = await createRouteSession(
      context,
      account,
      route,
      key,
      executionId,
      message,
      start.selectedPlacement,
    );
    await context.store.resolvePendingThreadBinding({
      organizationId: context.organizationId,
      accountId: account.accountId,
      externalConversationId: key.externalConversationId,
      externalThreadId: key.externalThreadId,
      agentId: created.agentId,
      resolvedAt: new Date(),
    });
    return created.agentId;
  } catch (error) {
    context.processing?.close(executionId);
    const unconfirmed = error instanceof ChannelAgentCreateUnconfirmedError;
    if (!unconfirmed) await releasePendingMarker(context, account, key, executionId);
    context.logger.warn(
      unconfirmed
        ? "agent create unconfirmed; the thread marker stays pending"
        : "agent create failed before reaching the Host; the thread marker is released",
      {
        accountId: account.accountId,
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  } finally {
    stopWatching();
  }
}

/** Give up on a create: free the thread, and revoke what the create was launched with. */
export async function releasePendingMarker(
  context: SessionStartContext,
  account: CompiledChannelAccount,
  key: ThreadKey,
  executionId: string,
): Promise<void> {
  await context.store.releaseThreadBinding({
    organizationId: context.organizationId,
    accountId: account.accountId,
    externalConversationId: key.externalConversationId,
    externalThreadId: key.externalThreadId,
    expectedPendingExecutionId: executionId,
  });
  context.replyCapabilities?.revokeUnboundTurn(executionId);
}
