// The channel-owned `message` tool surface (D-FS-021).
//
// Upstream declares this adapter inline inside `channel.ts` — a 1200-line
// OpenClaw plugin object that also carries the setup wizard, the pairing
// adapter, the doctor contract and the outbound delivery adapter, none of which
// Fusion has. What is portable is the contract: the action set
// `describeFeishuMessageTool` advertises, the `messageActionTargetAliases`
// (carried verbatim in `message-action-contract.ts`), the action gate
// (`actions.reactions` / `actions.sticker`) and the per-action argument names
// and error messages. Those are kept here, over the ported API functions.
//
// Only actions this vertical can execute are advertised. Upstream's `send`
// branch reaches OpenClaw's outbound delivery adapter for media upload,
// presentation fallback and voice notes; that path lands with the Hub media
// slice, so `upload-file` and `sticker` are refused here rather than advertised
// and then failing at the transport. `supportsAction` answering false makes the
// Hub reply `unsupported_action` instead of a transport error.

import { createActionGate, jsonResult } from "@getpaseo/channels-core/plugin-sdk/channel-actions";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import {
  inspectFeishuCredentials,
  listEnabledFeishuAccounts,
  resolveFeishuAccount,
} from "./accounts.js";
import { getChatInfo, getChatMembers } from "./chat.js";
import { createFeishuClient } from "./client.js";
import { messageActionTargetAliases } from "./message-action-contract.js";
import { createPinFeishu, listPinsFeishu, removePinFeishu } from "./pins.js";
import { addReactionFeishu, listReactionsFeishu, removeReactionFeishu } from "./reactions.js";
import { editMessageFeishu, getMessageFeishu, sendMessageFeishu } from "./send.js";
import type { FeishuConfig, ResolvedFeishuAccount } from "./types.js";

/** The actions this vertical executes, in the Hub's action vocabulary. */
export const FEISHU_MESSAGE_ACTIONS = [
  "send",
  "thread-reply",
  "read",
  "edit",
  "pin",
  "unpin",
  "list-pins",
  "member-info",
  "channel-info",
] as const;

/** Upstream `channel.ts`, unchanged: the per-account action gate. */
function isFeishuActionEnabled(
  account: ResolvedFeishuAccount,
  action: "reactions" | "sticker",
): boolean {
  if (!account.enabled || !account.configured) {
    return false;
  }
  return createActionGate(account.config.actions)(action, action === "reactions");
}

function readString(params: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/** The target aliases upstream's `message-action-contract.ts` declares, read in
 * its order. The Hub folds its own `to` into `params.to` before dispatch. */
function requireTarget(action: string, params: Record<string, unknown>): string {
  const to = readString(params, ["to", "chatId", "chat_id", "channel_id"]);
  if (!to) throw new Error(`Feishu ${action} requires a target (to).`);
  return to;
}

function requireMessageId(action: string, params: Record<string, unknown>): string {
  const messageId = readString(params, ["messageId", "message_id"]);
  if (!messageId) throw new Error(`Feishu ${action} requires messageId.`);
  return messageId;
}

/** Upstream `channel.ts::describeFeishuMessageTool`, with the action set this
 * vertical can execute. The reaction verbs stay gated on `actions.reactions`. */
export const feishuChannelActions: ChannelMessageActionAdapter = {
  providerOwnedReadGates: true,
  messageActionTargetAliases,
  describeMessageTool: ({ cfg, accountId }) => {
    const enabledAccounts = accountId
      ? [resolveFeishuAccount({ cfg, accountId })].filter(
          (account) => account.enabled && account.configured,
        )
      : listEnabledFeishuAccounts(cfg);
    const enabled =
      enabledAccounts.length > 0 ||
      (!accountId &&
        cfg.channels?.feishu?.enabled !== false &&
        Boolean(inspectFeishuCredentials(cfg.channels?.feishu as FeishuConfig | undefined, cfg)));
    if (enabledAccounts.length === 0) {
      return { actions: [], capabilities: enabled ? ["presentation"] : [] };
    }
    const actions = new Set<ChannelMessageActionName>([...FEISHU_MESSAGE_ACTIONS]);
    if (enabledAccounts.some((account) => isFeishuActionEnabled(account, "reactions"))) {
      actions.add("react");
      actions.add("reactions");
    }
    return { actions: Array.from(actions), capabilities: enabled ? ["presentation"] : [] };
  },
  supportsAction: ({ action }) =>
    (FEISHU_MESSAGE_ACTIONS as readonly string[]).includes(action) ||
    action === "react" ||
    action === "reactions",
  handleAction: async (ctx) => {
    const accountId = ctx.accountId ?? undefined;
    const account = resolveFeishuAccount({ cfg: ctx.cfg, accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`Feishu account "${account.accountId}" not configured`);
    }
    const params = ctx.params as Record<string, unknown>;
    const common = { cfg: ctx.cfg, ...(accountId === undefined ? {} : { accountId }) };

    if (ctx.action === "send" || ctx.action === "thread-reply") {
      const to = requireTarget(ctx.action, params);
      const replyToMessageId = readString(params, ["messageId", "message_id", "replyToId"]);
      if (ctx.action === "thread-reply" && !replyToMessageId) {
        throw new Error("Feishu thread-reply requires messageId.");
      }
      const text = readString(params, ["text", "message"]);
      if (!text) throw new Error(`Feishu ${ctx.action} requires text/message.`);
      const result = await sendMessageFeishu({
        ...common,
        to,
        text,
        ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
        ...(ctx.action === "thread-reply" ? { replyInThread: true } : {}),
      });
      return jsonResult({ ok: true, channel: "feishu", action: ctx.action, ...result });
    }

    if (ctx.action === "read") {
      const messageId = requireMessageId("read", params);
      const message = await getMessageFeishu({ ...common, messageId });
      if (!message) {
        throw new Error(`Feishu read failed or message not found: ${messageId}`);
      }
      return jsonResult({ ok: true, channel: "feishu", action: "read", message });
    }

    if (ctx.action === "edit") {
      const messageId = requireMessageId("edit", params);
      const text = readString(params, ["text", "message"]);
      const card =
        params.card && typeof params.card === "object"
          ? (params.card as Record<string, unknown>)
          : undefined;
      const result = await editMessageFeishu({
        ...common,
        messageId,
        ...(text === undefined ? {} : { text }),
        ...(card === undefined ? {} : { card }),
      });
      return jsonResult({ ok: true, channel: "feishu", action: "edit", ...result });
    }

    if (ctx.action === "pin" || ctx.action === "unpin") {
      const messageId = requireMessageId(ctx.action, params);
      if (ctx.action === "pin") {
        const pin = await createPinFeishu({ ...common, messageId });
        return jsonResult({ ok: true, channel: "feishu", action: "pin", pin });
      }
      await removePinFeishu({ ...common, messageId });
      return jsonResult({ ok: true, channel: "feishu", action: "unpin", messageId });
    }

    if (ctx.action === "list-pins") {
      const chatId = requireTarget("list-pins", params);
      const pins = await listPinsFeishu({ ...common, chatId });
      return jsonResult({ ok: true, channel: "feishu", action: "list-pins", ...pins });
    }

    if (ctx.action === "react" || ctx.action === "reactions") {
      if (!isFeishuActionEnabled(account, "reactions")) {
        throw new Error("Feishu reactions are disabled via actions.reactions.");
      }
      const messageId = requireMessageId(ctx.action, params);
      if (ctx.action === "reactions") {
        const emojiType = readString(params, ["emoji", "emojiType", "reaction"]);
        const reactions = await listReactionsFeishu({
          ...common,
          messageId,
          ...(emojiType === undefined ? {} : { emojiType }),
        });
        return jsonResult({ ok: true, channel: "feishu", action: "reactions", reactions });
      }
      const reactionId = readString(params, ["reactionId"]);
      if (reactionId) {
        await removeReactionFeishu({ ...common, messageId, reactionId });
        return jsonResult({ ok: true, channel: "feishu", action: "react", removed: reactionId });
      }
      const emojiType = readString(params, ["emoji", "emojiType", "reaction"]);
      if (!emojiType) throw new Error("Feishu react requires emoji (or reactionId to remove).");
      const added = await addReactionFeishu({ ...common, messageId, emojiType });
      return jsonResult({ ok: true, channel: "feishu", action: "react", ...added });
    }

    if (ctx.action === "channel-info" || ctx.action === "member-info") {
      const chatId = requireTarget(ctx.action, params);
      const client = createFeishuClient(account);
      if (ctx.action === "channel-info") {
        const chat = await getChatInfo(client, chatId);
        return jsonResult({ ok: true, channel: "feishu", action: "channel-info", chat });
      }
      const members = await getChatMembers(client, chatId);
      return jsonResult({ ok: true, channel: "feishu", action: "member-info", members });
    }

    throw new Error(`Action ${ctx.action} is not supported for provider feishu.`);
  },
};
