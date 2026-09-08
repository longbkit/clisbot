// The channel-owned `message` tool surface (D-GC-017).
//
// Upstream's `actions.ts` is the adapter itself and is carried unchanged next to
// this file; it advertises exactly one action, `send`, because that is all a
// service-account Chat app can do without user OAuth. This module composes it
// so the two REST verbs upstream's own client already implements —
// `updateGoogleChatMessage` and `deleteGoogleChatMessage`, which upstream calls
// from its reply-delivery and approval-card paths but never exposes as tool
// actions — reach the Hub's message tool as `edit` and `delete`.
//
// Nothing else is added: `react`, `pin`, `upload-file`, `read` and the emoji
// verbs have no service-account API on this channel, so `supportsAction` refuses
// them and the Hub answers `unsupported_action` rather than a transport error.

import {
  jsonResult,
  readStringParam,
} from "@getpaseo/channels-core/plugin-sdk/channel-actions";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import { resolveGoogleChatAccount } from "./accounts.js";
import { googlechatMessageActions } from "./actions.js";
import { deleteGoogleChatMessage, updateGoogleChatMessage } from "./api.js";
import { formatGoogleChatTextChunks } from "./format.js";

/** The actions this vertical executes, in the Hub's action vocabulary. */
export const GOOGLECHAT_MESSAGE_ACTIONS = ["send", "edit", "delete"] as const;

function isSupported(action: ChannelMessageActionName): boolean {
  return (GOOGLECHAT_MESSAGE_ACTIONS as readonly string[]).includes(action);
}

export const googlechatChannelActions: ChannelMessageActionAdapter = {
  ...googlechatMessageActions,
  describeMessageTool: (ctx) => {
    const discovery = googlechatMessageActions.describeMessageTool?.(ctx);
    return discovery === null || discovery === undefined
      ? discovery
      : { ...discovery, actions: [...GOOGLECHAT_MESSAGE_ACTIONS] };
  },
  supportsAction: ({ action }) => isSupported(action),
  handleAction: async (ctx) => {
    if (ctx.action === "send") {
      if (googlechatMessageActions.handleAction === undefined) {
        throw new Error("Google Chat actions are not available.");
      }
      return await googlechatMessageActions.handleAction(ctx);
    }
    const account = resolveGoogleChatAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
    if (account.credentialSource === "none" || account.tokenStatus === "configured_unavailable") {
      throw new Error("Google Chat credentials are missing.");
    }
    // A Chat message resource name (`spaces/…/messages/…`) already identifies
    // its space, so `edit`/`delete` need no target resolution.
    const messageName = readStringParam(ctx.params, "messageId", { required: true });
    if (ctx.action === "edit") {
      const content = readStringParam(ctx.params, "message", {
        required: true,
        allowEmpty: true,
      });
      const chunks = formatGoogleChatTextChunks(content ?? "");
      if (chunks.length > 1) {
        // A Chat edit patches ONE message resource, so the chunks past the
        // first have nowhere to land. Keeping only chunk 1 and answering `ok`
        // silently truncated the agent's text; refusing says what happened and
        // leaves the original message as it was.
        return jsonResult({
          ok: false,
          action: "edit",
          messageName,
          error: `the replacement text needs ${chunks.length} Google Chat messages and an edit can only rewrite one; post a new message instead`,
        });
      }
      const updated = await updateGoogleChatMessage({
        account,
        messageName: messageName ?? "",
        text: chunks[0] ?? "",
      });
      return jsonResult({ ok: true, ...updated });
    }
    if (ctx.action === "delete") {
      await deleteGoogleChatMessage({ account, messageName: messageName ?? "" });
      return jsonResult({ ok: true, messageName });
    }
    throw new Error(`Action ${ctx.action} is not supported for provider googlechat.`);
  },
};
