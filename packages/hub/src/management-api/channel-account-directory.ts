// The per-account directory reads behind the Route editor's pickers: the
// conversations one bot has seen (plus the authored destinations, named when
// the vertical can resolve them) and the senders outside the Hub who have
// messaged it. Both are Channel Route Admin reads (`channel-admin.ts`).

import type { CompiledChannelAccount } from "../channels/config/compile.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import { configuredChannelDestinations } from "../channels/configured-destinations.js";
import { listObservedChannelConversations } from "../channels/conversation-catalog.js";
import { listObservedUnlinkedSenders } from "../channels/observed-senders.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";

export async function accountConversationsView(
  deps: { runtime: DatabaseRuntime; channelSupervisor: ChannelSupervisor | null },
  organizationId: string,
  target: { channel: SupportedChannelName; accountId: string },
  account: CompiledChannelAccount,
) {
  const conversations = await listObservedChannelConversations(deps.runtime, {
    organizationId,
    ...target,
  });
  const destinations = await configuredChannelDestinations(
    account,
    conversations,
    (conversationId, budget) =>
      deps.channelSupervisor?.resolveConversation?.({
        organizationId,
        ...target,
        connectionId: account.connectionId,
        conversationId,
        budget,
      }) ?? Promise.resolve(null),
  );
  return {
    destinations,
    conversations: conversations.map((conversation) =>
      Object.assign({}, conversation, { observedAt: conversation.observedAt.toISOString() }),
    ),
  };
}

export async function accountSendersView(
  runtime: DatabaseRuntime,
  organizationId: string,
  account: CompiledChannelAccount,
) {
  const senders = await listObservedUnlinkedSenders(runtime, {
    organizationId,
    channel: account.channel,
    accountId: account.accountId,
    connectionId: account.connectionId,
  });
  return {
    senders: senders.map((sender) =>
      Object.assign({}, sender, { lastSeenAt: sender.lastSeenAt.toISOString() }),
    ),
  };
}
