import { resolveTelegramConversation } from "./conversation-metadata.js";
// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `telegramPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { startTelegramAccount } from "./lifecycle/start-account.js";
import { getHostRuntime } from "./runtime-store.js";
import { sendMedia, sendText, updateText } from "./outbound.js";
import { telegramTyping } from "./typing.js";

export const telegramPlugin: ChannelPlugin = {
  directory: { resolveConversation: resolveTelegramConversation },
  gateway: {
    startAccount: (ctx) =>
      startTelegramAccount(
        ctx,
        (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime(),
      ),
  },
  outbound: {
    sendText,
    // COMPAT(clisbot-control-plane): the approval card's in-place update
    // (`editMessageText`); the Hub's approval engine decides against it.
    updateText,
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post (the
    // mime-routed Bot API media send + the shared G11 gate).
    sendMedia,
    // COMPAT(clisbot-control-plane): the `sync.progress` liveness surface
    // (`sendChatAction("typing")`; typing.ts). The Bot API has no reaction
    // surface, so that leaf is answered here as "nothing to do".
    typing: async (args: Record<string, unknown>) => {
      await telegramTyping(args as never);
    },
  },
};

export { startTelegramAccount } from "./lifecycle/start-account.js";
export { sendMedia, sendText } from "./outbound.js";
