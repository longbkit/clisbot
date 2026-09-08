// COMPAT(clisbot-control-plane): the approval card's button-click seam, made
// at-most-once.
//
// A `callback_query` is delivered again whenever its update is re-served: the
// poll leaves a failed admission out of the watermark and asks for it again
// (`polling-session.ts` `#recordFailedAdmission`, up to
// `TELEGRAM_UPDATE_MAX_ATTEMPTS`), and the webhook answers 500 so Telegram
// redelivers. The seam behind this is the Hub's approval engine — running it
// twice answers one approval twice.
//
// Two rules, both here so the poll and the webhook cannot drift:
//
//   * The caller runs the seam only AFTER durable admission, so a failed
//     admission never leaves an approval behind.
//   * A click id is dispatched once. The id is Telegram's own
//     `callback_query.id`, which is stable across redeliveries of the same
//     update, so it is the dedupe key.
//
// A seam fault is logged, never thrown: the transport must keep running, and a
// click whose handler threw is not retried by re-serving the update (the Hub
// owns approval retries).

import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import type { CallbackQuery } from "grammy/types";

/** Dispatched ids kept per session. Cleared wholesale at the cap, the same
 * bounded-set rule the poll's `seenUpdateIds` uses. */
const DISPATCHED_IDS_CAP = 2_000;

export interface TelegramApprovalDispatcher {
  /** Runs the seam for this click, at most once per `callback_query.id`. */
  dispatch(callbackQuery: CallbackQuery): Promise<void>;
}

export function createTelegramApprovalDispatcher(options: {
  accountId: string;
  seam?: ((callbackQuery: CallbackQuery) => Promise<void>) | undefined;
  logger?: HostChildLogger | undefined;
}): TelegramApprovalDispatcher {
  const dispatched = new Set<string>();
  return {
    dispatch: async (callbackQuery) => {
      const seam = options.seam;
      if (seam === undefined) return;
      const id = callbackQuery.id;
      if (dispatched.has(id)) return;
      if (dispatched.size >= DISPATCHED_IDS_CAP) dispatched.clear();
      // Marked before the seam runs: a seam that throws must not be retried by
      // the next redelivery of the same click.
      dispatched.add(id);
      try {
        await seam(callbackQuery);
      } catch (error) {
        options.logger?.warn("telegram approval-callback handoff fault (kept polling)", {
          accountId: options.accountId,
          error: formatErrorMessage(error),
        });
      }
    },
  };
}
