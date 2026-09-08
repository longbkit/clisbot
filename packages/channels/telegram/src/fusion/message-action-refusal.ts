// Fusion-owned: keeps a refused delegated mutation legible in the tool result.
//
// `message-topic-binding.ts` refuses an unattested topic mutation by throwing,
// and every caller but one surfaces that message. The exception is upstream's
// `react` catch (`action-runtime.ts`, verbatim), which classifies the throw as
// REACTION_INVALID or not and otherwise answers
// `{ reason: "error", hint: "Reaction failed. Do not retry." }` — the model is
// told the reaction failed and nothing about why, and the operator log says
// nothing at all (wave 6d, live).
//
// The catch is upstream's, so the reason is carried out beside it: the refusal
// notes itself on the call's own slot, and this boundary — the last Fusion-owned
// step before the Hub reads the vertical's result (`plugin.ts`) — puts it back
// into the payload the model reads. Upstream's shape is untouched: still a
// jsonResult, still `ok: false`, only `reason` and `hint` say what happened.

import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentToolResult } from "@getpaseo/channels-core/plugin-sdk/agent-core";
import { jsonResult } from "@getpaseo/channels-core/plugin-sdk/channel-actions";
import type {
  ChannelMessageActionAdapter,
} from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import { isRecord } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";

/** The distinct reason a swallowed refusal reports instead of `"error"`. */
export const TELEGRAM_UNBOUND_MUTATION_REASON = "unbound_topic_mutation";

type RefusalSlot = { reason?: string };

const refusals = new AsyncLocalStorage<RefusalSlot>();

/** Records why this call's delegated mutation was refused, for the boundary. */
export function noteTelegramMutationRefusal(reason: string): void {
  const slot = refusals.getStore();
  if (slot !== undefined) slot.reason = reason;
}

/** Puts a noted refusal back into a result that swallowed it. */
function withRefusalReason(result: unknown, reason: string): unknown {
  const details = (result as AgentToolResult<unknown> | undefined)?.details;
  // Only the swallowed case: a refusal the vertical already named (a missing
  // id, an invalid reaction) is upstream's own answer and stays as it is.
  if (!isRecord(details) || details["ok"] !== false || details["reason"] !== "error") {
    return result;
  }
  return jsonResult({
    ...details,
    reason: TELEGRAM_UNBOUND_MUTATION_REASON,
    hint: reason,
  });
}

/** The vertical's action adapter, with refused mutations kept legible. */
export function withTelegramMutationRefusalReason(
  adapter: ChannelMessageActionAdapter,
): ChannelMessageActionAdapter {
  const handleAction = adapter.handleAction;
  if (handleAction === undefined) return adapter;
  return {
    ...adapter,
    handleAction: async (ctx) => {
      const slot: RefusalSlot = {};
      const result = await refusals.run(slot, async () => await handleAction(ctx));
      return slot.reason === undefined
        ? result
        : (withRefusalReason(result, slot.reason) as typeof result);
    },
  };
}
