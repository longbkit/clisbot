// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `telegramPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.

import type { ChannelPlugin } from "@getpaseo/channels-shared";
import { startTelegramAccount } from "./lifecycle/start-account.js";
import { getHostRuntime } from "./runtime-store.js";
import { sendText } from "./outbound.js";

export const telegramPlugin: ChannelPlugin = {
  gateway: {
    startAccount: (ctx) => startTelegramAccount(ctx, getHostRuntime()),
  },
  outbound: {
    sendText,
  },
};

export { startTelegramAccount } from "./lifecycle/start-account.js";
export { sendText } from "./outbound.js";
