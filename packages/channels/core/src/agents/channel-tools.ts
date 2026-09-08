/**
 * Channel-owned agent tool and prompt helpers.
 * Discovers channel tools, message actions, prompt capabilities, reaction
 * guidance, and weakly-attached channel metadata for wrapped tools.
 */
import type { ChatType } from "../channels/chat-type.js";
import {
  createMessageActionDiscoveryContext,
  listMessageActionDiscoveryChannels,
  resolveMessageActionDiscoveryForPlugin,
  resolveMessageActionDiscoveryChannelId,
  resolveCurrentChannelMessageToolDiscoveryAdapter,
  type PreparedMessageToolCatalog,
} from "../channels/plugins/message-action-discovery.js";
import type { ChannelMessageActionName } from "../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../channels/plugins/types.public.host-adapter.js";

type ChannelMessageActionDiscoveryParams = {
  cfg?: OpenClawConfig;
  chatType?: ChatType | null;
  currentChannelId?: string | null;
  currentThreadTs?: string | null;
  currentMessageId?: string | number | null;
  accountId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  requesterSenderId?: string | null;
  senderIsOwner?: boolean;
  preparedMessageToolCatalog?: PreparedMessageToolCatalog;
};

/**
 * Get the list of supported message actions for a specific channel.
 * Returns an empty array if channel is not found or has no actions configured.
 */
export function listChannelSupportedActions(
  params: ChannelMessageActionDiscoveryParams & { channel?: string },
): ChannelMessageActionName[] {
  const channelId = resolveMessageActionDiscoveryChannelId(params.channel);
  if (!channelId) {
    return [];
  }
  const pluginActions = resolveCurrentChannelMessageToolDiscoveryAdapter(
    channelId,
    params.preparedMessageToolCatalog,
  );
  if (!pluginActions?.actions) {
    return [];
  }
  return resolveMessageActionDiscoveryForPlugin({
    pluginId: pluginActions.pluginId,
    actions: pluginActions.actions,
    context: createMessageActionDiscoveryContext(params),
    includeActions: true,
  }).actions;
}

/**
 * Get the list of all supported message actions across all configured channels.
 */
export function listAllChannelSupportedActions(
  params: ChannelMessageActionDiscoveryParams,
): ChannelMessageActionName[] {
  const actions = new Set<ChannelMessageActionName>();
  const channels = listMessageActionDiscoveryChannels(params.preparedMessageToolCatalog);
  for (const plugin of channels) {
    const channelActions = resolveMessageActionDiscoveryForPlugin({
      pluginId: plugin.id,
      actions: plugin.actions,
      context: createMessageActionDiscoveryContext({
        ...params,
        currentChannelProvider: plugin.id,
      }),
      includeActions: true,
    }).actions;
    for (const action of channelActions) {
      actions.add(action);
    }
  }
  return Array.from(actions);
}
