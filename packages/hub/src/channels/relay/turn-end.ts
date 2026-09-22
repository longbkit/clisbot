// What the relay posts when a turn ends, beyond the relayed answer itself
// (docs/audits/2026-09-22-channel-reply-hybrid-mode.md). Pure: the relay
// engine owns the posting and the ledger.
import type { ToolTurnDeliveries } from "../channel-reply-turn-record.js";
import type { OutboundPath } from "../config/enums.js";

/** How much of a failure's error text reaches the conversation. */
const NOTICE_ERROR_MAX_CHARS = 300;

/** Posted when a `tool` turn completes having delivered no reply and saying nothing. */
export const NO_REPLY_NOTICE = "⚠️ The agent finished without sending a reply.";

/** The server's own copy of a failure, appended as an assistant message
 * (`agent-manager.ts` `SYSTEM_ERROR_PREFIX`). The relay reports the failure
 * from `turn_failed` instead, so this copy is never relayed. */
const SYSTEM_ERROR_PREFIX = "[System Error]";

export function isSystemErrorText(text: string): boolean {
  return text.startsWith(SYSTEM_ERROR_PREFIX);
}

/**
 * Whether a failed turn gets a notice. `relay` and `hybrid` relay every turn's
 * text, from the channel or the Paseo app alike, so they report every
 * failure with it. `tool` relays nothing, so only a turn the channel started
 * and the tool did not already answer is owed one.
 */
export function owesFailureNotice(
  path: OutboundPath,
  deliveries: ToolTurnDeliveries | undefined,
): boolean {
  if (path !== "tool") return true;
  return deliveries?.channelTurn === true && !deliveries.answered;
}

/** The notice for a failed turn, with the error cut to one short line. */
export function failureNotice(error: string | undefined): string {
  const line = normalized(error ?? "");
  if (line === "") return "⚠️ The agent stopped with an error before it finished.";
  const cut =
    line.length > NOTICE_ERROR_MAX_CHARS ? `${line.slice(0, NOTICE_ERROR_MAX_CHARS)}…` : line;
  return `⚠️ The agent stopped with an error: ${cut}`;
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** True when the tool already posted this text in the turn (the `hybrid` duplicate check). */
export function toolAlreadySent(text: string, deliveries: ToolTurnDeliveries | undefined): boolean {
  if (deliveries === undefined) return false;
  const candidate = normalized(text);
  return candidate !== "" && deliveries.texts.some((sent) => normalized(sent) === candidate);
}

/**
 * What a completed `tool` turn still owes the user, given what the tool
 * delivered and the turn's last assistant message. `undefined` = nothing: the
 * turn answered, or its only visible act (a reaction, an edit) was the answer.
 * Text only — the fallback never sends a file.
 */
export function toolTurnFallback(
  deliveries: ToolTurnDeliveries | undefined,
  finalText: string,
): string | undefined {
  if (deliveries?.answered === true) return undefined;
  if (deliveries?.acted === true && !deliveries.progress) return undefined;
  if (finalText.trim() === "" || toolAlreadySent(finalText, deliveries)) return NO_REPLY_NOTICE;
  return finalText;
}
