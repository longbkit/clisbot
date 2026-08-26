// The drive surface — the object the Hub control plane actually drives
// (blueprint §6.5 hard rule 2, B3-immutable): `gateway.startAccount` +
// `outbound.sendText` under the pinned export name `slackPlugin`.
// Declared in-repo; never imported from OpenClaw.

import type { ChannelPlugin } from "@getpaseo/channels-shared";
import { startSlackAccount } from "./lifecycle/start-account.js";
import { sendSlackText } from "./outbound.js";

/** The pinned Slack drive surface (B3-immutable export name `slackPlugin`). */
export const slackPlugin: ChannelPlugin = {
  gateway: {
    startAccount: async (ctx) => {
      await startSlackAccount(ctx);
    },
  },
  outbound: {
    sendText: async (args) => {
      return await sendSlackText(args);
    },
  },
};
