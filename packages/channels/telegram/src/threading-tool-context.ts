// upstream: extensions/telegram/src/threading-tool-context.ts@5d8067a4483
// Telegram plugin module implements threading tool context behavior.
import type {
  ChannelThreadingContext,
  ChannelThreadingToolContext,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { normalizeOptionalString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import { parseTelegramTarget } from "./targets.js";

function resolveTelegramToolContextThreadId(context: ChannelThreadingContext): string | undefined {
  if (context.MessageThreadId != null) {
    return String(context.MessageThreadId);
  }
  const currentChannelId = normalizeOptionalString(context.To);
  if (!currentChannelId) {
    return undefined;
  }
  const parsedTarget = parseTelegramTarget(currentChannelId);
  return parsedTarget.messageThreadId != null ? String(parsedTarget.messageThreadId) : undefined;
}

export function buildTelegramThreadingToolContext(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  context: ChannelThreadingContext;
  hasRepliedRef?: { value: boolean };
}): ChannelThreadingToolContext {
  void params.cfg;
  void params.accountId;

  return {
    currentChannelId: normalizeOptionalString(params.context.To),
    currentThreadTs: resolveTelegramToolContextThreadId(params.context),
    hasRepliedRef: params.hasRepliedRef,
  };
}
