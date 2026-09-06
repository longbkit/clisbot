import type { ResolveConversationFn } from "@getpaseo/channels-shared";
import { createSlackWebClient } from "./client/web-api.js";
import { resolveOutboundBotToken } from "./lifecycle/start-account.js";

export const resolveSlackConversation: ResolveConversationFn = async ({ cfg, accountId, to }) => {
  const token = resolveOutboundBotToken(cfg, accountId);
  if (!token) return null;
  const client = await createSlackWebClient(token, {
    timeout: 5000,
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  });
  const response = await client.conversations.info({ channel: to });
  if (response.ok !== true || response.channel?.id !== to) return null;
  const conversation = response.channel;
  let kind: "dm" | "group" | "channel" = "channel";
  if (conversation.is_im) kind = "dm";
  else if (conversation.is_mpim) kind = "group";
  let visibility: "public" | "private" | "unknown" = "unknown";
  if (conversation.is_private || conversation.is_im || conversation.is_mpim) visibility = "private";
  else if (conversation.is_private === false) visibility = "public";
  return { label: conversation.name?.trim().slice(0, 200) || null, kind, visibility };
};
