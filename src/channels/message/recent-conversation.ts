import {
  parseAgentCommand,
  type CommandPrefixes,
} from "../../agents/commands/commands.ts";
import type { StoredRecentConversationMessage } from "../../agents/routing/recent-message-context.ts";
import type { ChannelId } from "../integration/channel-surface-contract.ts";

export function buildRecentConversationMessage(params: {
  marker: string;
  text?: string;
  senderId?: string;
  senderName?: string;
  senderHandle?: string;
  platform: ChannelId;
  commandPrefixes: CommandPrefixes;
  isCommand?: boolean;
}): StoredRecentConversationMessage {
  const isCommand =
    params.isCommand ??
    Boolean(params.text?.trim() && parseAgentCommand(params.text, {
      commandPrefixes: params.commandPrefixes,
    }));
  return {
    marker: params.marker,
    text: isCommand ? "" : params.text,
    senderId: params.senderId,
    senderName: params.senderName,
    senderHandle: params.senderHandle,
    platform: params.platform,
  };
}
