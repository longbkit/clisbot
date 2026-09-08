// upstream: extensions/telegram/src/outbound-message-context.ts@5d8067a4483
// D-TG-018: upstream records every outbound message into OpenClaw's Telegram
// message cache (`message-cache.ts`, 1000 lines over the session store) so the
// agent's next prompt can see the bot's own turns. Fusion's Hub owns
// conversation history and prompt context, so the recorder keeps upstream's
// signature and reports "not recorded"; the message shape the ported senders
// pass around is verbatim.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { TelegramThreadSpec } from "./bot/helpers.js";
import type { TelegramPromptContextProjection } from "./prompt-context-projection.js";

type TelegramOutboundPromptContextUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramOutboundPromptContextMessage = {
  message_id?: number;
  chat?: { id?: string | number; type?: string; title?: string; username?: string };
  date?: number;
  from?: TelegramOutboundPromptContextUser;
  sender_chat?: { id?: number; title?: string; username?: string };
  sender_business_bot?: TelegramOutboundPromptContextUser;
  openclaw_prompt_context_timestamp_ms?: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  direct_messages_topic?: { topic_id?: number };
};

type TelegramOutboundPromptContextAccount = {
  accountId: string;
  name?: string;
  bot?: { first_name?: string; username?: string };
};

/** No-op in Fusion: the Hub owns conversation history. Returns false ("not recorded"). */
export async function recordOutboundMessageForPromptContext(params: {
  cfg: OpenClawConfig;
  account: TelegramOutboundPromptContextAccount;
  chatId: string | number;
  message: TelegramOutboundPromptContextMessage;
  messageId: number;
  botUserId?: number;
  text?: string;
  messageThreadId?: number;
  successfulSendThread?: TelegramThreadSpec;
  promptContextTimestampMs?: number;
  promptContextProjection?: TelegramPromptContextProjection;
  ownerAgentId?: string;
  recordGroupHistory?: boolean;
}): Promise<boolean> {
  void params;
  return false;
}
