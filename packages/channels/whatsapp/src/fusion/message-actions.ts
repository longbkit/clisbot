// The channel-owned `message` tool surface (D-WA-029).
//
// Upstream advertises `react`, `poll` and `upload-file` (`channel-actions.ts`,
// carried verbatim). The Hub's `message` tool already posts files through
// `send` (`outbound.sendMedia`), so this adapter exposes `react` and `poll`
// under upstream's gates (`actions.reactions` with the account's
// `reactionLevel`; `actions.polls`). `react` runs upstream's executor
// (`channel-react-action.ts`, verbatim). `poll` is executed here: upstream sent
// it through its outbound adapter's `sendPoll`, which the Hub does not carry, so
// this reads core's shared poll params (`pollQuestion`, `pollOption`,
// `pollMulti`) and calls upstream's `sendPollWhatsApp`. The account's live
// socket stores the poll so votes can be read (`fusion/polls.ts`).
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "@clisbot/channels-core/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { readBooleanParam } from "@clisbot/channels-core/plugin-sdk/boolean-param";
import {
  jsonResult,
  readStringArrayParam,
  readStringParam,
  resolvePollMaxSelections,
} from "@clisbot/channels-core/plugin-sdk/channel-actions";
import { describeWhatsAppMessageActions } from "../channel-actions.js";
import { handleWhatsAppMessageAction } from "../channel-react-action.js";
import { sendPollWhatsApp } from "../send.js";
import { mergeAccountCarrier } from "./account-config.js";

/** The actions this vertical executes, in the Hub's action vocabulary. */
export const WHATSAPP_MESSAGE_ACTIONS = ["react", "poll"] as const;

type PollActionContext = {
  cfg: OpenClawConfig;
  accountId?: string | null;
  params: Record<string, unknown>;
  toolContext?: { currentChannelId?: string | null } | null;
};

/** `poll`: core's shared poll params → upstream `sendPollWhatsApp`. */
async function handlePollAction(ctx: PollActionContext) {
  const to = readStringParam(ctx.params, "to") ?? ctx.toolContext?.currentChannelId ?? undefined;
  if (!to) throw new Error("poll needs a target chat (`to`)");
  const question = readStringParam(ctx.params, "pollQuestion", { required: true });
  const options = readStringArrayParam(ctx.params, "pollOption", { required: true });
  if (options.length < 2) throw new Error("pollOption requires at least two values");
  const allowMultiselect = readBooleanParam(ctx.params, "pollMulti") ?? false;
  const result = await sendPollWhatsApp(
    to,
    { question, options, maxSelections: resolvePollMaxSelections(options.length, allowMultiselect) },
    { verbose: false, cfg: ctx.cfg, ...(ctx.accountId ? { accountId: ctx.accountId } : {}) },
  );
  return jsonResult({ ok: true, channel: "whatsapp", action: "poll", messageId: result.messageId, toJid: result.toJid });
}

function isSupported(action: ChannelMessageActionName): boolean {
  return (WHATSAPP_MESSAGE_ACTIONS as readonly string[]).includes(action);
}

function withCarrier<T extends { cfg: unknown; accountId?: string | null }>(ctx: T): T {
  const account = (ctx as { account?: Record<string, unknown> }).account;
  return {
    ...ctx,
    cfg: mergeAccountCarrier(ctx.cfg as OpenClawConfig, ctx.accountId ?? "", account),
  };
}

export const whatsappMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: (ctx) => {
    const described = describeWhatsAppMessageActions(withCarrier(ctx) as never);
    if (described === null) return null;
    return { actions: described.actions.filter(isSupported) };
  },
  supportsAction: ({ action }) => isSupported(action),
  handleAction: async (ctx) => {
    if (!isSupported(ctx.action)) {
      throw new Error(`Action ${ctx.action} is not supported for provider whatsapp.`);
    }
    const scoped = withCarrier(ctx);
    if (ctx.action === "poll") return await handlePollAction(scoped as unknown as PollActionContext);
    return await handleWhatsAppMessageAction(scoped as never);
  },
};
