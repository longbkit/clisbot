// The drive surface — the object the Hub control plane actually drives
// (blueprint §6.5 hard rule 2, B3-immutable): `gateway.startAccount` +
// `outbound.sendText` under the pinned export name `slackPlugin`.
// Declared in-repo; never imported from OpenClaw.
//
// Slice 10b adds two things to it, both from the ported upstream source:
//
//  * `actions` — upstream's own `ChannelMessageActionAdapter`
//    (`channel-actions.ts` `createSlackActions`). The Hub reads it under either
//    `messageActions` or `actions` (`packages/hub/src/channels/message-actions.ts`
//    `readPluginMessageActions`), so the upstream spelling stays. It carries
//    `describeMessageTool` (the advertised action set), `extractToolSend`,
//    `isToolDeliveryAction`, `prepareSendPayload` and `handleAction`, which
//    dispatches through `message-action-dispatch.ts` into `action-runtime.ts`.
//  * `outbound.<upstream primitive>` — the ported send/edit/react/pin/read/
//    upload functions under their upstream names, alongside the unchanged
//    Fusion drive verbs `sendText` / `sendMedia` / `typing` / `updateText`.

import type { ChannelPlugin } from "@getpaseo/channels-shared";
import {
  deleteSlackMessage,
  downloadSlackFile,
  editSlackMessage,
  editSlackRenderedMessage,
  getSlackMemberInfo,
  listSlackEmojis,
  listSlackPins,
  listSlackReactions,
  openSlackConversation,
  pinSlackMessage,
  reactSlackMessage,
  readSlackMessages,
  removeOwnSlackReactions,
  removeSlackReaction,
  sendSlackMessage,
  unpinSlackMessage,
} from "./actions.js";
import { createSlackActions } from "./channel-actions.js";
import { uploadSlackFile } from "./client-delivery.js";
import { resolveSlackConversation } from "./conversation-metadata.js";
import { startSlackAccount } from "./lifecycle/start-account.js";
import { finalizeSlackPreviewEdit } from "./monitor/message-handler/preview-finalize.js";
import { sendMedia, sendSlackText, updateSlackText } from "./outbound.js";
import {
  buildSlackProgressCardBlocks,
  buildSlackProgressStreamChunks,
  reconcileSlackNativeTaskChunks,
} from "./progress-blocks.js";
import {
  clearSlackThreadParticipationCache,
  hasSlackThreadParticipation,
  recordSlackThreadParticipation,
} from "./sent-thread-cache.js";
import { applyAppendOnlyStreamUpdate, resolveSlackStreamingConfig } from "./stream-mode.js";
import {
  appendSlackStream,
  markSlackStreamFallbackDelivered,
  markSlackStreamsStopped,
  startSlackStream,
  stopSlackStream,
} from "./streaming.js";
import { resolveSlackNativeStreaming, resolveSlackStreamingMode } from "./streaming-compat.js";
import {
  reconcileSlackUnknownSend,
  resolveSlackDmChannelId,
  sendMessageSlack,
  updateMessageSlack,
} from "./send.js";
import { disposeSlackAccountRuntime, withSlackAccountRuntime } from "./runtime-store.js";
import { SLACK_PRESENTATION_CAPABILITIES } from "./presentation.js";
import { slackTyping } from "./typing.js";

/** Upstream's message-action adapter for this vertical. `createSlackActions`
 * takes the provider id the tool result reports actions under. */
export const slackMessageActions = createSlackActions("slack");

/** The pinned Slack drive surface (B3-immutable export name `slackPlugin`).
 * `outbound.updateText` is COMPAT(clisbot-control-plane): the approval
 * card's in-place update (`chat.update`) — the Hub's approval engine
 * decides against it; absent from a pinned vertical, the card just goes
 * stale (the open record key keeps the pinned surface byte-compatible). */
export const slackPlugin: ChannelPlugin = {
  // Upstream's spelling. The Hub's `readPluginMessageActions` accepts it and
  // registers it as the account's `ChannelMessageActionAdapter`.
  actions: slackMessageActions,
  messageActions: slackMessageActions,
  directory: { resolveConversation: resolveSlackConversation },
  gateway: {
    // The account's own HostRuntime is bound and made current for the whole
    // transport lifetime, so the ported inbound path (thread participation,
    // sent-message records, `[slack/…]` lines) resolves THIS account's state
    // and logger rather than whichever account the entry was driven with last.
    startAccount: async (ctx) => {
      await withSlackAccountRuntime(
        { accountId: ctx.accountId, hostRuntime: ctx["hostRuntime"] },
        () => startSlackAccount(ctx),
      );
    },
  },
  /** The Hub's loader calls this when it unloads this account's vertical: it
   * releases the account's ported plugin runtime (keyed stores, log sink) and
   * its HostRuntime binding, which the loader's own registries do not own. */
  disposeAccount: (accountId: string) => {
    disposeSlackAccountRuntime(accountId);
  },
  outbound: {
    // Upstream declares the vertical's presentation limits on its outbound
    // adapter (`extensions/slack/src/outbound-adapter.ts@5d8067a4483:259`,
    // `channel.ts:466`); core reads them to adapt a portable presentation
    // before the channel renders it. Same constant, same spelling, so a host
    // that drives core's delivery adapter and the Hub, which drives `sendText`
    // (`presentation-outbound.ts`), agree on what Slack can render (D-W6-01).
    presentationCapabilities: SLACK_PRESENTATION_CAPABILITIES,
    sendText: async (args) => {
      return await withSlackAccountRuntime(args, () => sendSlackText(args));
    },
    // The plane's `OutboundUpdateParams` is open-typed through the shared
    // plugin record — narrow at the call site (the vertical's adapter owns
    // the arg shape).
    updateText: async (args: Record<string, unknown>) => {
      return await withSlackAccountRuntime(args, () => updateSlackText(args as never));
    },
    // COMPAT(clisbot-control-plane): the G7–G11 native-media post (the 3-step
    // external upload + the shared G11 gate).
    sendMedia: async (args: Record<string, unknown>) =>
      await withSlackAccountRuntime(args, () => sendMedia(args as never)),
    // COMPAT(clisbot-control-plane): the `sync.progress` liveness surface
    // (assistant thread status + the receipt reaction; typing.ts). Absent from
    // a pinned vertical = the Hub leaves the seam unmounted.
    typing: async (args: Record<string, unknown>) => {
      await withSlackAccountRuntime(args, async () => {
        await slackTyping(args as never);
      });
    },

    // --- upstream send primitives (ported source, upstream names) ----------
    // `send.ts`: the queued, receipt-producing send and its edit/reconcile
    // companions.
    sendMessageSlack,
    updateMessageSlack,
    reconcileSlackUnknownSend,
    resolveSlackDmChannelId,
    // `actions.ts`: the message-action primitives the tool dispatches into.
    sendSlackMessage,
    editSlackMessage,
    editSlackRenderedMessage,
    deleteSlackMessage,
    reactSlackMessage,
    removeSlackReaction,
    removeOwnSlackReactions,
    listSlackReactions,
    pinSlackMessage,
    unpinSlackMessage,
    listSlackPins,
    readSlackMessages,
    openSlackConversation,
    getSlackMemberInfo,
    listSlackEmojis,
    downloadSlackFile,
    // `client-delivery.ts`: the 3-step external file upload.
    uploadSlackFile,

    // --- upstream streaming / progress primitives (slice 22) ---------------
    // `streaming.ts`: the native `chat.startStream`/`appendStream`/`stopStream`
    // draft session, keyed per (channel, thread).
    startSlackStream,
    appendSlackStream,
    stopSlackStream,
    markSlackStreamsStopped,
    markSlackStreamFallbackDelivered,
    // `streaming-compat.ts` / `stream-mode.ts`: which streaming mode an account
    // is configured for, and the append-only update the draft applies.
    resolveSlackStreamingMode,
    resolveSlackNativeStreaming,
    resolveSlackStreamingConfig,
    applyAppendOnlyStreamUpdate,
    // `progress-blocks.ts`: the progress-draft compositor snapshot rendered as
    // Block Kit — stream chunks, the progress card, and the native task
    // reconciliation.
    buildSlackProgressStreamChunks,
    buildSlackProgressCardBlocks,
    reconcileSlackNativeTaskChunks,
    // `monitor/message-handler/preview-finalize.ts`: the in-place edit that
    // replaces a streamed preview with the final rendered message.
    finalizeSlackPreviewEdit,
    // `sent-thread-cache.ts`: the "this bot spoke in this thread" record the
    // draft/finalize path reads.
    recordSlackThreadParticipation,
    hasSlackThreadParticipation,
    clearSlackThreadParticipationCache,
  },
};

export { sendMedia } from "./outbound.js";
