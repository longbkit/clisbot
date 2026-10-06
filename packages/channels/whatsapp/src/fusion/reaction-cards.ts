// Fusion-owned reaction cards (D-WA-032): approval and question prompts
// answered by reacting.
//
// WhatsApp has no buttons. OpenClaw renders an exec/plugin approval as 👍/👎
// reactions and a single-select `ask_user` question with up to four options as
// 1️⃣–4️⃣ (`approval-reactions.ts`, `question-reactions.ts`, omitted with the
// OpenClaw approval and question runtimes they call). The Hub owns approvals and
// questions, and hands this vertical the card's buttons with the prompt
// (`OutboundPostParams.cardButtons`, the same buttons a Slack or Telegram card
// gets). This module turns them into reactions:
//
//  * approve (`primary`) → 👍, deny / dismiss (`danger`) → 👎;
//  * a question's options → 1️⃣–4️⃣ in order. More than four options, or a
//    free-text "Other…" only, leaves the prompt text-only, as upstream does;
//    the typed `approve <id> …` command in the prompt always works.
//
// The prompt's message id → its reactions are kept in the account's keyed store
// (`cards`, 7 days), and a reaction on that message comes back as the button's
// value through the Hub's ordinary `callback` path, which re-authorizes the
// person who reacted exactly as it does a button click.
import type { HostKeyedStore, HostRuntime } from "@clisbot/channels-shared";

export const WHATSAPP_CARDS_NAMESPACE = "cards";
const CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"] as const;
const APPROVE_EMOJI = "👍";
const DENY_EMOJI = "👎";
/** The Hub's free-text marker (`approvals/card.ts` `OTHER_ANSWER`). */
const OTHER_VALUE_SUFFIX = ":Other";

export type CardButton = { text: string; value: string; style?: "primary" | "danger" };
export type ReactionChoice = { emoji: string; label: string; value: string };
export type StoredReactionCard = { chatJid: string; choices: ReactionChoice[] };

export function openWhatsAppCardStore(hostRuntime: HostRuntime): HostKeyedStore<StoredReactionCard> {
  return hostRuntime.state.openKeyedStore({
    namespace: WHATSAPP_CARDS_NAMESPACE,
    maxEntries: 500,
    overflowPolicy: "evict-oldest",
    defaultTtlMs: CARD_TTL_MS,
  }) as HostKeyedStore<StoredReactionCard>;
}

/** The reactions a card's buttons map to, or undefined when none apply. */
export function planReactionCard(buttons: readonly CardButton[]): ReactionChoice[] | undefined {
  const options = buttons.filter(
    (button) => button.style === undefined && !button.value.endsWith(OTHER_VALUE_SUFFIX),
  );
  if (options.length > NUMBER_EMOJI.length) return undefined;
  const choices: ReactionChoice[] = [];
  options.forEach((button, index) => {
    choices.push({ emoji: NUMBER_EMOJI[index]!, label: button.text, value: button.value });
  });
  const approve = buttons.find((button) => button.style === "primary");
  if (approve) choices.push({ emoji: APPROVE_EMOJI, label: approve.text, value: approve.value });
  const deny = buttons.find((button) => button.style === "danger");
  if (deny) choices.push({ emoji: DENY_EMOJI, label: deny.text, value: deny.value });
  const answerable = choices.some((choice) => choice.emoji !== DENY_EMOJI);
  return answerable ? choices : undefined;
}

/** The lines appended to the prompt that say which reaction does what. */
export function reactionLegend(choices: readonly ReactionChoice[]): string {
  return ["Or react to this message:", ...choices.map((choice) => `${choice.emoji} ${choice.label}`)].join("\n");
}

/** Emoji as WhatsApp may send them back: no variation selector, no skin tone. */
export function normalizeReactionEmoji(emoji: string): string {
  return emoji.replace(/\u{FE0F}|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}/gu, "").trim();
}

/** The choice a reaction picks on a stored card. */
export function matchReaction(card: StoredReactionCard, emoji: string): ReactionChoice | undefined {
  const wanted = normalizeReactionEmoji(emoji);
  if (wanted === "") return undefined;
  return card.choices.find((choice) => normalizeReactionEmoji(choice.emoji) === wanted);
}
