import { resolveSlackConversation } from "./conversation-metadata.js";
// The drive surface — the object the Hub control plane actually drives
// (blueprint §6.5 hard rule 2, B3-immutable): `gateway.startAccount` +
// `outbound.sendText` under the pinned export name `slackPlugin`.
// Declared in-repo; never imported from OpenClaw.

import type { ChannelPlugin } from "@getpaseo/channels-shared";
import { startSlackAccount } from "./lifecycle/start-account.js";
import { sendMedia, sendSlackText, updateSlackText } from "./outbound.js";
import { slackTyping } from "./typing.js";

/** The pinned Slack drive surface (B3-immutable export name `slackPlugin`).
 * `outbound.updateText` is COMPAT(clisbot-control-plane): the approval
 * card's in-place update (`chat.update`) — the Hub's approval engine
 * decides against it; absent from a pinned vertical, the card just goes
 * stale (the open record key keeps the pinned surface byte-compatible). */
export const slackPlugin: ChannelPlugin = {
  directory: { resolveConversation: resolveSlackConversation },
  gateway: {
    startAccount: async (ctx) => {
      await startSlackAccount(ctx);
    },
  },
  outbound: {
    sendText: async (args) => {
      return await sendSlackText(args);
    },
    // The plane's `OutboundUpdateParams` is open-typed through the shared
    // plugin record — narrow at the call site (the vertical's adapter owns
    // the arg shape).
    updateText: async (args: Record<string, unknown>) => {
      return await updateSlackText(args as never);
    },
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post (the 3-step
    // external upload + the shared G11 gate).
    sendMedia,
    // COMPAT(clisbot-control-plane): the `sync.progress` liveness surface
    // (assistant thread status + the receipt reaction; typing.ts). Absent from
    // a pinned vertical = the Hub leaves the seam unmounted.
    typing: async (args: Record<string, unknown>) => {
      await slackTyping(args as never);
    },
  },
};

export { sendMedia } from "./outbound.js";
